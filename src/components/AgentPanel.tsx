import { useState, useCallback } from "react";
import { fetchWebpage } from "../lib/search";
import { useToast } from "../lib/toast";
import { MdEditor } from "./MdEditor";

interface AgentPanelProps { onClose: () => void; onInsertMessage: (t: string) => void; }
interface PromptFile { name: string; content: string; createdAt: number; }

const PK = "kimo_agent_prompts";
const load = (): PromptFile[] => { try{const r=localStorage.getItem(PK);return r?JSON.parse(r):[]}catch{return[]} };
const save = (f: PromptFile[]) => { try{localStorage.setItem(PK,JSON.stringify(f))}catch{} };
const inp = "w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800";

export function AgentPanel({ onClose, onInsertMessage }: AgentPanelProps) {
  const { error } = useToast();
  const [tab, setTab] = useState<"web"|"markdown"|"prompts">("markdown");
  const [webUrl,setWebUrl]=useState("");const[webContent,setWebContent]=useState("");const[webLoading,setWebLoading]=useState(false);
  const [mdContent,setMdContent]=useState("");
  const [prompts,setPrompts]=useState<PromptFile[]>(load);const[activePrompt,setActivePrompt]=useState<PromptFile|null>(null);
  const [dragOver,setDragOver]=useState(false);

  const doFetch = useCallback(async()=>{const u=webUrl.trim();if(!/^https?:\/\//i.test(u)){error("请输入完整网址");return}setWebLoading(true);try{const t=await fetchWebpage(u);if(t)setWebContent(t);else error("无法获取")}catch{error("抓取失败")}finally{setWebLoading(false)}},[webUrl,error]);

  const addP=(n="新提示词")=>{const p:PromptFile={name:n,content:"",createdAt:Date.now()};const nx=[p,...prompts];setPrompts(nx);save(nx);setActivePrompt(p);setTab("prompts")};
  const delP=(i:number)=>{const p=prompts.filter((_,j)=>j!==i);setPrompts(p);save(p);if(activePrompt===prompts[i])setActivePrompt(null)};
  const updP=(c:string)=>{if(!activePrompt)return;const u={...activePrompt,content:c};const n=prompts.map(p=>p===activePrompt?u:p);setPrompts(n);save(n);setActivePrompt(u)};

  const onDrop=useCallback((e:React.DragEvent)=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{const t=String(r.result||"");const nm=f.name.replace(/\.(md|markdown|txt)$/,"");const nx=[{name:nm,content:t,createdAt:Date.now()},...prompts];setPrompts(nx);save(nx);setActivePrompt(nx[0]);setTab("prompts")};r.readAsText(f)},[prompts]);

  const tabs=[{k:"markdown"as const,l:"文档",i:"📝"},{k:"web"as const,l:"网页",i:"🌐"},{k:"prompts"as const,l:"提示词",i:"📋"}];

  return(<div className="flex h-full w-full flex-col bg-white dark:bg-gray-900 relative" onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}>
    {dragOver&&<div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm"><div className="rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-gray-800"><p className="text-sm font-medium text-gray-700 dark:text-gray-200">释放以导入 Markdown</p></div></div>}
    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
      <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">{tabs.map(t=><button key={t.k} onClick={()=>setTab(t.k)} className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${tab===t.k?"bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100":"text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{t.i} {t.l}</button>)}</div>
      <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="关闭"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {tab==="web"&&<div className="flex h-full flex-col p-3"><div className="flex shrink-0 gap-1.5 mb-3"><input value={webUrl} onChange={e=>setWebUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doFetch()} placeholder="粘贴网页 URL 后回车…" className={`${inp} flex-1`}/><button onClick={doFetch} disabled={webLoading} className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900">抓取</button></div>
        {webLoading&&<p className="text-xs text-gray-400 animate-pulse">正在获取…</p>}
        {webContent&&<><div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed whitespace-pre-wrap dark:border-gray-700 dark:bg-gray-800">{webContent.slice(0,6000)}</div><button onClick={()=>onInsertMessage("请基于以下网页内容回答：\n\n"+webContent.slice(0,3000))} className="mt-2 w-full shrink-0 rounded-lg bg-gray-900 py-2 text-xs font-medium text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900">发送到对话</button></>}
        {!webContent&&!webLoading&&<p className="text-xs text-gray-400">输入网页 URL 抓取正文</p>}</div>}
      {tab==="markdown"&&<div className="flex h-full flex-col"><div className="flex-1 min-h-0"><MdEditor value={mdContent} onChange={setMdContent} height={window.innerHeight-140} placeholder="在此编写 Markdown，也可拖拽 .md 文件…" aiPolish={false}/></div>
        <div className="flex shrink-0 gap-2 border-t border-gray-200 px-3 py-2 dark:border-gray-700"><button onClick={()=>onInsertMessage(mdContent)} disabled={!mdContent.trim()} className="flex-1 rounded-lg bg-gray-900 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900">发送到对话</button>
        <button onClick={()=>mdContent.trim()?addP(mdContent.slice(0,30)):addP()} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">存为提示词</button>
        <button onClick={()=>setMdContent("")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">清空</button></div></div>}
      {tab==="prompts"&&<div className="flex h-full"><div className="flex w-36 shrink-0 flex-col border-r border-gray-200 dark:border-gray-700"><button onClick={()=>addP()} className="border-b border-gray-100 px-2 py-2 text-xs font-medium text-blue-600 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">+ 新建</button>
        <div className="min-h-0 flex-1 overflow-y-auto">{prompts.map((p,i)=><div key={i} onClick={()=>{setActivePrompt(p);setTab("prompts")}} className={`group flex cursor-pointer items-center justify-between px-2 py-1.5 text-xs transition ${activePrompt===p?"bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400":"text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800"}`}><span className="min-w-0 truncate">{p.name}</span><button onClick={e=>{e.stopPropagation();delP(i)}} className="ml-1 hidden shrink-0 rounded text-gray-400 hover:text-red-500 group-hover:block">×</button></div>)}</div></div>
        <div className="flex min-w-0 flex-1 flex-col">{activePrompt?<><input value={activePrompt.name} onChange={e=>{const n=prompts.map(p=>p===activePrompt?{...p,name:e.target.value}:p);setPrompts(n);save(n);setActivePrompt({...activePrompt,name:e.target.value})}} className="border-b border-gray-200 bg-transparent px-3 py-1.5 text-sm font-medium outline-none dark:border-gray-700 dark:text-gray-200"/><div className="min-h-0 flex-1"><MdEditor value={activePrompt.content} onChange={updP} height={window.innerHeight-160} placeholder="提示词内容…" aiPolish={false}/></div></>:<div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400"><p className="text-sm">选择或新建提示词文件</p><p className="text-xs">拖拽 .md 文件到此区域导入</p><button onClick={()=>addP()} className="mt-2 rounded-lg border border-gray-200 px-4 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700">新建文件</button></div>}</div></div>}
    </div>
  </div>);
}
