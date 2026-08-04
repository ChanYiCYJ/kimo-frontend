import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { articleApi, categoryApi, pageApi, tagApi } from '../lib/api'
import type { AIChatConfig } from '../lib/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Session {
  id: string
  title: string
  messages: Message[]
  createdAt: number
}

const STORAGE_PREFIX = 'kimo_chat_'

async function streamChat(cfg: AIChatConfig, msgs: Message[], onChunk: (t: string) => void, signal: AbortSignal, summary = '', knowledge = '', memory = '') {
  const sys = (cfg.systemPrompt || '')
    + (memory ? `\n\n以下是过往对话中学习到的用户偏好与经验，请据此优化你的回答：\n${memory}` : '')
    + (summary ? `\n\n对话上下文摘要：\n${summary}` : '')
    + (knowledge ? `\n\n以下是本站点知识库内容，请优先基于它回答问题：\n${knowledge}` : '')
  const res = await fetch(cfg.endpoint.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: sys }, ...msgs.map(m => ({ role: m.role, content: m.content }))],
      temperature: 0.7, stream: true,
    }),
    signal,
  })
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`AI 请求失败 (${res.status})${t ? ': ' + t.slice(0,100) : ''}`) }
  const reader = res.body?.getReader(); if (!reader) throw new Error('不支持流式')
  const dec = new TextDecoder(); let full = ''
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    for (const line of dec.decode(value, { stream: true }).split('\n').filter(l => l.startsWith('data: '))) {
      const d = line.slice(6); if (d === '[DONE]') continue
      try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) { full += t; onChunk(full) } } catch {}
    }
  }
  return full
}

/** TTS 朗读文本 */
function speak(text: string) {
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'zh-CN'; u.rate = 1.1; u.pitch = 1
  window.speechSynthesis.speak(u)
}

const SESSION_STORAGE = (pageId: number) => STORAGE_PREFIX + 'sessions_' + pageId

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

export function AIChat({ config, pageId }: { config: AIChatConfig; pageId: number }) {
  const [sessions, setSessions] = useState<Session[]>(() => {
    try { const r = localStorage.getItem(SESSION_STORAGE(pageId)); if (r) { const p = JSON.parse(r); if (Array.isArray(p) && p.length) return p } } catch {}
    return [{ id: uid(), title: '新对话', messages: [], createdAt: Date.now() }]
  })
  const [activeId, setActiveId] = useState<string>(() => sessions[0]?.id || '')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(() => {
    try { const end = Number(localStorage.getItem(STORAGE_PREFIX + 'cooldown_' + pageId)); if (end > Date.now()) return Math.ceil((end - Date.now()) / 1000) } catch {}
    return 0
  })
  const [speakingIdx, setSpeakingIdx] = useState(-1)
  const [stick, setStick] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [kbOn, setKbOn] = useState(false)
  const [kbLoading, setKbLoading] = useState(false)
  const [kbData, setKbData] = useState('')
  const [memory, setMemory] = useState(() => { try { return localStorage.getItem(STORAGE_PREFIX + 'memory_' + pageId) || '' } catch { return '' } })
  const [ttsOn, setTtsOn] = useState(!!config.autoTTS)
  const [consented, setConsented] = useState(() => { try { return localStorage.getItem(STORAGE_PREFIX + 'consent_' + pageId) === '1' } catch { return false } })
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgListRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const active = sessions.find(s => s.id === activeId) || sessions[0]
  const messages = active?.messages || []

  const saveSessions = useCallback((next: Session[]) => {
    setSessions(next)
    try { localStorage.setItem(SESSION_STORAGE(pageId), JSON.stringify(next)) } catch {}
  }, [pageId])

  const updateActive = useCallback((mut: (msgs: Message[]) => Message[]) => {
    saveSessions(sessions.map(s => s.id === activeId ? { ...s, messages: mut(s.messages) } : s))
  }, [sessions, activeId, saveSessions])

  const newSession = useCallback(() => {
    const s: Session = { id: uid(), title: '新对话', messages: [], createdAt: Date.now() }
    saveSessions([s, ...sessions])
    setActiveId(s.id)
    setStick(true)
    setSidebarOpen(false)
  }, [sessions, saveSessions])

  const selectSession = useCallback((id: string) => {
    setActiveId(id); setStick(true); setSidebarOpen(false)
  }, [])

  const deleteSession = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const rest = sessions.filter(s => s.id !== id)
    saveSessions(rest.length ? rest : [{ id: uid(), title: '新对话', messages: [], createdAt: Date.now() }])
    if (id === activeId) setActiveId((rest[0] || sessions[0]).id)
  }, [sessions, activeId, saveSessions])

  // 手机键盘
  useEffect(() => {
    const el = inputRef.current; if (!el) return
    const onFocus = () => { setStick(true); setTimeout(autoScroll, 300) }
    el.addEventListener('focus', onFocus)
    return () => el.removeEventListener('focus', onFocus)
  })

  useEffect(() => { if (activeId && !sessions.find(s => s.id === activeId)) setActiveId(sessions[0].id) }, [activeId, sessions])

  const isNearBottom = () => { const el = msgListRef.current; if (!el) return true; return el.scrollHeight - el.scrollTop - el.clientHeight < 120 }
  const autoScroll = useCallback(() => { if (isNearBottom()) bottomRef.current?.scrollIntoView({ behavior: 'auto' }) }, [])
  const onScroll = useCallback(() => { if (!isNearBottom()) setStick(false) }, [])
  useEffect(() => { if (stick) autoScroll() }, [messages, stick, autoScroll])

  useEffect(() => {
    if (cooldown <= 0) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }; try { localStorage.removeItem(STORAGE_PREFIX + 'cooldown_' + pageId) } catch {}; return }
    timerRef.current = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [cooldown, pageId])

  const playTTS = useCallback((text: string, idx: number) => {
    if (speakingIdx === idx) { window.speechSynthesis.cancel(); setSpeakingIdx(-1); return }
    setSpeakingIdx(idx)
    const clean = text.replace(/[*_`#~>\[\]\(\)]/g, '').slice(0, 600)
    speak(clean)
    const check = setInterval(() => { if (!window.speechSynthesis.speaking) { setSpeakingIdx(-1); clearInterval(check) } }, 300)
  }, [speakingIdx])

  const loadKnowledge = useCallback(async () => {
    setKbLoading(true)
    try {
      const [articles, categories, tags, pages] = await Promise.allSettled([articleApi.list(1), categoryApi.list(), tagApi.list(), pageApi.list()])
      const parts: string[] = []
      if (articles.status === 'fulfilled' && articles.value.items.length) parts.push('【文章】' + articles.value.items.map(a => `《${a.title}》[${a.category_name || '未分类'}]：${a.description || ''}`).join('\n'))
      if (categories.status === 'fulfilled' && categories.value.length) parts.push('【分类】' + categories.value.map(c => `${c.name}(/${c.slug})`).join('、'))
      if (tags.status === 'fulfilled' && tags.value.length) parts.push('【标签】' + tags.value.map(t => `#${t.tag_name}`).join(' '))
      if (pages.status === 'fulfilled' && pages.value.length) parts.push('【页面】' + pages.value.map(p => `${p.name}(${p.type})`).join('、'))
      setKbData(parts.join('\n\n'))
    } catch { setKbData('') } finally { setKbLoading(false) }
  }, [])

  const toggleKb = useCallback(() => {
    setKbOn(prev => { const next = !prev; if (next && !kbData) loadKnowledge(); return next })
  }, [kbData, loadKnowledge])

  const learn = useCallback((q: string, a: string) => {
    const insight = `用户问：${q.slice(0, 50)} → AI 答：${a.slice(0, 80)}${a.length > 80 ? '…' : ''}`
    const lines = memory.split('\n').filter(Boolean); lines.push(`- ${insight}`); if (lines.length > 12) lines.shift()
    const next = lines.join('\n'); setMemory(next); try { localStorage.setItem(STORAGE_PREFIX + 'memory_' + pageId, next) } catch {}
  }, [memory, pageId])

  // Markdown 文件上传解析
  const onUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      if (inputRef.current) {
        setInput(prev => (prev ? prev + '\n\n' : '') + text)
      }
    }
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const send = async () => {
    const t = input.trim(); if (!t || loading || cooldown > 0) return
    const max = config.maxMessages || 0
    if (max > 0 && messages.length >= max) {
      const msg: Message = { role: 'assistant' as const, content: `对话已达上限（${max} 条），请新建会话继续。` }
      updateActive(prev => [...prev, msg]); return
    }
    const user: Message = { role: 'user' as const, content: t }
    const allMsgs = [...messages, user]
    let summary = ''
    const recent = allMsgs.length > 6 ? allMsgs.slice(-6) : allMsgs
    if (allMsgs.length > 6) summary = allMsgs.slice(0, allMsgs.length - 6).map((m, i) => `${m.role === 'user' ? '问' : '答'}${i+1}: ${m.content.slice(0, 60)}`).join('; ')
    updateActive(prev => [...prev, user]); setInput(''); setLoading(true); setStick(true)
    setCooldown(config.cooldown || 60)
    try { localStorage.setItem(STORAGE_PREFIX + 'cooldown_' + pageId, String(Date.now() + (config.cooldown || 60) * 1000)) } catch {}
    const ctrl = new AbortController(); abortRef.current = ctrl; let reply = ''
    try {
      reply = await streamChat(config, recent, full => updateActive(prev => [...prev, { role: 'assistant' as const, content: full }]), ctrl.signal, summary, kbOn ? kbData : '', memory)
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      reply = `错误：${e instanceof Error ? e.message : '请求失败'}`
    } finally { if (abortRef.current === ctrl) abortRef.current = null; setLoading(false) }
    updateActive(prev => [...prev, { role: 'assistant' as const, content: reply }])
    if (!reply.startsWith('错误')) learn(t, reply)
    if (ttsOn) setTimeout(() => speak(reply.replace(/[*_`#~>\[\]\(\)]/g, '').slice(0, 600)), 500)
  }

  const exportChat = () => {
    const text = messages.map(m => `**${m.role === 'user' ? '👤 用户' : '🤖 ' + (config.botName || 'AI')}**\n${m.content}\n`).join('\n---\n\n')
    const blob = new Blob(['\uFEFF' + text], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `chat-${config.botName || 'ai'}-${new Date().toISOString().slice(0,10)}.md`; a.click(); URL.revokeObjectURL(a.href)
  }

  if (!consented) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-gray-700 dark:bg-gray-900 max-sm:mx-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">使用须知</h3>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          <p>使用本 AI 对话功能前，请了解以下信息：</p>
          <div className="space-y-2">
            <p className="font-medium text-gray-800 dark:text-gray-300">📋 温馨提示</p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>对话记录保存在您的浏览器本地，不会上传服务器。</li>
              <li>AI 回复由第三方 API 生成，内容仅供参考，请自行判断准确性。</li>
              <li>请勿生成违法违规内容，共同维护良好的网络环境。</li>
              <li>由于 Token 额度限制，回复长度或频率可能有所限制。</li>
              <li>请勿输入密码、身份证号等个人敏感信息。</li>
            </ul>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-gray-800 dark:text-gray-300">📧 联系与反馈</p>
            <p>如有问题或建议，欢迎联系：<a href="mailto:jasonchan0654@gmail.com" className="text-blue-600 hover:underline dark:text-blue-400">jasonchan0654@gmail.com</a></p>
          </div>
        </div>
        <button onClick={() => { setConsented(true); try { localStorage.setItem(STORAGE_PREFIX + 'consent_' + pageId, '1') } catch {} }}
          className="mt-6 w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
          我已阅读并同意，开始对话
        </button>
      </div>
    )
  }

  if (!config.endpoint || !config.apiKey || !config.model) {
    return <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">AI 对话未配置。请在后台编辑此页面。</div>
  }

  const chatBody = (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/* 顶栏：极简 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-3 py-2.5 dark:border-gray-700 sm:px-4 sm:py-3">
        <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 sm:hidden" title="会话列表">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>
        <button onClick={() => setCollapsed(!collapsed)} className="hidden rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 lg:block" title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>
        {config.avatar ? <img src={config.avatar} alt={config.botName} className="h-7 w-7 rounded-full object-cover sm:h-8 sm:w-8" /> : <span className="grid h-7 w-7 place-content-center rounded-full bg-gray-900 text-[10px] font-bold text-white sm:h-8 sm:w-8 sm:text-xs dark:bg-gray-200 dark:text-gray-900">{(config.botName || 'AI').slice(0, 2)}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{config.botName || 'AI 助手'}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${loading ? 'bg-green-400 animate-pulse' : 'bg-green-500'}`} />
          </div>
          <p className="text-[11px] text-gray-400">{loading ? '回复中...' : active?.title || '新对话'}</p>
        </div>
        <button onClick={() => setFullscreen(!fullscreen)} className="rounded-lg p-1.5 text-gray-400 transition hover:text-gray-600" title={fullscreen ? '退出全屏' : '全屏'}>
          {fullscreen ? '⤢' : '⛶'}
        </button>
      </div>

      {/* 消息区 */}
      <div ref={msgListRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4 sm:py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-16 text-center">
              {config.avatar ? <img src={config.avatar} alt={config.botName} className="mb-3 h-14 w-14 rounded-full object-cover" /> : <span className="mb-3 grid h-14 w-14 place-content-center rounded-full bg-gray-100 text-xl font-bold text-gray-400 dark:bg-gray-800">AI</span>}
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{config.botName || 'AI 助手'}</p>
              <p className="mt-1 text-xs text-gray-400">有什么可以帮你？</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {['介绍一下这个网站', '帮我写一段代码', '总结我的文章', '给我一些建议'].map(s => (
                  <button key={s} onClick={() => setInput(s)} className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:hover:border-gray-500">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`group flex gap-2.5 py-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
                  {m.role === 'assistant' && (config.avatar ? <img src={config.avatar} className="mt-1 h-6 w-6 shrink-0 rounded-full object-cover" alt="" /> : <span className="mt-1 grid h-6 w-6 shrink-0 place-content-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800">AI</span>)}
                  <div className={`relative max-w-[85%] sm:max-w-[78%] ${m.role === 'user' ? 'rounded-2xl bg-gray-900 px-3.5 py-2 text-sm text-white sm:px-4 sm:py-2.5 dark:bg-gray-200 dark:text-gray-900' : 'flex-1 text-sm text-gray-800 dark:text-gray-200'}`}>
                    {m.role === 'assistant'
                      ? <div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                      : <span className="whitespace-pre-wrap">{m.content}</span>}
                    {m.role === 'assistant' && (
                      <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                        <button onClick={() => playTTS(m.content, i)} className={`rounded-md p-1 transition ${speakingIdx === i ? 'text-blue-500' : 'text-gray-400 hover:text-gray-600'}`}>
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-2.5 py-3">
                  <span className="mt-1 grid h-6 w-6 shrink-0 place-content-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800">AI</span>
                  <div className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2.5 dark:bg-gray-800">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.15s' }} /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              )}
              <p className="pt-2 text-center text-[11px] text-gray-300 dark:text-gray-600">AI 生成内容仅供参考 · 联系：jasonchan0654@gmail.com</p>
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入栏：功能整合 */}
      <div className="shrink-0 border-t border-gray-100 p-3 dark:border-gray-700 sm:p-4">
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition focus-within:border-gray-400 dark:border-gray-700 dark:bg-gray-800">
            <button onClick={() => fileRef.current?.click()} className="shrink-0 rounded-lg p-2 text-gray-400 transition hover:text-gray-600" title="上传 Markdown 文件">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>
            </button>
            <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" onChange={onUpload} className="hidden" />
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={`向 ${config.botName || 'AI'} 发送消息...`} disabled={loading}
              rows={1} style={{ resize: 'none' }}
              className="max-h-32 min-h-[24px] flex-1 bg-transparent py-1.5 text-sm text-gray-800 outline-none disabled:opacity-50 dark:text-gray-200" />
            <button onClick={toggleKb} className={`shrink-0 rounded-lg px-2 py-1 text-xs transition ${kbOn ? 'text-indigo-500' : 'text-gray-400 hover:text-gray-600'}`} title="知识库">{kbLoading ? '⏳' : '📚'}</button>
            {config.autoTTS && <button onClick={() => setTtsOn(!ttsOn)} className={`shrink-0 rounded-lg px-1 py-1 text-xs transition ${ttsOn ? 'text-green-500' : 'text-gray-400 hover:text-gray-600'}`} title="自动朗读">{ttsOn ? '🔊' : '🔇'}</button>}
            {messages.length > 0 && <button onClick={exportChat} className="shrink-0 rounded-lg px-1 py-1 text-xs text-gray-400 transition hover:text-gray-600" title="导出">⤓</button>}
            <button onClick={send} disabled={loading || !input.trim() || cooldown > 0}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
              {cooldown > 0 ? <span className="text-[10px]">{cooldown}</span> : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" /></svg>}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-300 dark:text-gray-600">Shift+Enter 换行 · AI 生成内容仅供参考</p>
        </div>
      </div>
    </div>
  )

  const sidebar = (
    <div className="flex h-full w-60 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="p-3">
        <button onClick={newSession} className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>新建会话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.map(s => (
          <div key={s.id} onClick={() => selectSession(s.id)} className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${s.id === activeId ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900'}`}>
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <button onClick={e => deleteSession(e, s.id)} className="hidden shrink-0 text-gray-300 transition hover:text-red-500 group-hover:block">×</button>
          </div>
        ))}
      </div>
    </div>
  )

  const layout = (
    <div className="flex h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* 桌面端侧边栏 */}
      <div className={`hidden ${collapsed ? 'lg:hidden' : 'lg:block'} border-r border-gray-100 dark:border-gray-800`}>{sidebar}</div>
      <div className="flex-1">{chatBody}</div>
      {/* 移动端侧边栏 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}
    </div>
  )

  const wrapper = (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-900 sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-gray-700" style={{ height: '100dvh', maxHeight: fullscreen ? '100dvh' : 'calc(100dvh - 5rem)' }}>
      {layout}
    </div>
  )

  return fullscreen ? createPortal(<div className="fixed inset-0 z-[100] bg-white dark:bg-gray-900">{layout}</div>, document.body) : wrapper
}
