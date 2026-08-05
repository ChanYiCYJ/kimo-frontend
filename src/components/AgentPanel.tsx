import { useState, useEffect, useRef } from "react";
import { MdEditor } from "./MdEditor";
import { fetchWebpage, webSearch } from "../lib/search";
import { SettingsTab, type AgentSettingsProps } from "./SettingsTab";
import {
  saveKbNotes,
  saveKbSelections,
  getKbSelections,
  loadKbOptions,
  downloadText,
  type KbSelections,
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
}) {
  const [tab, setTab] = useState<"web" | "kb" | "edit" | "settings">(
    initTab || (initUrl ? "web" : "kb"),
  );
  const [webUrl, setWebUrl] = useState(initUrl || "");
  const [webLoading, setWebLoading] = useState(false);
  const [webContent, setWebContent] = useState("");
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

  // ---- Browse ----
  const browse = async (q?: string) => {
    const u = (q ?? webUrl).trim();
    if (!u) return;
    setWebContent("");
    setWebLoading(true);
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
              setWebUrl(qp);
              const result = await webSearch(qp);
              setWebContent(result || "未找到结果");
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
          const result = await webSearch(q2);
          setWebContent(result || "无法获取内容");
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
        setWebUrl(u);
        const result = await webSearch(u);
        setWebContent(result || "未找到结果");
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

  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const h = isMobile
    ? Math.min(340, Math.max(180, window.innerHeight - 340))
    : Math.max(360, window.innerHeight - 260);
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

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          <button
            onClick={() => setTab("web")}
            className={
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (tab === "web"
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
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10" />
            </svg>
            浏览
          </button>
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
            onClick={() => setTab("edit")}
            className={
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (tab === "edit"
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
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
              />
            </svg>
            编辑器
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

      {/* TAB 1: Browse */}
      {tab === "web" && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          {!webLoading && !webContent && (
            <>
              <svg
                className="h-12 w-12 text-gray-300 dark:text-gray-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  需要搜索或浏览网页？
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  直接在对话中告诉 AI，比如「帮我搜索 Vue.js 最新特性」
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  AI 会自动执行搜索并在这里展示结果
                </p>
              </div>
            </>
          )}
          {webLoading && (
            <div className="flex flex-col items-center gap-2">
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
              <span className="text-xs text-gray-400">正在搜索…</span>
            </div>
          )}
          {webContent && !webLoading && (
            <div className="w-full text-left">
              <div className="max-h-[60vh] overflow-y-auto p-1">
                <div className="space-y-2.5">
                  {webContent
                    .split(/\n(?=(?:-\s|\d+[.、)]\s))/)
                    .map((item, i) => {
                      const t = item.trim();
                      if (!t) return null;
                      // 兼容多种格式：- Title (URL) / 1. **Title**\n URL\n desc
                      const urlM = t.match(/https?:\/\/[^\s)\]】>]+/);
                      const href = urlM
                        ? urlM[0].replace(/[)\]】>]+$/, "")
                        : "#";
                      const title = t
                        .replace(/^(?:-\s|\d+[.、)]\s+)/, "")
                        .replace(/\*\*/g, "")
                        .replace(/\s*https?:\/\/[^\s)\]】>]+/, " ")
                        .split("\n")[0]
                        .trim()
                        .replace(/[\s()）【】]+$/g, "")
                        .slice(0, 80);
                      const desc = t
                        .split("\n")
                        .slice(1)
                        .join(" ")
                        .replace(/\*\*/g, "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 220);
                      if (title || href !== "#")
                        return (
                          <a
                            key={i}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              if (href === "#") e.preventDefault();
                            }}
                            className="card card-hover group block rounded-2xl p-3"
                          >
                            <div className="flex items-start gap-2.5">
                              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-400 transition group-hover:bg-blue-50 group-hover:text-blue-500 dark:bg-gray-800 dark:text-gray-500 dark:group-hover:bg-blue-900/30 dark:group-hover:text-blue-400">
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
                                    d="M12 21a9 9 0 100-18 9 9 0 000 18zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"
                                  />
                                </svg>
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-gray-800 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
                                  {title || href}
                                </p>
                                {desc && (
                                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                    {desc}
                                  </p>
                                )}
                                <p className="mt-1.5 truncate text-[10px] text-gray-400">
                                  {href}
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
                        );
                      return (
                        <div
                          key={i}
                          className="card rounded-2xl whitespace-pre-wrap break-words p-3 text-sm text-gray-600 dark:text-gray-300"
                        >
                          {item}
                        </div>
                      );
                    })}
                </div>
              </div>
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
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-50 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-gray-500">
                  知识条目 · {entries.length}条
                </span>
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

      {/* TAB 3: Editor */}
      {tab === "edit" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 min-h-0">
            {activeEntry ? (
              <>
                <div className="flex items-center gap-2 border-b border-gray-50 px-3 py-1.5 dark:border-gray-800">
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
                  height={h}
                  placeholder="编辑知识条目..."
                  aiPolish={false}
                  showStatusBar={false}
                  rounded={false}
                />
              </>
            ) : (
              <MdEditor
                value={mdContent}
                onChange={setMdContent}
                height={h}
                placeholder="编写内容..."
                aiPolish={false}
                showStatusBar={false}
                rounded={false}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-gray-800">
            <span className="text-[10px] text-gray-400">
              {mdContent ? `${draftWordCount} 字` : "Markdown 格式"}
              <span className="ml-1.5 inline-flex items-center gap-1">
                {draftSaved ? (
                  <span className="text-green-500">● 已保存</span>
                ) : (
                  <span className="text-amber-400">○ 保存中</span>
                )}
              </span>
            </span>
            {!activeEntry && (
              <button
                onClick={saveEntry}
                disabled={!mdContent.trim() || saving}
                className={
                  btn +
                  " bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
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
