import { useState, useEffect, useRef } from "react";
import { MdEditor } from "./MdEditor";
import { fetchWebpage } from "../lib/search";
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

// ===== Persistence: unified kb entries =====
const KB_ENTRIES_KEY = "kimo_kb_entries";

function loadEntries(): KbEntry[] {
  try {
    const r = localStorage.getItem(KB_ENTRIES_KEY);
    if (r) return JSON.parse(r);
  } catch {}
  // Migrate old separated data
  try {
    const oldPrompts = JSON.parse(
      localStorage.getItem("kimo_agent_prompts") || "[]",
    );
    const oldNotes = JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]");
    const merged: KbEntry[] = [
      ...oldPrompts.map(
        (p: { name: string; content: string; createdAt: number }) => ({
          id: "p_" + p.createdAt,
          name: p.name || "未命名提示词",
          content: p.content,
          createdAt: p.createdAt,
        }),
      ),
      ...oldNotes.map(
        (n: {
          id: string;
          title: string;
          content: string;
          createdAt: number;
        }) => ({
          id: n.id,
          name: n.title || "无标题笔记",
          content: n.content,
          createdAt: n.createdAt,
        }),
      ),
    ];
    if (merged.length) {
      localStorage.setItem(KB_ENTRIES_KEY, JSON.stringify(merged));
      localStorage.removeItem("kimo_agent_prompts");
    }
    return merged;
  } catch {
    return [];
  }
}

function persistEntries(e: KbEntry[]) {
  try {
    localStorage.setItem(KB_ENTRIES_KEY, JSON.stringify(e));
  } catch {}
}

// ===== Component =====
export function AgentPanel({
  onClose,
  onInsertMessage,
  initUrl,
  lastAssistantContent,
  onExport,
  onUpload,
  onArticle,
  enableArticles,
  messagesLength,
  pageId,
  memory,
  onMemoryChange,
  onKbChanged,
}: {
  onClose: () => void;
  onInsertMessage: (t: string) => void;
  initUrl?: string;
  lastAssistantContent?: string;
  onExport?: () => void;
  onUpload?: () => void;
  onArticle?: () => void;
  enableArticles?: boolean;
  messagesLength?: number;
  pageId: number;
  memory?: string;
  onMemoryChange?: (m: string) => void;
  onKbChanged?: () => void;
}) {
  const [tab, setTab] = useState<"web" | "kb">(initUrl ? "web" : "kb");
  const [webUrl, setWebUrl] = useState(initUrl || "");
  const [webLoading, setWebLoading] = useState(false);
  const [webContent, setWebContent] = useState("");
  const [mdContent, setMdContent] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Knowledge base
  const [entries, setEntries] = useState<KbEntry[]>(loadEntries);
  const [sel, setSel] = useState<KbSelections>(() => getKbSelections(pageId));
  const [allArticles, setAllArticles] = useState<
    { id: number; title: string; category_name?: string | null }[]
  >([]);
  const [allCategories, setAllCategories] = useState<
    { id: number; name: string; slug: string }[]
  >([]);
  const [kbLoading, setKbLoading] = useState(true);
  const [kbExpanded, setKbExpanded] = useState(false);
  const [activeEntry, setActiveEntry] = useState<KbEntry | null>(null);

  // AI Memory
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");

  // Export menu
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // AI auto-detect
  useEffect(() => {
    if (!lastAssistantContent) return;
    const m = lastAssistantContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
    if (m) {
      setWebUrl(m[0]);
      setTab("web");
      return;
    }
    const cb = lastAssistantContent.match(/```[\s\S]*?```/);
    if (cb) {
      setMdContent(cb[0]);
      setTab("kb");
    }
  }, [lastAssistantContent]);

  // KB load
  useEffect(() => {
    setKbLoading(true);
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
      .finally(() => setKbLoading(false));
  }, []);

  // Sync kb notes with unified entries
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

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const h = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showExportMenu]);

  // ---- Site selection ----
  const persist = (next: KbSelections) => {
    setSel(next);
    saveKbSelections(pageId, next);
    saveKbNotes(entries.map((x) => ({ id: x.id, title: x.name, content: x.content, createdAt: x.createdAt })));
    onKbChanged?.();
  };
  const toggleArticle = (id: number) =>
    persist({
      ...sel,
      articleIds: sel.articleIds.includes(id)
        ? sel.articleIds.filter((x) => x !== id)
        : [...sel.articleIds, id],
    });
  const toggleCategory = (id: number) =>
    persist({
      ...sel,
      categoryIds: sel.categoryIds.includes(id)
        ? sel.categoryIds.filter((x) => x !== id)
        : [...sel.categoryIds, id],
    });

  // ---- Save entry ----
  const saveEntry = () => {
    if (!mdContent.trim()) return;
    const e: KbEntry = {
      id: "e_" + Date.now(),
      name: mdContent.trim().slice(0, 60),
      content: mdContent.trim(),
      createdAt: Date.now(),
    };
    setEntries((prev) => {
      const nx = [e, ...prev];
      persistEntries(nx);
      // 直接同步到 kbNotes，不等 useEffect（时序问题）
      saveKbNotes(nx.map((x) => ({ id: x.id, title: x.name, content: x.content, createdAt: x.createdAt })));
      return nx;
    });
    onKbChanged?.();
  };

  // ---- Delete entry ----
  const deleteEntry = (id: string) => {
    setEntries((prev) => {
      const nx = prev.filter((x) => x.id !== id);
      persistEntries(nx);
      saveKbNotes(nx.map((x) => ({ id: x.id, title: x.name, content: x.content, createdAt: x.createdAt })));
      return nx;
    });
    if (activeEntry?.id === id) {
      setActiveEntry(null);
      setMdContent("");
    }
    onKbChanged?.();
  };

  // ---- Update active entry ----
  const updateActiveEntry = (content: string) => {
    if (!activeEntry) return;
    const updated = { ...activeEntry, content };
    setActiveEntry(updated);
    setEntries((prev) => {
      const nx = prev.map((e) => (e.id === activeEntry.id ? updated : e));
      persistEntries(nx);
      return nx;
    });
  };

  // ---- Save AI memory as KB entry ----
  const saveMemoryToKb = () => {
    if (!memory?.trim()) return;
    const e: KbEntry = {
      id: "m_" + Date.now(),
      name: "AI 记忆 · " + new Date().toLocaleDateString("zh-CN"),
      content: memory.trim(),
      createdAt: Date.now(),
    };
    setEntries((prev) => {
      const nx = [e, ...prev];
      persistEntries(nx);
      return nx;
    });
  };

  // ---- Export / Import ----
  const exportAsJSON = () => {
    downloadText(
      `kb-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          app: "kimo-kb",
          version: 1,
          exportedAt: new Date().toISOString(),
          entries,
        },
        null,
        2,
      ),
    );
    setShowExportMenu(false);
  };
  const exportAsMarkdown = () => {
    const md = entries
      .map(
        (e) =>
          `# ${e.name}\n\n${e.content}\n\n---\n_${new Date(e.createdAt).toLocaleString("zh-CN")}_\n`,
      )
      .join("\n\n");
    downloadText(`kb-export-${new Date().toISOString().slice(0, 10)}.md`, md);
    setShowExportMenu(false);
  };
  const importEntries = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result || ""));
        const arr: KbEntry[] = Array.isArray(data.entries)
          ? data.entries
          : Array.isArray(data)
            ? data
            : [];
        if (!arr.length) return alert("文件中没有有效的知识库条目");
        setEntries((prev) => {
          const merged = [...arr, ...prev];
          persistEntries(merged);
          return merged;
        });
      } catch {
        alert("导入失败：文件格式不正确");
      }
    };
    r.readAsText(file);
    if (e.target) e.target.value = "";
  };

  // ---- Browser: smart URL handling ----
  const browse = () => {
    const u = webUrl.trim(); if (!u) return;
    let full: string;
    if (/^https?:\/\//i.test(u)) {
      full = u;
    } else if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(u)) {
      full = "https://" + u;
    } else {
      full = "https://www.google.com/search?q=" + encodeURIComponent(u);
    }
    setWebUrl(full); setWebContent(""); setWebLoading(true);
    fetchWebpage(full)
      .then((t) => {
        setWebContent(t || "无法获取内容（目标网站拒绝访问或网络不通）");
      })
      .catch(() => {
        setWebContent("获取失败，请检查网址是否正确");
      })
      .finally(() => {
        setWebLoading(false);
      });
  };

  // ---- Drag-drop: document-level (MdEditor consumes element events) ----
  const dragCounter = useRef(0);
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDragLeave = () => {
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragOver(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        setMdContent((p) =>
          p ? p + "\n\n" + String(r.result || "") : String(r.result || ""),
        );
      };
      r.readAsText(f);
    };
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  // ---- Helpers ----
  const h = Math.max(360, window.innerHeight - 240);
  const btn =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors";

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-gray-900">
      {/* Drag overlay */}
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
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          <button
            onClick={() => setTab("web")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === "web" ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            浏览
          </button>
          <button
            onClick={() => setTab("kb")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === "kb" ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
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
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
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

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* ===== Web Tab ===== */}
        {tab === "web" && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 gap-1.5 p-2">
              <input
                value={webUrl}
                onChange={(e) => {
                  setWebUrl(e.target.value);
                  setWebContent("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") browse();
                }}
                placeholder="输入网址或关键词搜索…"
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              <button
                onClick={browse}
                disabled={webLoading}
                className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
              >
                {webLoading ? "搜索中…" : "搜索"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {webLoading && (
                <div className="flex items-center justify-center py-12">
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
                </div>
              )}
              {webContent && !webLoading && (
                <div className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                    <span>{webContent.length.toLocaleString()} 字符</span>
                    <button
                      onClick={() => onInsertMessage(webContent)}
                      className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-600 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                    >
                      发送到对话
                    </button>
                    <button
                      onClick={() => setWebContent("")}
                      className="rounded-md px-2 py-0.5 text-gray-400 hover:text-gray-600"
                    >
                      清除
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {webContent.slice(0, 50000)}
                  </div>
                </div>
              )}
              {!webContent && !webLoading && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
                  <svg
                    className="h-10 w-10 text-gray-300 dark:text-gray-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <p className="text-sm text-gray-400">
                    输入网址获取网页内容，或输入关键词进行网络搜索
                  </p>
                  <p className="text-xs text-gray-400">
                    AI 将根据搜索结果回答你的问题
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== Knowledge Base Tab ===== */}
        {tab === "kb" && (
          <div className="flex h-full flex-col">
            {/* Editor */}
            <div className="flex-1 min-h-0">
              {activeEntry ? (
                <>
                  <div className="flex items-center gap-2 border-b border-gray-50 px-3 py-1.5 dark:border-gray-800">
                    <button
                      onClick={() => {
                        setActiveEntry(null);
                        setMdContent("");
                      }}
                      className="rounded p-1 text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-300"
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
                    <span className="truncate text-xs text-gray-500">
                      {activeEntry.name}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => onInsertMessage(activeEntry.content)}
                      className="rounded-md px-2 py-0.5 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    >
                      发送到对话
                    </button>
                  </div>
                  <MdEditor
                    value={activeEntry.content}
                    onChange={updateActiveEntry}
                    height={h}
                    placeholder="编辑知识库条目…"
                    aiPolish={false}
                  />
                </>
              ) : (
                <MdEditor
                  value={mdContent}
                  onChange={setMdContent}
                  height={h}
                  placeholder="编写内容，或拖放 .md 文件到此处…"
                  aiPolish={false}
                />
              )}
            </div>

            {/* Action bar */}
            <div className="flex shrink-0 items-center gap-1.5 border-t border-gray-50 px-3 py-2 dark:border-gray-800">
              <button
                onClick={() =>
                  onInsertMessage(mdContent || activeEntry?.content || "")
                }
                disabled={!mdContent.trim() && !activeEntry?.content?.trim()}
                className={`${btn} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300`}
              ><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" /></svg>发送
              </button>
              {!activeEntry && (
                <button onClick={saveEntry} disabled={!mdContent.trim()}
                  className={`${btn} border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>存为条目
                </button>
              )}
              {onUpload && (
                <button onClick={onUpload}
                  className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>上传
                </button>
              )}
              {enableArticles && onArticle && (
                <button onClick={onArticle}
                  className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg>写文章
                </button>
              )}
              <div className="flex-1" />
              <div className="relative" ref={exportRef}>
                <button onClick={() => setShowExportMenu(!showExportMenu)}
                  className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>导出
                </button>
                {showExportMenu && (
                  <div className="absolute bottom-full right-0 mb-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <button onClick={exportAsJSON} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">JSON（可再导入）</button>
                    <button onClick={exportAsMarkdown} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">Markdown</button>
                    {onExport && (messagesLength ?? 0) > 0 && (
                      <>
                        <div className="border-t border-gray-100 dark:border-gray-800" />
                        <button onClick={onExport} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">导出对话</button>
                      </>
                    )}
                    <div className="border-t border-gray-100 dark:border-gray-800" />
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
                      导入 JSON
                      <input type="file" accept=".json" onChange={importEntries} className="hidden" />
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Site sources (moved here, less prominent) */}
            {kbExpanded && (
              <div className="shrink-0 border-t border-gray-50 px-3 py-2 max-h-48 overflow-y-auto dark:border-gray-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-gray-400">
                    站点内容源
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        persist({
                          ...sel,
                          articleIds: allArticles.map((a) => a.id),
                        })
                      }
                      className="text-[10px] text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      全选
                    </button>
                    <button
                      onClick={() =>
                        persist({ ...sel, articleIds: [], categoryIds: [] })
                      }
                      className="text-[10px] text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      清空
                    </button>
                  </div>
                </div>
                {kbLoading ? (
                  <p className="text-[11px] text-gray-400">加载中…</p>
                ) : (
                  <>
                    {allCategories.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {allCategories.map((c) => (
                          <label
                            key={c.id}
                            className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition ${sel.categoryIds.includes(c.id) ? "border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900" : "border-gray-200 text-gray-500 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-500"}`}
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
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {allArticles.map((a) => (
                          <label
                            key={a.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[11px] transition hover:bg-gray-50 dark:hover:bg-gray-800"
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

            {/* AI Memory section */}
            {memory !== undefined && onMemoryChange && (
              <div className="shrink-0 border-t border-gray-50 dark:border-gray-800">
                <div className="flex items-center justify-between px-3 py-2">
                  <button
                    onClick={() => {
                      if (editingMemory) {
                        onMemoryChange(memoryDraft);
                      } else {
                        setMemoryDraft(memory || "");
                      }
                      setEditingMemory(!editingMemory);
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
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
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                      />
                    </svg>
                    AI 记忆{" "}
                    <span className="text-[10px] text-gray-400">
                      (
                      {memory
                        ? memory.split("\n").filter(Boolean).length + " 条"
                        : "空"}
                      )
                    </span>
                  </button>
                  {memory?.trim() && (
                    <button
                      onClick={saveMemoryToKb}
                      className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                      title="将 AI 记忆保存为知识库条目"
                    >
                      存入知识库
                    </button>
                  )}
                </div>
                {editingMemory && (
                  <div className="px-3 pb-2">
                    <textarea
                      value={memoryDraft}
                      onChange={(e) => setMemoryDraft(e.target.value)}
                      rows={4}
                      className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700 outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      placeholder="AI 会根据对话自动学习你的偏好…你也可以手动编辑"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Saved entries list */}
            <div className="shrink-0 border-t border-gray-50 max-h-52 overflow-y-auto dark:border-gray-800">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[11px] font-medium text-gray-400">
                  知识条目
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">
                    {entries.length} 条
                  </span>
                  <button
                    onClick={() => setKbExpanded(!kbExpanded)}
                    className={`text-[10px] transition ${kbExpanded ? "text-gray-700 dark:text-gray-300" : "text-gray-400 hover:text-gray-600"}`}
                  >
                    {kbExpanded ? "隐藏站点源" : "站点源"}
                  </button>
                </div>
              </div>
              {entries.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-gray-400">
                  保存的知识条目会出现在这里
                </p>
              ) : (
                entries.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => {
                      setActiveEntry(entry);
                      setMdContent("");
                    }}
                    className={`group flex cursor-pointer items-center gap-2 border-b border-gray-50 px-3 py-2.5 text-xs transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 ${activeEntry?.id === entry.id ? "bg-gray-50 dark:bg-gray-800/50" : ""}`}
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
                      className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:text-red-500"
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
      </div>
    </div>
  );
}
