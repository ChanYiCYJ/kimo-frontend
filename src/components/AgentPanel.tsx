import { useState, useEffect, useCallback } from "react";
import { MdEditor } from "./MdEditor";
import {
  getKbNotes, saveKbSelections, getKbSelections,
  loadKbOptions, addKbNote, type KbNote, type KbSelections,
} from "../lib/kb";

interface PromptFile { name: string; content: string; createdAt: number; }
const PK = "kimo_agent_prompts";
const pLoad = (): PromptFile[] => { try { const r = localStorage.getItem(PK); return r ? JSON.parse(r) : []; } catch { return []; } };
const pSave = (f: PromptFile[]) => { try { localStorage.setItem(PK, JSON.stringify(f)); } catch {} };

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
  const [tab, setTab] = useState<"web"|"write">(initUrl?"web":"write");
  const [webUrl, setWebUrl] = useState(initUrl||"");
  const [mdContent, setMdContent] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Unified saved items: prompts + kb notes in one list
  const [prompts, setPrompts] = useState<PromptFile[]>(pLoad);
  const [kbNotes, setKbNotes] = useState<KbNote[]>(()=>getKbNotes());
  const [sel, setSel] = useState<KbSelections>(()=>getKbSelections(pageId));
  const [allArticles, setAllArticles] = useState<{id:number;title:string;category_name?:string|null}[]>([]);
  const [allCategories, setAllCategories] = useState<{id:number;name:string;slug:string}[]>([]);
  const [kbLoading, setKbLoading] = useState(true);
  const [kbExpanded, setKbExpanded] = useState(false);
  const [activeItem, setActiveItem] = useState<{name:string;content:string;createdAt:number}|null>(null);
  const [activeType, setActiveType] = useState<"prompt"|"note"|null>(null);

  // AI auto-detect
  useEffect(() => {
    if (!lastAssistantContent) return;
    const m = lastAssistantContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
    if (m) { setWebUrl(m[0]); setTab("web"); return; }
    const cb = lastAssistantContent.match(/```[\s\S]*?```/);
    if (cb) { setMdContent(cb[0]); setTab("write"); }
  }, [lastAssistantContent]);

  // KB load
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

  // Save current editor content
  const saveAsPrompt = () => {
    if (!mdContent.trim()) return;
    const p:PromptFile={name:mdContent.slice(0,30),content:mdContent,createdAt:Date.now()};
    const nx=[p,...prompts];setPrompts(nx);pSave(nx);
  };
  const saveAsNote = () => {
    if (!mdContent.trim()) return;
    const title=mdContent.slice(0,30);
    setKbNotes(addKbNote(title,mdContent));
  };

  // Drag-drop: window-level listeners for reliability (editor won't intercept)
  const handleDragOver = useCallback((e:DragEvent)=>{e.preventDefault();setDragOver(true);},[]);
  const handleDragLeave = useCallback((e:DragEvent)=>{if((e.target as Node)===document)setDragOver(false);},[]);
  const handleDrop = useCallback((e:DragEvent)=>{
    e.preventDefault();setDragOver(false);
    const f=e.dataTransfer?.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      const t=String(r.result||"");setMdContent(p=>p?p+"\n\n"+t:t);setTab("write");
    };r.readAsText(f);
  },[]);
  useEffect(()=>{
    document.addEventListener("dragover",handleDragOver);
    document.addEventListener("dragleave",handleDragLeave);
    document.addEventListener("drop",handleDrop);
    return ()=>{document.removeEventListener("dragover",handleDragOver);document.removeEventListener("dragleave",handleDragLeave);document.removeEventListener("drop",handleDrop);};
  },[handleDragOver,handleDragLeave,handleDrop]);

  const h=Math.max(360,window.innerHeight-200);
  const btn="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition";

  const unifiedItems = [
    ...prompts.map(p=>({name:p.name,content:p.content,type:"prompt"as const,createdAt:p.createdAt})),
    ...kbNotes.filter(n=>n.title||n.content).map(n=>({name:n.title||"无标题",content:n.content,type:"note"as const,createdAt:n.createdAt})),
  ].sort((a,b)=>b.createdAt-a.createdAt);

  return (
    <div className="flex h-full w-full flex-col bg-gray-50 dark:bg-gray-950">
      {/* Drag overlay */}
      {dragOver&&<div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm pointer-events-none"><div className="rounded-2xl bg-white p-8 text-center shadow-2xl dark:bg-gray-800"><p className="text-base font-medium text-gray-700 dark:text-gray-200">释放到编辑器</p><p className="mt-1 text-sm text-gray-400">支持 .md / .txt</p></div></div>}

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          <button onClick={()=>setTab("web")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${tab==="web"?"bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100":"text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>🌐 浏览</button>
          <button onClick={()=>setTab("write")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${tab==="write"?"bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100":"text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>📝 写作</button>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={()=>onToggleKb(!kbOn)} className={`relative h-5 w-9 rounded-full transition shrink-0 ${kbOn?"bg-gray-900 dark:bg-gray-200":"bg-gray-300 dark:bg-gray-600"}`} title={kbOn?"知识库已启用":"知识库已关闭"}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${kbOn?"left-[18px]":"left-0.5"}`}/></button>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
      </div>

      {/* kb status */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-3 py-1.5 text-[11px] text-gray-400 dark:border-gray-700 dark:bg-gray-900"><span>文章{sel.articleIds.length}·分类{sel.categoryIds.length}·笔记{kbNotes.filter(n=>n.title||n.content).length}</span><span className={kbOn?"text-green-600":"text-gray-400"}>{kbOn?"●已启用":"○未启用"}</span></div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden bg-white dark:bg-gray-900">

        {/* Web tab */}
        {tab==="web"&&<div className="flex h-full flex-col">
          <div className="flex shrink-0 gap-1.5 p-2">
            <input value={webUrl} onChange={e=>setWebUrl(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&webUrl.trim())setWebUrl(webUrl.trim().startsWith("http")?webUrl.trim():"https://"+webUrl.trim())}} placeholder="输入网址或搜索关键词…" className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"/>
            <button onClick={()=>{const u=webUrl.trim();if(u)setWebUrl(u.startsWith("http")?u:"https://www.google.com/search?q="+encodeURIComponent(u))}} className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">打开</button>
          </div>
          {webUrl?<div className="min-h-0 flex-1"><iframe src={webUrl} className="w-full h-full border-0" title="web" sandbox="allow-scripts allow-same-origin allow-forms"/></div>:<p className="p-4 text-sm text-gray-400 text-center">输入网址浏览网页，或输入关键词搜索</p>}
        </div>}

        {/* Write tab: unified editor + saved items + kb settings */}
        {tab==="write"&&<div className="flex h-full flex-col">
          {/* Editor */}
          <div className="flex-1 min-h-0" style={{margin:"-1px"}}>
            {activeItem?<>
              {/* Active item view: name + editor + back button */}
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5 dark:border-gray-700">
                <button onClick={()=>{setActiveItem(null);setActiveType(null);setMdContent("");}} className="rounded p-1 text-gray-400 hover:text-gray-600"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M19 12H5m7-7l-7 7 7 7"/></svg></button>
                <span className="text-xs text-gray-500">{activeType==="prompt"?"提示词":"笔记"}：{activeItem.name}</span>
              </div>
              <MdEditor value={activeItem.content} onChange={c=>{setActiveItem({...activeItem,content:c});if(activeType==="prompt"){const nx=prompts.map(p=>p.name===activeItem.name&&p.createdAt===activeItem.createdAt?{...p,content:c}:p);setPrompts(nx);pSave(nx);}else{setKbNotes(kbNotes.map(n=>n.title===activeItem.name&&n.createdAt===activeItem.createdAt?{...n,content:c}:n));}}} height={h} placeholder="编辑中…" aiPolish={false}/>
            </>:<MdEditor value={mdContent} onChange={setMdContent} height={h} placeholder="编写内容，拖拽 .md 文件到此处…" aiPolish={false}/>}
          </div>

          {/* Action bar */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-gray-100 px-3 py-2 dark:border-gray-700">
            <button onClick={()=>onInsertMessage(mdContent||activeItem?.content||"")} disabled={!mdContent.trim()&&!activeItem?.content?.trim()} className={`${btn} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300`}>发送</button>
            <button onClick={saveAsPrompt} disabled={!mdContent.trim()} className={`${btn} border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`}>存提示词</button>
            <button onClick={saveAsNote} disabled={!mdContent.trim()} className={`${btn} border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`}>存笔记</button>
            <div className="flex-1"/>
            <button onClick={()=>setKbExpanded(!kbExpanded)} className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>{kbExpanded?"收起站点":"站点选择"}</button>
          </div>

          {/* KB site selection (collapsible) */}
          {kbExpanded&&<div className="shrink-0 border-t border-gray-100 px-3 py-2 max-h-48 overflow-y-auto dark:border-gray-700">
            <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-medium text-gray-500">选择知识库来源</span><div className="flex gap-1"><button onClick={()=>persist({...sel,articleIds:allArticles.map(a=>a.id)})} className="text-[10px] text-gray-400 hover:text-gray-600">全选</button><button onClick={()=>persist({...sel,articleIds:[],categoryIds:[]})} className="text-[10px] text-gray-400 hover:text-gray-600">清空</button></div></div>
            {kbLoading?<p className="text-[11px] text-gray-400">加载中...</p>:<>
              {allCategories.length>0&&<div className="flex flex-wrap gap-1 mb-2">{allCategories.map(c=><label key={c.id} className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition ${sel.categoryIds.includes(c.id)?"border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900":"border-gray-200 text-gray-500 hover:border-gray-400 dark:border-gray-700"}`}><input type="checkbox" className="hidden" checked={sel.categoryIds.includes(c.id)} onChange={()=>toggleCategory(c.id)}/>{c.name}</label>)}</div>}
              {allArticles.length>0&&<div className="space-y-0.5 max-h-32 overflow-y-auto">{allArticles.map(a=><label key={a.id} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-[11px] hover:bg-gray-50 dark:hover:bg-gray-800"><input type="checkbox" checked={sel.articleIds.includes(a.id)} onChange={()=>toggleArticle(a.id)} className="h-3 w-3 accent-gray-900"/><span className="truncate">{a.title}</span></label>)}</div>}
            </>}
          </div>}

          {/* Saved items list: prompts + notes unified */}
          <div className="shrink-0 border-t border-gray-100 max-h-44 overflow-y-auto dark:border-gray-700">
            {unifiedItems.length===0?<p className="px-3 py-4 text-center text-[11px] text-gray-400">保存的提示词或笔记会出现在这里</p>:
            unifiedItems.map((item,i)=><div key={i} onClick={()=>{setActiveItem({name:item.name,content:item.content,createdAt:item.createdAt});setActiveType(item.type);}} className="group flex cursor-pointer items-center gap-2 border-b border-gray-50 px-3 py-2 text-xs hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800">
              <span className="shrink-0">{item.type==="prompt"?"📋":"📝"}</span>
              <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">{item.name}</span>
              <span className="shrink-0 text-[10px] text-gray-400">{item.type==="prompt"?"提示词":"笔记"}</span>
              <button onClick={e=>{e.stopPropagation();if(item.type==="prompt"){const nx=prompts.filter((_,j)=>j!==prompts.findIndex(p=>p.name===item.name&&p.createdAt===item.createdAt));setPrompts(nx);pSave(nx)}else{setKbNotes(kbNotes.filter(n=>!(n.title===item.name&&n.createdAt===item.createdAt)))}}} className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-gray-400 hover:text-red-500">×</button>
            </div>)}
          </div>
        </div>}
      </div>

      {/* Bottom bar */}
      <div className="flex shrink-0 items-center gap-1.5 border-t border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        {onUpload&&<button onClick={onUpload} className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>📎 上传</button>}
        {enableArticles&&onArticle&&<button onClick={onArticle} className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>✏️ 写文章</button>}
        {onExport&&(messagesLength??0)>0&&<button onClick={onExport} className={`${btn} border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800`}>📥 导出</button>}
        <div className="flex-1"/>
        <button onClick={()=>onApplied()} className={`${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300`}>应用</button>
      </div>
    </div>
  );
}
