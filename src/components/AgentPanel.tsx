import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MdEditor } from "./MdEditor";
import {
  fetchWebpage,
  searchWithCache,
} from "../lib/search";
import { SettingsTab, type AgentSettingsProps } from "./SettingsTab";
import {
  saveKbNotes,
  saveKbSelections,
  getKbSelections,
  loadKbOptions,
  downloadText,
  loadEditorDrafts,
  addEditorDraft,
  removeEditorDraft,
  type KbSelections,
  type KbDraft,
} from "../lib/kb";

// ===== Types =====
interface KbEntry {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

const KB_KEY = "kimo_kb_entries";
function loadEntries(): KbEntry[] {
  try {
    const r = localStorage.getItem(KB_KEY);
    if (r) return JSON.parse(r);
  } catch {}
  try {
    const prompts = JSON.parse(
      localStorage.getItem("kimo_agent_prompts") || "[]",
    );
    const notes = JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]");
    const merged: KbEntry[] = [
      ...prompts.map((p: Record<string, unknown>) => ({
        id: "p_" + p.createdAt,
        name: (p.name as string) || "",
        content: p.content as string,
        createdAt: p.createdAt as number,
      })),
      ...notes.map((n: Record<string, unknown>) => ({
        id: n.id as string,
        name: (n.title as string) || "",
        content: n.content as string,
        createdAt: n.createdAt as number,
      })),
    ];
    if (merged.length) {
      localStorage.setItem(KB_KEY, JSON.stringify(merged));
      localStorage.removeItem("kimo_agent_prompts");
    }
    return merged;
  } catch {
    return [];
  }
}
function persist(e: KbEntry[]) {
  try {
    localStorage.setItem(KB_KEY, JSON.stringify(e));
  } catch {}
}

export function AgentPanel({
  onClose,
  initUrl,
  initTab,
  initEditContent,
  lastAssistantContent,
  pageId,
  memory,
  onMemoryChange,
  onKbChanged,
  settings,
  kbOpen,
  onKbOpenConsumed,
}: {
  onClose: () => void;
  initUrl?: string;
  initTab?: "web" | "kb" | "edit" | "settings";
  initEditContent?: string;
  lastAssistantContent?: string;
  pageId: number;
  memory?: string;
  onMemoryChange?: (m: string) => void;
  onKbChanged?: () => void;
  settings?: AgentSettingsProps;
  kbOpen?: {
    nonce: number;
    entry: { id: string; name: string; content: string; createdAt: number };
  };
  onKbOpenConsumed?: () => void;
}) {
  const [tab, setTab] = useState<"web" | "kb" | "edit" | "settings">(
    initTab || (initUrl ? "web" : "kb"),
  );
  const [webUrl, setWebUrl] = useState(initUrl || "");
  const [webLoading, setWebLoading] = useState(false);
  const [webContent, setWebContent] = useState("");
  /** AI 综合筛选后生成的 markdown 文章（含图片/分节/来源） */
  const [articleMd, setArticleMd] = useState("");
  const [articleLoading, setArticleLoading] = useState(false);
  /** 本次结果是否来自历史缓存 */
  const [fromCache, setFromCache] = useState(false);
  const [mdContent, setMdContent] = useState(initEditContent || "");
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  // KB
  const [entries, setEntries] = useState<KbEntry[]>(loadEntries);
  const [sel, setSel] = useState<KbSelections>(() => getKbSelections(pageId));
  const [allArticles, setAllArticles] = useState<
    { id: number; title: string; category_name?: string | null }[]
  >([]);
  const [allCategories, setAllCategories] = useState<
    { id: number; name: string; slug: string }[]
  >([]);
  const [kbSiteLoading, setKbSiteLoading] = useState(true);
  const [kbSiteOpen, setKbSiteOpen] = useState(false);
  const [kbAiReadAll, setKbAiReadAll] = useState(() => {
    try {
      return localStorage.getItem("kimo_kb_ai_read_all") !== "0";
    } catch {
      return true;
    }
  });
  const [draftWordCount, setDraftWordCount] = useState(0);
  const [draftSaved, setDraftSaved] = useState(true);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftContentRef = useRef("");
  const draftKey = "kimo_editor_draft";

  // 恢复草稿 + beforeunload 防丢失
  useEffect(() => {
    try {
      const d = localStorage.getItem(draftKey);
      if (d && !mdContent) setMdContent(d);
    } catch {}
    const onBefore = () => {
      try {
        if (draftContentRef.current.trim())
          localStorage.setItem(draftKey, draftContentRef.current);
      } catch {}
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  // 同步 mdContent 到 ref（避免 beforeunload 重复注册）
  useEffect(() => {
    draftContentRef.current = mdContent;
  }, [mdContent]);

  // 自动保存草稿（1.5s 防抖）
  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setDraftSaved(false);
    setDraftWordCount(mdContent.replace(/\s/g, "").length);
    draftTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, mdContent);
      } catch {}
      setDraftSaved(true);
    }, 1500);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [mdContent]);
  const [activeEntry, setActiveEntry] = useState<KbEntry | null>(null);

  // 编辑器临时草稿（存草稿/恢复/删除）
  const [drafts, setDrafts] = useState<KbDraft[]>(loadEditorDrafts);
  const [showDraftMenu, setShowDraftMenu] = useState(false);
  const draftMenuRef = useRef<HTMLDivElement>(null);

  // Memory
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Auto-detect
  useEffect(() => {
    if (!lastAssistantContent) return;
    const u = lastAssistantContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
    if (u) {
      setWebUrl(u[0]);
      setTab("web");
      return;
    }
    const cb = lastAssistantContent.match(/```[\s\S]*?```/);
    if (cb) {
      setMdContent(cb[0]);
      setTab("edit");
    }
  }, [lastAssistantContent]);

  // 响应 AI 工具调用：切换 tab / 填入编辑内容（面板已挂载时也生效）
  useEffect(() => {
    if (initTab) setTab(initTab);
    if (initEditContent != null) {
      setMdContent(initEditContent);
      setActiveEntry(null);
    }
  }, [initTab, initEditContent]);

  // AI 创建/编辑知识库：AIChat 已通过 kb.ts 写入存储，这里仅展示到编辑器并刷新列表
  useEffect(() => {
    if (!kbOpen) return;
    setEntries(loadEntries());
    const { entry } = kbOpen;
    if (entry && (entry.name.trim() || entry.content.trim())) {
      setActiveEntry({
        id: entry.id,
        name: entry.name,
        content: entry.content,
        createdAt: entry.createdAt,
      });
      setMdContent(entry.content);
      setTab("edit");
    }
    onKbOpenConsumed?.();
  }, [kbOpen]);

  // 草稿菜单点击外部关闭
  useEffect(() => {
    if (!showDraftMenu) return;
    const h = (e: MouseEvent) => {
      if (
        draftMenuRef.current &&
        !draftMenuRef.current.contains(e.target as Node)
      )
        setShowDraftMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showDraftMenu]);

  // KB site load
  useEffect(() => {
    loadKbOptions()
      .then((o) => {
        setAllArticles(
          o.articles.map((a) => ({
            id: a.id,
            title: a.title,
            category_name: a.category_name,
          })),
        );
        setAllCategories(
          o.categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
        );
      })
      .catch(() => {})
      .finally(() => setKbSiteLoading(false));
  }, []);

  // Sync entries
  useEffect(() => {
    saveKbNotes(
      entries.map((e) => ({
        id: e.id,
        title: e.name,
        content: e.content,
        createdAt: e.createdAt,
      })),
    );
  }, [entries]);

  // Close export menu
  useEffect(() => {
    if (!showExportMenu) return;
    const h = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showExportMenu]);

  // ---- Drag: document-level ----
  const dc = useRef(0);
  useEffect(() => {
    const onE = (e: DragEvent) => {
      e.preventDefault();
      dc.current++;
      if (dc.current === 1) setDragOver(true);
    };
    const onO = (e: DragEvent) => {
      e.preventDefault();
    };
    const onL = () => {
      dc.current--;
      if (dc.current <= 0) {
        dc.current = 0;
        setDragOver(false);
      }
    };
    const onD = (e: DragEvent) => {
      e.preventDefault();
      dc.current = 0;
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        setMdContent((p) => (p ? p + "\n\n" : "") + String(r.result || ""));
        setTab("edit");
      };
      r.readAsText(f);
    };
    document.addEventListener("dragenter", onE);
    document.addEventListener("dragover", onO);
    document.addEventListener("dragleave", onL);
    document.addEventListener("drop", onD);
    return () => {
      document.removeEventListener("dragenter", onE);
      document.removeEventListener("dragover", onO);
      document.removeEventListener("dragleave", onL);
      document.removeEventListener("drop", onD);
    };
  }, []);

  // ---- Site selection ----
  const persistSel = (next: KbSelections) => {
    setSel(next);
    saveKbSelections(pageId, next);
    saveKbNotes(
      entries.map((e) => ({
        id: e.id,
        title: e.name,
        content: e.content,
        createdAt: e.createdAt,
      })),
    );
    onKbChanged?.();
  };
  const toggleArticle = (id: number) =>
    persistSel({
      ...sel,
      articleIds: sel.articleIds.includes(id)
        ? sel.articleIds.filter((x) => x !== id)
        : [...sel.articleIds, id],
    });
  const toggleCategory = (id: number) =>
    persistSel({
      ...sel,
      categoryIds: sel.categoryIds.includes(id)
        ? sel.categoryIds.filter((x) => x !== id)
        : [...sel.categoryIds, id],
    });

  // ---- Entry CRUD ----
  const saveEntry = () => {
    if (!mdContent.trim()) return;
    setSaving(true);
    const e: KbEntry = {
      id: "e_" + Date.now(),
      name: mdContent.trim().slice(0, 60),
      content: mdContent.trim(),
      createdAt: Date.now(),
    };
    setEntries((prev) => {
      const nx = [e, ...prev];
      persist(nx);
      saveKbNotes(
        nx.map((x) => ({
          id: x.id,
          title: x.name,
          content: x.content,
          createdAt: x.createdAt,
        })),
      );
      return nx;
    });
    onKbChanged?.();
    setTimeout(() => setSaving(false), 600);
  };
  const deleteEntry = (id: string) => {
    setEntries((prev) => {
      const nx = prev.filter((x) => x.id !== id);
      persist(nx);
      saveKbNotes(
        nx.map((x) => ({
          id: x.id,
          title: x.name,
          content: x.content,
          createdAt: x.createdAt,
        })),
      );
      return nx;
    });
    if (activeEntry?.id === id) {
      setActiveEntry(null);
      setMdContent("");
    }
    onKbChanged?.();
  };
  const updateEntry = (content: string) => {
    if (!activeEntry) return;
    const u = { ...activeEntry, content };
    setActiveEntry(u);
    setEntries((prev) => {
      const nx = prev.map((e) => (e.id === activeEntry.id ? u : e));
      persist(nx);
      saveKbNotes(
        nx.map((x) => ({
          id: x.id,
          title: x.name,
          content: x.content,
          createdAt: x.createdAt,
        })),
      );
      return nx;
    });
  };
  const saveMemoryToKb = () => {
    if (!memory?.trim()) return;
    const e: KbEntry = {
      id: "m_" + Date.now(),
      name: "AI记忆 " + new Date().toLocaleDateString("zh-CN"),
      content: memory.trim(),
      createdAt: Date.now(),
    };
    setEntries((prev) => {
      const nx = [e, ...prev];
      persist(nx);
      saveKbNotes(
        nx.map((x) => ({
          id: x.id,
          title: x.name,
          content: x.content,
          createdAt: x.createdAt,
        })),
      );
      return nx;
    });
    onKbChanged?.();
  };

  // ---- 编辑器临时草稿 / 清空 ----
  const saveDraft = () => {
    if (!mdContent.trim()) return;
    setDrafts(addEditorDraft(mdContent));
    setShowDraftMenu(false);
  };
  const restoreDraft = (d: KbDraft) => {
    setActiveEntry(null);
    setMdContent(d.content);
    setTab("edit");
    setShowDraftMenu(false);
  };
  const deleteDraft = (id: string) => {
    setDrafts(removeEditorDraft(id));
  };
  const clearEditor = () => {
    const hasContent =
      (mdContent || "").trim() || (activeEntry?.content || "").trim();
    if (!hasContent) return;
    if (!window.confirm("确定清空当前编辑内容？")) return;
    if (activeEntry) updateEntry("");
    else setMdContent("");
  };

  // ---- Export/Import ----
  const exportJSON = () => {
    downloadText(
      "kb-" + new Date().toISOString().slice(0, 10) + ".json",
      JSON.stringify({ app: "kimo-kb", version: 1, entries }, null, 2),
    );
    setShowExportMenu(false);
  };
  const exportMD = () => {
    downloadText(
      "kb-" + new Date().toISOString().slice(0, 10) + ".md",
      entries
        .map((e) => "# " + e.name + "\n\n" + e.content + "\n\n---")
        .join("\n\n"),
    );
    setShowExportMenu(false);
  };
  const importJSON = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(String(r.result || ""));
        const arr: KbEntry[] = Array.isArray(d.entries)
          ? d.entries
          : Array.isArray(d)
            ? d
            : [];
        if (!arr.length) return alert("无有效条目");
        setEntries((prev) => {
          const nx = [...arr, ...prev];
          persist(nx);
          saveKbNotes(
            nx.map((x) => ({
              id: x.id,
              title: x.name,
              content: x.content,
              createdAt: x.createdAt,
            })),
          );
          return nx;
        });
        onKbChanged?.();
      } catch {
        alert("格式不正确");
      }
    };
    r.readAsText(f);
    ev.target.value = "";
  };

  // ---- Browse（带历史缓存：命中直接展示，未命中生成后自动保存）----
  const browse = async (q?: string) => {
    const u = (q ?? webUrl).trim();
    if (!u) return;
    setWebContent("");
    setWebLoading(true);
    setArticleMd("");
    setArticleLoading(false);
    // 关键词搜索（复用，含缓存读取）
    const runKeyword = async (kw: string) => {
      setWebUrl(kw);
      const r = await searchWithCache(kw, { maxSources: 3, perSourceChars: 2500 });
      setFromCache(!!r.cached);
      setWebContent(r.content || "未找到结果");
      setArticleMd(r.article || "");
      setArticleLoading(r.loading || false);
    };
    try {
      if (/^https?:\/\//i.test(u)) {
        // 搜索引擎 URL（如 google/bing/duckduckgo）→ 提取 q 参数转关键词搜索
        const lower = u.toLowerCase();
        if (
          lower.includes("google.") ||
          lower.includes("bing.com") ||
          lower.includes("duckduckgo") ||
          lower.includes("baidu.com")
        ) {
          try {
            const qp = new URL(u).searchParams.get("q");
            if (qp) {
              await runKeyword(qp);
              return;
            }
          } catch {}
        }
        setWebUrl(u);
        const text = await fetchWebpage(u);
        if (text) {
          setWebContent(text);
        } else {
          // URL 抓取失败（如搜索引擎 CORS 拦截）时回退为关键词搜索
          let q2 = u;
          try {
            const url = new URL(u);
            const qp = url.searchParams.get("q");
            if (qp) q2 = qp;
            else q2 = url.hostname.replace(/^www\./i, "");
          } catch {
            q2 = u
              .replace(/^https?:\/\//i, "")
              .replace(/^www\./i, "")
              .replace(/\/.*$/, "");
          }
          await runKeyword(q2);
        }
      } else if (
        /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+\.?$/.test(u)
      ) {
        // 纯域名（不含空格）才按网址抓取，否则按关键词搜索
        const full = "https://" + u;
        setWebUrl(full);
        const text = await fetchWebpage(full);
        setWebContent(text || "无法获取内容");
      } else {
        // 关键词搜索：抓取多个结果正文 + AI 综合文章，带历史缓存
        await runKeyword(u);
      }
    } catch {
      setWebContent("搜索失败");
    } finally {
      setWebLoading(false);
    }
  };

  // AI 触发搜索/浏览时自动执行（[SEARCH:] / [BROWSE:]）
  useEffect(() => {
    if (initUrl) {
      setTab("web");
      setWebUrl(initUrl);
      setWebContent("");
      browse(initUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initUrl]);

  /** 解析浏览结果：拆分为「搜索结果」列表与「来源内容」块 */
  const parseBrowseContent = (content: string) => {
    const srcIdx = content.indexOf("【来源内容");
    const resultsText = srcIdx >= 0 ? content.slice(0, srcIdx) : content;
    const sourcesText = srcIdx >= 0 ? content.slice(srcIdx) : "";
    // 解析搜索结果行
    const results = resultsText
      .split(/\n(?=(?:-\s|\d+[.、)]\s))/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const urlM = line.match(/https?:\/\/[^\s)\]】>]+/);
        const href = urlM ? urlM[0].replace(/[)\]】>]+$/, "") : "";
        const title = line
          .replace(/^(?:-\s|\d+[.、)]\s+)/, "")
          .replace(/\*\*/g, "")
          .replace(/\s*https?:\/\/[^\s)\]】>]+/, " ")
          .split("\n")[0]
          .trim()
          .replace(/[\s()）【】]+$/g, "");
        const desc = line
          .split("\n")
          .slice(1)
          .join(" ")
          .replace(/\*\*/g, "")
          .replace(/\s+/g, " ")
          .trim();
        let host = "";
        try {
          host = href ? new URL(href).hostname.replace(/^www\./i, "") : "";
        } catch {}
        return { title, href, desc, host };
      })
      .filter((r) => r.title || r.href);
    return { results, sourcesText };
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors";

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-gray-900">
      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm pointer-events-none">
          <div className="rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-gray-800">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              释放文件到编辑器
            </p>
            <p className="mt-1 text-xs text-gray-400">.md / .txt</p>
          </div>
        </div>
      )}

      {/* Header：知识库 / 设置（浏览与编辑器由 AI 指令或知识库入口进入） */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          <button
            onClick={() => setTab("kb")}
            className={
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (tab === "kb"
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300")
            }
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
            知识库
          </button>
          <button
            onClick={() => setTab("settings")}
            className={
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (tab === "settings"
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300")
            }
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            设置
          </button>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* TAB 1: Browse（美化版：搜索栏 + 结果卡片 + 来源折叠 + AI 文章） */}
      {tab === "web" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 顶部搜索栏 */}
          <div className="shrink-0 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-2.5 py-1.5 transition focus-within:ring-2 focus-within:ring-gray-300 dark:bg-gray-800 dark:focus-within:ring-gray-600">
              <svg
                className="h-4 w-4 shrink-0 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
              <input
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") browse();
                }}
                placeholder="输入网址或关键词，AI 联网搜索…"
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500"
              />
              <button
                onClick={() => browse()}
                disabled={webLoading}
                className="shrink-0 rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
              >
                {webLoading ? "…" : "搜索"}
              </button>
            </div>
            {fromCache && !webLoading && webContent && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 6v6l4 2" />
                </svg>
                已加载历史记录（无需重新搜索）
              </div>
            )}
          </div>

          {/* 内容滚动区 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* 空态 */}
            {!webLoading && !webContent && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                  <svg
                    className="h-7 w-7 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 014 10" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    搜索或浏览网页
                  </p>
                  <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-gray-400">
                    输入网址抓取正文，或输入关键词让 AI 多引擎搜索并生成综合文章
                  </p>
                </div>
              </div>
            )}
            {/* 加载中 */}
            {webLoading && (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <div className="flex gap-1.5">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                  <span
                    className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
                <span className="text-xs text-gray-400">
                  正在搜索并抓取资料…
                </span>
              </div>
            )}
            {/* 结果 */}
            {webContent && !webLoading && (
              <div className="space-y-3">
                {parseBrowseContent(webContent).results.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                      </svg>
                      搜索结果 · {parseBrowseContent(webContent).results.length}
                    </div>
                    {parseBrowseContent(webContent).results.map((r, i) => (
                      <a
                        key={i}
                        href={r.href || "#"}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          if (!r.href) e.preventDefault();
                        }}
                        className="group block rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-600"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gray-100 text-[11px] font-bold text-gray-500 transition group-hover:bg-blue-50 group-hover:text-blue-500 dark:bg-gray-800 dark:text-gray-400 dark:group-hover:bg-blue-900/30 dark:group-hover:text-blue-400">
                            {r.host ? r.host[0].toUpperCase() : "W"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-800 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
                              {r.title || r.href}
                            </p>
                            {r.desc && (
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                {r.desc}
                              </p>
                            )}
                            <p className="mt-1.5 truncate text-[10px] text-gray-400">
                              {r.href}
                            </p>
                          </div>
                          <svg
                            className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-300 transition group-hover:text-blue-500 dark:text-gray-600"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6v6m-11 5L20 4"
                            />
                          </svg>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
                {/* 来源内容折叠 */}
                {parseBrowseContent(webContent).sourcesText && (
                  <details className="group rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                      <svg
                        className="h-3.5 w-3.5 text-gray-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                        />
                      </svg>
                      来源内容
                      <svg
                        className="h-3 w-3 text-gray-400 transition group-open:rotate-90"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </summary>
                    <div className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-gray-100 px-3 py-2.5 text-xs leading-relaxed text-gray-600 dark:border-gray-800 dark:text-gray-300">
                      {parseBrowseContent(webContent).sourcesText}
                    </div>
                  </details>
                )}
                {/* 兜底：普通文本 */}
                {parseBrowseContent(webContent).results.length === 0 && (
                  <div className="whitespace-pre-wrap break-words rounded-2xl border border-gray-100 bg-white p-3 text-sm leading-relaxed text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                    {webContent}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* AI 综合文章（标准 markdown，含图片/分节/来源） */}
          {(articleMd || articleLoading) && !webLoading && (
            <div className="shrink-0 border-t border-gray-100 px-3 py-3 dark:border-gray-800">
              <div className="mb-2 flex items-center gap-1.5">
                <svg
                  className="h-4 w-4 text-gray-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                  />
                </svg>
                <span className="text-xs font-semibold text-gray-500">
                  AI 综合文章
                </span>
                <div className="flex-1" />
                {articleMd && (
                  <button
                    onClick={() => {
                      setMdContent(articleMd);
                      setActiveEntry(null);
                      setTab("edit");
                    }}
                    className="rounded-full bg-gray-900 px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
                  >
                    在编辑器中打开
                  </button>
                )}
              </div>
              {articleLoading ? (
                <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-4 text-xs text-gray-400 dark:bg-gray-800/40">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
                  AI 正在筛选资料并生成文章…
                </div>
              ) : (
                articleMd && (
                  <div className="chat-md max-h-[50vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {articleMd}
                    </ReactMarkdown>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Knowledge Base */}
      {tab === "kb" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Site sources */}
          <div className="shrink-0 border-b border-gray-50 dark:border-gray-800">
            <button
              onClick={() => setKbSiteOpen(!kbSiteOpen)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <svg
                className={
                  "h-3 w-3 transition " + (kbSiteOpen ? "rotate-90" : "")
                }
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" d="M9 5l7 7-7 7" />
              </svg>
              {"站点内容源 (文章" +
                sel.articleIds.length +
                " · 分类" +
                sel.categoryIds.length +
                ")"}
            </button>
            {kbSiteOpen && (
              <div className="px-3 pb-2 max-h-40 overflow-y-auto">
                {kbSiteLoading ? (
                  <p className="text-[11px] text-gray-400">加载中...</p>
                ) : (
                  <>
                    {allCategories.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {allCategories.map((c) => (
                          <label
                            key={c.id}
                            className={
                              "cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition " +
                              (sel.categoryIds.includes(c.id)
                                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900"
                                : "border-gray-200 text-gray-500 hover:border-gray-400")
                            }
                          >
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={sel.categoryIds.includes(c.id)}
                              onChange={() => toggleCategory(c.id)}
                            />
                            {c.name}
                          </label>
                        ))}
                      </div>
                    )}
                    {allArticles.length > 0 && (
                      <div className="space-y-0.5">
                        {allArticles.map((a) => (
                          <label
                            key={a.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            <input
                              type="checkbox"
                              checked={sel.articleIds.includes(a.id)}
                              onChange={() => toggleArticle(a.id)}
                              className="h-3 w-3 accent-gray-900"
                            />
                            <span className="truncate">{a.title}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {/* AI Memory */}
          {memory !== undefined && onMemoryChange && (
            <div className="shrink-0 border-b border-gray-50 dark:border-gray-800">
              <button
                onClick={() => {
                  if (editingMemory) {
                    onMemoryChange(memoryDraft);
                  } else {
                    setMemoryDraft(memory || "");
                  }
                  setEditingMemory(!editingMemory);
                }}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                  />
                </svg>
                AI记忆 (
                {memory
                  ? memory.split("\n").filter(Boolean).length + "条"
                  : "空"}
                )
                <div className="flex-1" />
                {memory?.trim() && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      saveMemoryToKb();
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    存入KB
                  </span>
                )}
              </button>
              {editingMemory && (
                <div className="px-3 pb-2">
                  <textarea
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    placeholder="AI自动学习的偏好..."
                  />
                </div>
              )}
            </div>
          )}
          {/* Entries */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-50 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500">
                  知识条目 · {entries.length}条
                </span>
                <button
                  onClick={() => {
                    setActiveEntry(null);
                    setMdContent("");
                    setTab("edit");
                  }}
                  className="flex items-center gap-1 rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
                  title="新建知识条目"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                  </svg>
                  新建
                </button>
                <button
                  onClick={() => {
                    setTab("web");
                    setWebContent("");
                  }}
                  className="flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500 transition hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  title="浏览网页"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15.3 15.3 0 014 10" />
                  </svg>
                  浏览
                </button>
                <button
                  onClick={() => {
                    const v = !kbAiReadAll;
                    setKbAiReadAll(v);
                    localStorage.setItem("kimo_kb_ai_read_all", v ? "1" : "0");
                    onKbChanged?.();
                  }}
                  className={
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition " +
                    (kbAiReadAll
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500")
                  }
                  title={
                    kbAiReadAll ? "AI 正在读取全部知识" : "AI 不读取知识库"
                  }
                >
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (kbAiReadAll ? "bg-green-500" : "bg-gray-400")
                    }
                  />
                  AI读取{kbAiReadAll ? "中" : "关"}
                </button>
              </div>
              <div className="relative" ref={exportRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="text-[10px] text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className="inline h-3 w-3 mr-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  导出/导入
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <button
                      onClick={exportJSON}
                      className="flex w-full px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      JSON
                    </button>
                    <button
                      onClick={exportMD}
                      className="flex w-full px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Markdown
                    </button>
                    <div className="border-t border-gray-100 dark:border-gray-800" />
                    <label className="flex cursor-pointer px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
                      导入JSON
                      <input
                        type="file"
                        accept=".json"
                        onChange={importJSON}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
            {entries.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-gray-400">
                在编辑器中编写内容后点击"存为知识"
              </p>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => {
                    setActiveEntry(entry);
                    setMdContent("");
                    setTab("edit");
                  }}
                  className={
                    "group flex cursor-pointer items-center gap-2 border-b border-gray-50 px-3 py-2.5 text-xs hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 " +
                    (activeEntry?.id === entry.id
                      ? "bg-gray-100 dark:bg-gray-800/70"
                      : "")
                  }
                >
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
                    {entry.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {new Date(entry.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteEntry(entry.id);
                    }}
                    className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Editor（编辑器填满面板剩余空间） */}
      {tab === "edit" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {activeEntry ? (
            <>
              <div className="flex flex-none items-center gap-2 border-b border-gray-50 px-3 py-1.5 dark:border-gray-800">
                <button
                  onClick={() => {
                    setActiveEntry(null);
                    setMdContent("");
                  }}
                  className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" d="M19 12H5m7-7l-7 7 7 7" />
                  </svg>
                </button>
                <span className="truncate text-xs font-medium text-gray-600 dark:text-gray-300">
                  {activeEntry.name}
                </span>
              </div>
              <MdEditor
                value={activeEntry.content}
                onChange={updateEntry}
                height="fill"
                placeholder="在此编辑内容…"
                aiPolish={false}
                showStatusBar={false}
                rounded={false}
              />
            </>
          ) : (
            <MdEditor
              value={mdContent}
              onChange={setMdContent}
              height="fill"
              placeholder="在此输入内容…"
              aiPolish={false}
              showStatusBar={false}
              rounded={false}
            />
          )}
          <div className="flex flex-none items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5 dark:border-gray-800">
            <span className="min-w-0 truncate text-[10px] text-gray-400">
              {mdContent ? `${draftWordCount} 字` : "Markdown 格式"}
              <span className="ml-1.5">
                {draftSaved ? (
                  <span className="text-green-500">已保存</span>
                ) : (
                  <span className="text-amber-400">保存中</span>
                )}
              </span>
            </span>
            <div className="flex items-center gap-0.5">
              {/* 草稿菜单（保存当前为草稿 + 草稿列表） */}
              <div className="relative" ref={draftMenuRef}>
                <button
                  onClick={() => setShowDraftMenu((v) => !v)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                  title="草稿"
                  aria-label="草稿"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                    />
                  </svg>
                  {drafts.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-gray-900 px-0.5 text-[8px] font-medium text-white dark:bg-gray-200 dark:text-gray-900">
                      {drafts.length}
                    </span>
                  )}
                </button>
                {showDraftMenu && (
                  <div className="absolute bottom-full right-0 z-20 mb-1 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <button
                      onClick={saveDraft}
                      disabled={!mdContent.trim()}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path
                          strokeLinecap="round"
                          d="M12 4.5v15m7.5-7.5h-15"
                        />
                      </svg>
                      保存当前为草稿
                    </button>
                    <div className="border-t border-gray-100 dark:border-gray-800" />
                    {drafts.length === 0 ? (
                      <p className="px-3 py-2 text-[11px] text-gray-400">
                        暂无草稿
                      </p>
                    ) : (
                      <div className="max-h-44 overflow-y-auto py-1">
                        {drafts.map((d) => (
                          <div
                            key={d.id}
                            className="group flex items-center px-1"
                          >
                            <button
                              onClick={() => restoreDraft(d)}
                              className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[11px] text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                              title={d.content.slice(0, 80)}
                            >
                              {d.name}
                            </button>
                            <button
                              onClick={() => deleteDraft(d.id)}
                              className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                              title="删除草稿"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* 清空 */}
              <button
                onClick={clearEditor}
                className="grid h-7 w-7 place-items-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                title="清空"
                aria-label="清空"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
              {/* 存为知识（主操作） */}
              {!activeEntry && (
                <button
                  onClick={saveEntry}
                  disabled={!mdContent.trim() || saving}
                  className={
                    btn +
                    " ml-1 bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
                  }
                >
                  {saving ? (
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  )}
                  {saving ? "保存中" : "存为知识"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Settings（用户设置迁入 Agent 面板） */}
      {tab === "settings" &&
        (settings ? (
          <SettingsTab {...settings} />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-xs text-gray-400">
            设置暂不可用
          </div>
        ))}
    </div>
  );
}
