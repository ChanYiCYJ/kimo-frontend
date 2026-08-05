import { useState, useCallback, useEffect } from "react";
import { MdEditor } from "./MdEditor";

interface PromptFile { name: string; content: string; createdAt: number; }

const PK = "kimo_agent_prompts";
const L = (): PromptFile[] => { try { const r = localStorage.getItem(PK); return r ? JSON.parse(r) : []; } catch { return []; } };
const S = (f: PromptFile[]) => { try { localStorage.setItem(PK, JSON.stringify(f)); } catch {} };

export function AgentPanel({
  onClose,
  onInsertMessage,
  initUrl,
  lastAssistantContent,
  // 工具栏 actions（来自 + 菜单合并）
  onOpenKb,
  onExport,
  onUpload,
  onArticle,
  enableArticles,
  messagesLength,
}: {
  onClose: () => void;
  onInsertMessage: (t: string) => void;
  initUrl?: string;
  lastAssistantContent?: string;
  onOpenKb?: () => void;
  onExport?: () => void;
  onUpload?: () => void;
  onArticle?: () => void;
  enableArticles?: boolean;
  messagesLength?: number;
}) {
  const [tab, setTab] = useState<"web" | "markdown" | "prompts">(initUrl ? "web" : "markdown");
  const [webUrl, setWebUrl] = useState(initUrl || "");
  const [mdContent, setMdContent] = useState("");
  const [prompts, setPrompts] = useState<PromptFile[]>(L);
  const [activePrompt, setActivePrompt] = useState<PromptFile | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // AI→Agent：根据最后一条 assistant 消息自动检测需要打开的 tab
  useEffect(() => {
    if (!lastAssistantContent) return;
    const m = lastAssistantContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
    if (m) { setWebUrl(m[0]); setTab("web"); return; }
    const codeBlock = lastAssistantContent.match(/```[\s\S]*?```/);
    if (codeBlock) { setMdContent(codeBlock[0]); setTab("markdown"); }
  }, [lastAssistantContent]);

  const addP = (n = "新提示词") => { const p: PromptFile = { name: n, content: "", createdAt: Date.now() }; const nx = [p, ...prompts]; setPrompts(nx); S(nx); setActivePrompt(p); setTab("prompts"); };
  const delP = (i: number) => { const nx = prompts.filter((_, j) => j !== i); setPrompts(nx); S(nx); if (activePrompt === prompts[i]) setActivePrompt(null); };
  const updP = (c: string) => { if (!activePrompt) return; const u = { ...activePrompt, content: c }; const nx = prompts.map(p => p === activePrompt ? u : p); setPrompts(nx); S(nx); setActivePrompt(u); };
  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const t = String(r.result || ""); const nm = f.name.replace(/\.(md|markdown|txt)$/, ""); const nx = [{ name: nm, content: t, createdAt: Date.now() }, ...prompts]; setPrompts(nx); S(nx); setActivePrompt(nx[0]); setTab("prompts"); }; r.readAsText(f); }, [prompts]);

  const tabs = [{ k: "markdown" as const, l: "文档", c: "📝" }, { k: "web" as const, l: "网页", c: "🌐" }, { k: "prompts" as const, l: "提示词", c: "📋" }];
  const h = Math.max(360, window.innerHeight - 160);

  const toolBtn = "flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200";

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-gray-900 relative" onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {dragOver && <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm"><div className="rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-gray-800"><p className="text-sm font-medium text-gray-700 dark:text-gray-200">释放以导入 Markdown</p></div></div>}
      
      {/* Tabs */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-2.5 py-2 dark:border-gray-700">
        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">{tabs.map(t => <button key={t.k} onClick={() => setTab(t.k)} className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${tab === t.k ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{t.c} {t.l}</button>)}</div>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        
        {/* Web tab */}
        {tab === "web" && <div className="flex h-full flex-col">
          <div className="flex shrink-0 gap-1 p-2"><input value={webUrl} onChange={e => setWebUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && webUrl.trim()) setWebUrl(webUrl.trim().startsWith("http") ? webUrl.trim() : "https://" + webUrl.trim()); }} placeholder="输入网址…" className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800" /><button onClick={() => { const u = webUrl.trim(); if (u) setWebUrl(u.startsWith("http") ? u : "https://" + u); }} className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900">打开</button></div>
          {webUrl ? <div className="min-h-0 flex-1"><iframe src={webUrl} className="w-full h-full border-0" title="网页" sandbox="allow-scripts allow-same-origin allow-forms" /></div> : <p className="p-3 text-xs text-gray-400">输入网址即可浏览网页</p>}
        </div>}

        {/* Markdown tab */}
        {tab === "markdown" && <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0" style={{ margin: '-1px' }}><MdEditor value={mdContent} onChange={setMdContent} height={h} placeholder="编写 Markdown，可拖拽 .md 文件到此处…" aiPolish={false} /></div>
          <div className="flex shrink-0 gap-2 border-t border-gray-200 px-2.5 py-2 dark:border-gray-700"><button onClick={() => onInsertMessage(mdContent)} disabled={!mdContent.trim()} className="flex-1 rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900">发送到对话</button><button onClick={() => mdContent.trim() ? addP(mdContent.slice(0, 30)) : addP()} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">存为提示词</button><button onClick={() => setMdContent("")} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">清空</button></div>
        </div>}

        {/* Prompts tab */}
        {tab === "prompts" && <div className="flex h-full"><div className="flex w-36 shrink-0 flex-col border-r border-gray-100 dark:border-gray-700"><button onClick={() => addP()} className="border-b border-gray-100 px-2 py-2 text-xs font-medium text-blue-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">+ 新建</button><div className="min-h-0 flex-1 overflow-y-auto">{prompts.map((p, i) => <div key={i} onClick={() => { setActivePrompt(p); }} className={`group flex cursor-pointer items-center justify-between px-2 py-1.5 text-xs ${activePrompt === p ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"}`}><span className="min-w-0 truncate">{p.name}</span><button onClick={e => { e.stopPropagation(); delP(i); }} className="ml-1 hidden shrink-0 rounded text-gray-400 hover:text-red-500 group-hover:block">×</button></div>)}</div></div><div className="flex min-w-0 flex-1 flex-col">{activePrompt ? <><input value={activePrompt.name} onChange={e => { const nx = prompts.map(p => p === activePrompt ? { ...p, name: e.target.value } : p); setPrompts(nx); S(nx); setActivePrompt({ ...activePrompt, name: e.target.value }); }} className="border-b border-gray-200 bg-transparent px-3 py-1.5 text-sm font-medium outline-none dark:border-gray-700 dark:text-gray-200" /><div className="min-h-0 flex-1" style={{ margin: '-1px' }}><MdEditor value={activePrompt.content} onChange={updP} height={Math.max(240, window.innerHeight - 130)} placeholder="提示词内容…" aiPolish={false} /></div></> : <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400"><p className="text-sm">选择或新建提示词文件</p><p className="text-xs">拖拽 .md 文件到此处导入</p></div>}</div></div>}
      </div>

      {/* 底部工具栏：吸收 + 菜单全部功能 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-gray-100 px-2.5 py-2 dark:border-gray-700">
        {onUpload && <button onClick={onUpload} className={toolBtn} title="上传 Markdown">📎 上传</button>}
        {onOpenKb && <button onClick={onOpenKb} className={toolBtn} title="Coser 角色设定">📚 知识库</button>}
        {enableArticles && onArticle && <button onClick={onArticle} className={toolBtn} title="写文章">✏️ 写文章</button>}
        {onExport && (messagesLength ?? 0) > 0 && <button onClick={onExport} className={toolBtn} title="导出当前对话">📥 导出</button>}
      </div>
    </div>
  );
}
