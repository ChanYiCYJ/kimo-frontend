import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { MdEditor } from "./MdEditor";
import {
  getKbNotes, saveKbSelections, getKbSelections,
  loadKbOptions, addKbNote, updateKbNote, removeKbNote,
  assembleKnowledge, downloadText, type KbNote, type KbSelections,
} from "../lib/kb";

interface PromptFile { name: string; content: string; createdAt: number; }

const PK = "kimo_agent_prompts";
const PL = (): PromptFile[] => { try { const r = localStorage.getItem(PK); return r ? JSON.parse(r) : []; } catch { return []; } };
const PS = (f: PromptFile[]) => { try { localStorage.setItem(PK, JSON.stringify(f)); } catch {} };

export function AgentPanel({
  onClose, onInsertMessage, initUrl, lastAssistantContent,
  onExport, onUpload, onArticle, enableArticles, messagesLength,
  pageId, kbOn, onToggleKb, onApplied,
}: {
  onClose: () => void; onInsertMessage: (t: string) => void;
  initUrl?: string; lastAssistantContent?: string;
  onExport?: () => void; onUpload?: () => void; onArticle?: () => void;
  enableArticles?: boolean; messagesLength?: number;
  pageId: number; kbOn: boolean; onToggleKb: (on: boolean) => void; onApplied: () => void;
}) {
  const [tab, setTab] = useState<"web"|"markdown"|"prompts"|"kb">(initUrl?"web":"markdown");
  const [webUrl, setWebUrl] = useState(initUrl||"");
  const [mdContent, setMdContent] = useState("");
  const [prompts, setPrompts] = useState<PromptFile[]>(PL);
  const [activePrompt, setActivePrompt] = useState<PromptFile|null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [kbTab, setKbTab] = useState<"site"|"notes">("site");
  const [sel, setSel] = useState<KbSelections>(()=>getKbSelections(pageId));
  const [notes, setNotes] = useState<KbNote[]>(()=>getKbNotes());
  const [allArticles, setAllArticles] = useState<{id:number;title:string;category_name?:string|null}[]>([]);
  const [allCategories, setAllCategories] = useState<{id:number;name:string;slug:string}[]>([]);
  const [kbLoading, setKbLoading] = useState(true);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [editingId, setEditingId] = useState<string|null>(null);
  const kbImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lastAssistantContent) return;
    const m = lastAssistantContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
    if (m) { setWebUrl(m[0]); setTab("web"); return; }
    const cb = lastAssistantContent.match(/```[\s\S]*?```/);
    if (cb) { setMdContent(cb[0]); setTab("markdown"); }
  }, [lastAssistantContent]);

  useEffect(() => {
    setKbLoading(true);
    loadKbOptions().then(o=>{
      setAllArticles(o.articles.map(a=>({id:a.id,title:a.title,category_name:a.category_name})));
      setAllCategories(o.categories.map(c=>({id:c.id,name:c.name,slug:c.slug})));
    }).catch(()=>{}).finally(()=>setKbLoading(false));
  }, []);

  const persist=(next:KbSelections)=>{setSel(next);saveKbSelections(pageId,next);};
  const toggleArticle=(id:number)=>persist({...sel,articleIds:sel.articleIds.includes(id)?sel.articleIds.filter(x=>x!==id):[...sel.articleIds,id]});
  const toggleCategory=(id:number)=>persist({...sel,categoryIds:sel.categoryIds.includes(id)?sel.categoryIds.filter(x=>x!==id):[...sel.categoryIds,id]});
  const selectAll=()=>persist({...sel,articleIds:allArticles.map(a=>a.id)});
  const clearAll=()=>persist({...sel,articleIds:[],categoryIds:[]});
  const submitNote=()=>{
    if(!noteTitle.trim()&&!noteContent.trim())return;
    setNotes(editingId?updateKbNote(editingId,noteTitle,noteContent):addKbNote(noteTitle,noteContent));
    setNoteTitle("");setNoteContent("");setEditingId(null);
  };
  const exportKb=async()=>{
    const kb=await assembleKnowledge(sel,notes);
    downloadText(`kimo-kb-${new Date().toISOString().slice(0,10)}.md`,
      ["# 知识库导出","",`> ${new Date().toLocaleString()}`,"",kb||"(空)"].join("\n"));
  };
  const kbPreview=useMemo(()=>
    `文章${sel.articleIds.length}·分类${sel.categoryIds.length}·笔记${notes.filter(n=>n.title||n.content).length}`,
    [sel,notes]);

  const addP=(n="新提示词")=>{const p:PromptFile={name:n,content:"",createdAt:Date.now()};const nx=[p,...prompts];setPrompts(nx);PS(nx);setActivePrompt(p);setTab("prompts");};
  const delP=(i:number)=>{const nx=prompts.filter((_,j)=>j!==i);setPrompts(nx);PS(nx);if(activePrompt===prompts[i])setActivePrompt(null);};
  const updP=(c:string)=>{if(!activePrompt)return;const u={...activePrompt,content:c};const nx=prompts.map(p=>p===activePrompt?u:p);setPrompts(nx);PS(nx);setActivePrompt(u);};

  const onDrop=useCallback((e:React.DragEvent)=>{
    e.preventDefault();e.stopPropagation();setDragOver(false);
    const f=e.dataTransfer.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      const t=String(r.result||"");const nm=f.name.replace(/\.(md|markdown|txt)$/i,"");
      if(tab==="prompts"||tab==="kb"){
        const nx=[{name:nm,content:t,createdAt:Date.now()},...prompts];setPrompts(nx);PS(nx);setActivePrompt(nx[0]);setTab("prompts");
      }else{
        setMdContent(p=>p?p+"\n\n"+t:t);setTab("markdown");
      }
    };r.readAsText(f);
  },[prompts,tab]);
  const onDragOver=useCallback((e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();setDragOver(true);},[]);
  const onDragLeave=useCallback((e:React.DragEvent)=>{e.preventDefault();setDragOver(false);},[]);

  const tabs=[{k:"web"as const,l:"网页",c:"🌐"},{k:"markdown"as const,l:"文档",c:"📝"},{k:"prompts"as const,l:"提示词",c:"📋"},{k:"kb"as const,l:"知识库",c:"📚"}];
  const h=Math.max(360,window.innerHeight-220);
  const tBtn="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition";

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-gray-900 relative" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragOver&&<div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm pointer-events-none"><div className="rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-gray-800"><p className="text-sm font-medium text-gray-700 dark:text-gray-200">释放文件以导入</p><p className="mt-1 text-xs text-gray-400">Markdown/TXT→文档或提示词</p></div></div>}

      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-2.5 py-2 dark:border-gray-700">
        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {tabs.map(t=><button key={t.k} onClick={()=>setTab(t.k)} className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${tab===t.k?"bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100":"text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{t.c}{t.l}</button>)}
        </div>
        <div className="flex items-center gap-2">
          {tab==="kb"&&<button onClick={()=>onToggleKb(!kbOn)} className={`relative h-5 w-9 rounded-full transition shrink-0 ${kbOn?"bg-gray-900 dark:bg-gray-200":"bg-gray-300 dark:bg-gray-700"}`} title={kbOn?"已启用":"已关闭"}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${kbOn?"left-[18px]":"left-0.5"}`}/></button>}
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
      </div>

      {tab==="kb"&&<div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-1.5 text-xs text-gray-400 dark:border-gray-700"><span>{kbPreview}</span><span className={kbOn?"text-green-600 dark:text-green-400":"text-gray-400"}>{kbOn?"●已启用":"○未启用"}</span></div>}

      <div className="min-h-0 flex-1 overflow-hidden">

        {tab==="web"&&<div className="flex h-full flex-col">
          <div className="flex shrink-0 gap-1 p-2">
            <input value={webUrl} onChange={e=>setWebUrl(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&webUrl.trim())setWebUrl(webUrl.trim().startsWith("http")?webUrl.trim():"https://"+webUrl.trim())}} placeholder="输入网址或搜索词…" className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800"/>
            <button onClick={()=>{const u=webUrl.trim();if(u)setWebUrl(u.startsWith("http")?u:"https://www.google.com/search?q="+encodeURIComponent(u))}} className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900">打开</button>
          </div>
          {webUrl?<div className="min-h-0 flex-1"><iframe src={webUrl} className="w-full h-full border-0" title="web" sandbox="allow-scripts allow-same-origin allow-forms"/></div>:<p className="p-3 text-xs text-gray-400">输入网址浏览网页，或输入关键词搜索</p>}
        </div>}

        {tab==="markdown"&&<div className="flex h-full flex-col">
          <div className="flex-1 min-h-0" style={{margin:"-1px"}}><MdEditor value={mdContent} onChange={setMdContent} height={h} placeholder="编写 Markdown，拖拽 .md 文件到此处…" aiPolish={false}/></div>
          <div className="flex shrink-0 gap-2 border-t border-gray-200 px-2.5 py-2 dark:border-gray-700">
            <button onClick={()=>onInsertMessage(mdContent)} disabled={!mdContent.trim()} className="flex-1 rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900">发送到对话</button>
            <button onClick={()=>mdContent.trim()?addP(mdContent.slice(0,30)):addP()} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">存为提示词</button>
            <button onClick={()=>setMdContent("")} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">清空</button>
          </div>
        </div>}

        {tab==="prompts"&&<div className="flex h-full">
          <div className="flex w-36 shrink-0 flex-col border-r border-gray-100 dark:border-gray-700">
            <button onClick={()=>addP()} className="border-b border-gray-100 px-2 py-2 text-xs font-medium text-blue-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">+ 新建</button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {prompts.map((p,i)=><div key={i} onClick={()=>setActivePrompt(p)} className={`group flex cursor-pointer items-center justify-between px-2 py-1.5 text-xs ${activePrompt===p?"bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400":"text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"}`}><span className="min-w-0 truncate">{p.name}</span><button onClick={e=>{e.stopPropagation();delP(i)}} className="ml-1 hidden shrink-0 rounded text-gray-400 hover:text-red-500 group-hover:block">×</button></div>)}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {activePrompt?<>
              <input value={activePrompt.name} onChange={e=>{const nx=prompts.map(p=>p===activePrompt?{...p,name:e.target.value}:p);setPrompts(nx);PS(nx);setActivePrompt({...activePrompt,name:e.target.value})}} className="border-b border-gray-200 bg-transparent px-3 py-1.5 text-sm font-medium outline-none dark:border-gray-700 dark:text-gray-200"/>
              <div className="min-h-0 flex-1" style={{margin:"-1px"}}><MdEditor value={activePrompt.content} onChange={updP} height={Math.max(240,window.innerHeight-180)} placeholder="提示词内容…" aiPolish={false}/></div>
            </>:<div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400"><p className="text-sm">选择或新建提示词</p><p className="text-xs">拖拽 .md 导入</p></div>}
          </div>
        </div>}

        {tab==="kb"&&<div className="flex h-full flex-col">
          <div className="flex shrink-0 gap-1 border-b border-gray-100 px-3 py-2 dark:border-gray-700">
            {(["site","notes"]as const).map(t=><button key={t} onClick={()=>setKbTab(t)} className={`rounded-lg px-3 py-1.5 text-xs transition ${kbTab===t?"bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100":"text-gray-500 hover:text-gray-700 dark:text-gray-400"}`}>{t==="site"?"站点内容":"自定义笔记"}</button>)}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {kbTab==="site"?<div className="space-y-3">
              <div className="flex items-center justify-between"><p className="text-xs font-medium text-gray-500">选择喂给 AI 的文章/分类</p><div className="flex gap-1.5"><button onClick={selectAll} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 dark:border-gray-700">全选</button><button onClick={clearAll} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 dark:border-gray-700">清空</button></div></div>
              {kbLoading&&<p className="py-4 text-center text-xs text-gray-400">加载中...</p>}
              {allCategories.length>0&&<div><p className="mb-1.5 text-[11px] font-medium text-gray-400">分类</p><div className="flex flex-wrap gap-1.5">{allCategories.map(c=><label key={c.id} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${sel.categoryIds.includes(c.id)?"border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900":"border-gray-200 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300"}`}><input type="checkbox" className="hidden" checked={sel.categoryIds.includes(c.id)} onChange={()=>toggleCategory(c.id)}/>{c.name}</label>)}</div></div>}
              {allArticles.length>0&&<div><p className="mb-1.5 text-[11px] font-medium text-gray-400">文章</p><div className="space-y-0.5 rounded-lg border border-gray-100 p-1 dark:border-gray-800 max-h-64 overflow-y-auto">{allArticles.map(a=><label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"><input type="checkbox" checked={sel.articleIds.includes(a.id)} onChange={()=>toggleArticle(a.id)} className="h-3.5 w-3.5 shrink-0 accent-gray-900"/><span className="min-w-0 flex-1 truncate">{a.title}</span>{a.category_name&&<span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-gray-800">{a.category_name}</span>}</label>)}</div></div>}
              {!kbLoading&&allArticles.length===0&&allCategories.length===0&&<p className="py-4 text-center text-xs text-gray-400">站点暂无文章或分类</p>}
            </div>:<div className="space-y-3">
              <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                <p className="mb-2 text-[11px] font-medium text-gray-400">新增笔记（本机浏览器保存）</p>
                <input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="标题" className="w-full rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800"/>
                <textarea value={noteContent} onChange={e=>setNoteContent(e.target.value)} placeholder="内容，AI 将基于此回答…" rows={3} className="mt-2 w-full resize-none rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800"/>
                <div className="mt-2 flex items-center justify-between">
                  <button onClick={()=>kbImportRef.current?.click()} className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 dark:border-gray-700"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>导入</button>
                  <input ref={kbImportRef} type="file" accept=".md,.markdown,.txt" onChange={e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{const t=String(r.result||"");const title=f.name.replace(/\.(md|markdown|txt)$/i,"");setNotes(addKbNote(title,t));if(kbImportRef.current)kbImportRef.current.value=""};r.readAsText(f)}} className="hidden"/>
                  <button onClick={submitNote} disabled={!noteTitle.trim()&&!noteContent.trim()} className="rounded bg-gray-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-200 dark:text-gray-900">{editingId?"保存":"添加"}</button>
                </div>
              </div>
              <div className="space-y-1.5">
                {notes.filter(n=>n.title||n.content).map(n=><div key={n.id} className="group flex items-start gap-2 rounded-lg border border-gray-100 p-2 dark:border-gray-800"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 dark:text-gray-200">{n.title||"无标题"}</p><p className="mt-0.5 whitespace-pre-wrap text-[11px] text-gray-500 dark:text-gray-400 line-clamp-3">{n.content}</p></div><div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100"><button onClick={()=>{setEditingId(n.id);setNoteTitle(n.title);setNoteContent(n.content)}} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg></button><button onClick={()=>setNotes(removeKbNote(n.id))} className="rounded p-1 text-gray-400 hover:text-red-500"><svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397"/></svg></button></div></div>)}
                {notes.filter(n=>n.title||n.content).length===0&&<p className="py-4 text-center text-xs text-gray-400">还没有笔记</p>}
              </div>
            </div>}
          </div>
        </div>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-gray-100 px-2.5 py-2 dark:border-gray-700">
        {onUpload&&<button onClick={onUpload} className={tBtn}>📎上传</button>}
        {enableArticles&&onArticle&&<button onClick={onArticle} className={tBtn}>✏️写文章</button>}
        {onExport&&(messagesLength??0)>0&&<button onClick={onExport} className={tBtn}>📥导出</button>}
        {tab==="kb"&&<button onClick={exportKb} className={tBtn}>📤导出设定</button>}
        <div className="flex-1"/>
        <button onClick={()=>{onApplied();}} className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">应用</button>
      </div>
    </div>
  );
}
