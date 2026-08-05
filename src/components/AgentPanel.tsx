import { useState, useCallback } from 'react'
import { fetchWebpage } from '../lib/search'
import { useToast } from '../lib/toast'

interface AgentPanelProps {
  onClose: () => void
  onInsertMessage: (text: string) => void
}

export function AgentPanel({ onClose, onInsertMessage }: AgentPanelProps) {
  const { error } = useToast()
  const [tab, setTab] = useState<'web' | 'markdown' | 'memory'>('web')
  const [webUrl, setWebUrl] = useState('')
  const [webContent, setWebContent] = useState('')
  const [webLoading, setWebLoading] = useState(false)
  const [mdContent, setMdContent] = useState('')
  const [memoryText, setMemoryText] = useState(() => {
    try { return localStorage.getItem('kimo_agent_memory') || '' } catch { return '' }
  })

  const handleFetch = useCallback(async () => {
    const u = webUrl.trim()
    if (!/^https?:\/\//i.test(u)) { error('请输入完整的网址(https://...)'); return }
    setWebLoading(true)
    try {
      const text = await fetchWebpage(u)
      if (text) { setWebContent(text); setMemoryText((prev) => prev + `\n[浏览] ${u}\n`) }
      else error('无法获取该网页内容(CORS 或后端不可达)')
    } catch { error('抓取失败') }
    finally { setWebLoading(false) }
  }, [webUrl, error])

  const injectToChat = (text: string) => {
    onInsertMessage(text)
    onClose()
  }

  const tabs = [
    { key: 'web' as const, label: '网页', icon: '🌐' },
    { key: 'markdown' as const, label: '文档', icon: '📝' },
    { key: 'memory' as const, label: '记忆', icon: '🧠' },
  ]

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800'

  return (
    <div className="flex h-full w-full flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
        <div className="flex gap-0.5 rounded-lg bg-gray-200 p-0.5 dark:bg-gray-800">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >{t.icon} {t.label}</button>
          ))}
        </div>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="关闭">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'web' && (
          <div className="space-y-3">
            <div className="flex gap-1.5">
              <input value={webUrl} onChange={e => setWebUrl(e.target.value)} onKeyDown={e => e.key==='Enter' && handleFetch()}
                placeholder="粘贴网页 URL..." className={`${inputCls} flex-1`} />
              <button onClick={handleFetch} disabled={webLoading}
                className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900">抓取</button>
            </div>
            {webLoading && <p className="text-xs text-gray-400 animate-pulse">正在获取网页内容…</p>}
            {webContent && (
              <div className="space-y-2">
                <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-700 whitespace-pre-wrap dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  {webContent.slice(0, 3000)}
                </div>
                <button onClick={() => injectToChat(`请基于以下网页内容回答：\n\n${webContent.slice(0, 2000)}`)}
                  className="w-full rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900">发送到对话</button>
              </div>
            )}
          </div>
        )}

        {tab === 'markdown' && (
          <div className="space-y-3">
            <textarea value={mdContent} onChange={e => setMdContent(e.target.value)}
              rows={15} placeholder="输入 Markdown 内容…" className={`${inputCls} resize-none font-mono`} />
            <div className="flex gap-2">
              <button onClick={() => injectToChat(mdContent)}
                className="flex-1 rounded-lg bg-gray-900 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900">发送到对话</button>
              <button onClick={() => { setMdContent('') }}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">清空</button>
            </div>
            <p className="text-[11px] text-gray-400">用 AI 润色或改写你的草稿，也可以直接作为消息发送。</p>
          </div>
        )}

        {tab === 'memory' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">记录你自己的提示、规则、笔记。AI 对话时这些内容会注入系统提示。</p>
            <textarea value={memoryText} onChange={e => { setMemoryText(e.target.value); try{localStorage.setItem('kimo_agent_memory',e.target.value)}catch{} }}
              rows={10} placeholder="自定义规则、偏好、笔记…" className={`${inputCls} resize-none`} />
            <button onClick={() => { setMemoryText(''); try{localStorage.removeItem('kimo_agent_memory')}catch{} }}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-800">清除</button>
          </div>
        )}
      </div>
    </div>
  )
}
