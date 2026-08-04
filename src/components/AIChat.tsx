import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AIChatConfig, Page } from '../lib/types'
import { useSite } from '../lib/site'
import { useTheme } from '../lib/theme'
import { webSearch } from '../lib/search'
import { getKbSelections, getKbNotes, assembleKnowledge } from '../lib/kb'
import { KbModal } from './KbModal'

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

export interface BotItem {
  id: number
  name: string
  config: AIChatConfig
  page: Page
}

interface AIChatProps {
  config: AIChatConfig
  pageId: number
  center?: boolean
  bots?: BotItem[]
  onSwitchBot?: (id: number) => void
  canManage?: boolean
  onManage?: () => void
}

const STORAGE_PREFIX = 'kimo_chat_'

async function streamChat(cfg: AIChatConfig, msgs: Message[], onChunk: (t: string) => void, signal: AbortSignal, summary = '', knowledge = '', memory = '', web = '') {
  const sys = (cfg.systemPrompt || '')
    + (memory ? `\n\n以下是过往对话中学习到的用户偏好与经验，请据此优化你的回答：\n${memory}` : '')
    + (summary ? `\n\n对话上下文摘要：\n${summary}` : '')
    + (knowledge ? `\n\n以下是本站点知识库内容，请优先基于它回答问题：\n${knowledge}` : '')
    + (web ? `\n\n以下是来自网络的最新搜索结果，请基于它们回答（并在适当时注明来源）：\n${web}` : '')
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

export function AIChat({ config, pageId, center, bots, onSwitchBot, canManage, onManage }: AIChatProps) {
  const { settings } = useSite()
  const { theme, toggle: toggleTheme } = useTheme()
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
  const [kbText, setKbText] = useState('')
  const [kbOpen, setKbOpen] = useState(false)
  const [webSearchOn, setWebSearchOn] = useState(() => { try { return localStorage.getItem('kimo_ai_websearch') === '1' } catch { return false } })
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [botMenuOpen, setBotMenuOpen] = useState(false)
  const [memory, setMemory] = useState(() => { try { return localStorage.getItem(STORAGE_PREFIX + 'memory_' + pageId) || '' } catch { return '' } })
  const [ttsOn, setTtsOn] = useState(!!config.autoTTS)
  const [consented, setConsented] = useState(() => { try { return localStorage.getItem(STORAGE_PREFIX + 'consent_' + pageId) === '1' } catch { return false } })
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgListRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = sessions.find(s => s.id === activeId) || sessions[0]
  const messages = active?.messages || []

  const persistSessions = useCallback((next: Session[]) => {
    try { localStorage.setItem(SESSION_STORAGE(pageId), JSON.stringify(next)) } catch {}
  }, [pageId])

  const saveSessions = useCallback((next: Session[]) => {
    setSessions(next)
    persistSessions(next)
  }, [persistSessions])

  // 更新当前会话消息：用函数式 setState 避免异步流式回调里的旧闭包导致消息丢失
  const updateActive = useCallback((mut: (msgs: Message[]) => Message[]) => {
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== activeId) return s
        const msgs = mut(s.messages)
        // 首次对话自动根据用户消息设置标题
        const title = s.title === '新对话' && msgs.length && msgs[0].role === 'user' ? msgs[0].content.slice(0, 20) : s.title
        return { ...s, messages: msgs, title }
      })
      persistSessions(next)
      return next
    })
  }, [activeId, persistSessions])

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

  // 知识库：根据选择 + 本地笔记组装文本（KbModal 保存后调用 refreshKb 刷新缓存）
  const refreshKb = useCallback(async () => {
    try {
      const sel = getKbSelections(pageId)
      const notes = getKbNotes()
      const text = await assembleKnowledge(sel, notes)
      setKbText(text)
    } catch { setKbText('') }
  }, [pageId])

  const toggleKb = useCallback((on: boolean) => {
    setKbOn(on)
    if (on) refreshKb()
  }, [refreshKb])

  const toggleWebSearch = useCallback(() => {
    setWebSearchOn(prev => { const n = !prev; try { localStorage.setItem('kimo_ai_websearch', n ? '1' : '0') } catch {}; return n })
  }, [])

  // 会话重命名
  const startRename = useCallback((e: React.MouseEvent, s: Session) => {
    e.stopPropagation(); setEditingSessionId(s.id); setEditTitle(s.title)
  }, [])
  const commitRename = useCallback(() => {
    if (editingSessionId) {
      saveSessions(sessions.map(x => x.id === editingSessionId ? { ...x, title: editTitle.trim() || '新对话' } : x))
    }
    setEditingSessionId(null)
  }, [editingSessionId, editTitle, sessions, saveSessions])

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
    // 网络搜索：开启时先抓取结果注入上下文
    let web = ''
    if (webSearchOn) { try { web = await webSearch(t) } catch { web = '' } }
    // 流式：始终只保留一条正在增长的 assistant 消息（替换上一条）
    const upsertAssistant = (content: string) => updateActive(prev => {
      const last = prev[prev.length - 1]
      return last && last.role === 'assistant'
        ? [...prev.slice(0, -1), { role: 'assistant' as const, content }]
        : [...prev, { role: 'assistant' as const, content }]
    })
    try {
      reply = await streamChat(config, recent, upsertAssistant, ctrl.signal, summary, kbOn ? kbText : '', memory, web)
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      reply = `错误：${e instanceof Error ? e.message : '请求失败'}`
    } finally { if (abortRef.current === ctrl) abortRef.current = null; setLoading(false) }
    upsertAssistant(reply)
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

  const iconBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800'

  const chatBody = (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
      {/* 顶栏：/ai 中心页提供品牌+机器人切换+主题+管理；页面模式提供返回 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-100 px-3 py-2 dark:border-gray-700 sm:px-4">
        <button onClick={() => setSidebarOpen(true)} className={`${iconBtn} sm:hidden`} title="会话列表" aria-label="会话列表">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>

        {center ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Link to="/" className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-gray-100 dark:hover:bg-gray-800" title="返回网站">
              {settings.avatar
                ? <img src={settings.avatar} alt="logo" className="h-7 w-7 rounded-full object-cover" />
                : <span className="grid h-7 w-7 place-content-center rounded-full bg-gray-900 text-sm font-bold text-white dark:bg-gray-200 dark:text-gray-900">{(settings.title || 'K').slice(0, 1)}</span>}
              <span className="hidden text-sm font-medium text-gray-900 sm:block dark:text-gray-100">{settings.title || 'Kimo'}</span>
            </Link>
            <div className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
            {bots && bots.length > 1 ? (
              <div className="relative min-w-0">
                <button onClick={() => setBotMenuOpen(v => !v)} className="flex max-w-[170px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  {config.avatar ? <img src={config.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" /> : <span className="grid h-5 w-5 shrink-0 place-content-center rounded-full bg-gray-900 text-[9px] font-bold text-white dark:bg-gray-200 dark:text-gray-900">{(config.botName || 'AI').slice(0, 2)}</span>}
                  <span className="min-w-0 truncate">{config.botName || 'AI'}</span>
                  <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                </button>
                {botMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setBotMenuOpen(false)} />
                    <div className="absolute left-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                      <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-gray-400">切换 AI 助手</p>
                      {bots.map(b => (
                        <button key={b.id} onClick={() => { onSwitchBot?.(b.id); setBotMenuOpen(false) }} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-gray-800 ${b.id === pageId ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>
                          {b.config.avatar ? <img src={b.config.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" /> : <span className="grid h-5 w-5 shrink-0 place-content-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 dark:bg-gray-800">{b.name.slice(0, 2)}</span>}
                          <span className="min-w-0 flex-1 truncate">{b.name}</span>
                          {b.id === pageId && <span className="text-xs text-gray-400">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                {config.avatar ? <img src={config.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" /> : <span className="grid h-7 w-7 shrink-0 place-content-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900">{(config.botName || 'AI').slice(0, 2)}</span>}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{config.botName || 'AI 助手'}</span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${loading ? 'animate-pulse bg-green-400' : 'bg-green-500'}`} />
                  </div>
                  <p className="truncate text-[11px] text-gray-400">{loading ? '回复中...' : active?.title || '新对话'}</p>
                </div>
              </div>
            )}
            <div className="flex-1" />
            {canManage && (
              <button onClick={onManage} className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">管理</button>
            )}
            <button onClick={toggleTheme} className={iconBtn} title="切换主题" aria-label="切换主题">
              {theme === 'light' ? (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>
              )}
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link to="/" className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800" title="返回首页">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
              <span className="hidden text-sm sm:block">返回</span>
            </Link>
            {config.avatar ? <img src={config.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" /> : <span className="grid h-7 w-7 shrink-0 place-content-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900">{(config.botName || 'AI').slice(0, 2)}</span>}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{config.botName || 'AI 助手'}</span>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${loading ? 'animate-pulse bg-green-400' : 'bg-green-500'}`} />
              </div>
              <p className="truncate text-[11px] text-gray-400">{loading ? '回复中...' : active?.title || '新对话'}</p>
            </div>
          </div>
        )}

        <button onClick={() => setCollapsed(!collapsed)} className={`${iconBtn} hidden lg:grid`} title={collapsed ? '展开侧边栏' : '收起侧边栏'} aria-label="切换侧边栏">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>
        <button onClick={() => setFullscreen(!fullscreen)} className={iconBtn} title={fullscreen ? '退出全屏' : '全屏'} aria-label="全屏">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {fullscreen
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M15 9h4.5M15 9V4.5M9 15v4.5M9 15H4.5M15 15h4.5M15 15v4.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9M3.75 20.25h4.5m-4.5 0v-4.5m0 4.5L9 15m11.25 3.75h-4.5m4.5 0v-4.5m0 4.5L15 15" />}
          </svg>
        </button>
      </div>

      {/* 消息区 */}
      <div ref={msgListRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-gray-50/40 dark:bg-gray-950/40">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-[12vh] text-center">
              {config.avatar ? <img src={config.avatar} alt={config.botName} className="mb-4 h-16 w-16 rounded-full object-cover" /> : <span className="mb-4 grid h-16 w-16 place-content-center rounded-full bg-gray-100 text-2xl font-bold text-gray-400 dark:bg-gray-800">AI</span>}
              <p className="text-base font-medium text-gray-700 dark:text-gray-300">{config.botName || 'AI 助手'}</p>
              <p className="mt-1 text-sm text-gray-400">有什么可以帮你？</p>
              <div className="mt-8 flex w-full max-w-md flex-wrap justify-center gap-2">
                {['介绍一下这个网站', '帮我写一段代码', '总结我的文章', '给我一些建议'].map(s => (
                  <button key={s} onClick={() => setInput(s)} className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition hover:border-gray-500 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`group flex gap-3 py-4 ${m.role === 'user' ? 'justify-end' : ''} sm:py-5`}>
                  {m.role === 'assistant' && (
                    config.avatar
                      ? <img src={config.avatar} alt="" className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover" />
                      : <span className="mt-0.5 grid h-8 w-8 shrink-0 place-content-center rounded-full bg-gray-200 text-xs font-bold text-gray-500 dark:bg-gray-800">AI</span>
                  )}
                  <div className={`min-w-0 ${m.role === 'user' ? 'max-w-[85%] rounded-2xl bg-gray-900 px-4 py-2.5 text-sm leading-relaxed text-white sm:max-w-[70%] dark:bg-gray-200 dark:text-gray-900' : 'flex-1 text-[15px] leading-relaxed text-gray-800 dark:text-gray-100'}`}>
                    {m.role === 'assistant'
                      ? <div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                      : <span className="whitespace-pre-wrap">{m.content}</span>}
                    {m.role === 'assistant' && (
                      <div className={`mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 ${speakingIdx === i ? 'opacity-100' : ''}`}>
                        <button onClick={() => playTTS(m.content, i)} className={`rounded-md p-1 transition ${speakingIdx === i ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`} title="朗读">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3 py-4 sm:py-5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-content-center rounded-full bg-gray-200 text-xs font-bold text-gray-500 dark:bg-gray-800">AI</span>
                  <div className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-4 py-3 dark:bg-gray-800">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" /><span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.15s' }} /><span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0.3s' }} />
                  </div>
                </div>
              )}
              <p className="pt-2 text-center text-[11px] text-gray-400/70 dark:text-gray-500/70">AI 生成内容仅供参考 · 联系：jasonchan0654@gmail.com</p>
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 输入栏：ChatGPT 风格整合，按钮统一尺寸 */}
      <div className="shrink-0 bg-white px-3 pb-3 pt-2 dark:bg-gray-900 sm:px-6 sm:pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-center gap-0.5 rounded-[24px] border border-gray-300 bg-white p-1.5 shadow-sm transition focus-within:border-gray-500 focus-within:shadow-md dark:border-gray-600 dark:bg-gray-800">
            <button onClick={() => fileRef.current?.click()} className={iconBtn} title="上传 Markdown 文件" aria-label="上传文件">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" /></svg>
            </button>
            <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" onChange={onUpload} className="hidden" />
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={`向 ${config.botName || 'AI'} 发送消息...`} disabled={loading}
              rows={1} style={{ resize: 'none' }}
              className="max-h-40 min-h-[38px] flex-1 self-center bg-transparent px-2 py-2 text-[15px] leading-6 text-gray-800 outline-none placeholder:text-gray-400 disabled:opacity-50 dark:text-gray-100" />
            <button onClick={toggleWebSearch} className={`${iconBtn} ${webSearchOn ? 'text-blue-500' : ''}`} title={webSearchOn ? '关闭网络搜索' : '开启网络搜索'} aria-label="网络搜索">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill={webSearchOn ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
            </button>
            <button onClick={() => setKbOpen(true)} className={`${iconBtn} ${kbOn ? 'text-indigo-500 dark:text-indigo-400' : ''}`} title="知识库设置" aria-label="知识库">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill={kbOn ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
            </button>
            {config.autoTTS && (
              <button onClick={() => setTtsOn(!ttsOn)} className={`${iconBtn} ${ttsOn ? 'text-green-500' : ''}`} title={ttsOn ? '关闭自动朗读' : '开启自动朗读'} aria-label="自动朗读">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill={ttsOn ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" /></svg>
              </button>
            )}
            {messages.length > 0 && (
              <button onClick={exportChat} className={iconBtn} title="导出对话" aria-label="导出">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              </button>
            )}
            <button onClick={send} disabled={loading || !input.trim() || cooldown > 0}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300">
              {cooldown > 0
                ? <span className="text-xs font-medium">{cooldown}</span>
                : <svg className="h-4 w-4 translate-x-px" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" /></svg>}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-400/70 dark:text-gray-500/70">Shift+Enter 换行 · AI 生成内容仅供参考</p>
        </div>
      </div>
    </div>
  )

  const sidebar = (
    <div className="flex h-full w-64 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="p-3">
        <button onClick={newSession} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>新建会话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.map(s => (
          <div key={s.id} onClick={() => selectSession(s.id)} className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition ${s.id === activeId ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900'}`}>
            <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
            {s.id === editingSessionId ? (
              <input
                autoFocus
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingSessionId(null) }}
                onClick={e => e.stopPropagation()}
                className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
            )}
            {s.id !== editingSessionId && (
              <button onClick={e => startRename(e, s)} className="hidden shrink-0 text-gray-300 transition hover:text-gray-600 group-hover:block" title="重命名" aria-label="重命名">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
              </button>
            )}
            <button onClick={e => deleteSession(e, s.id)} className="hidden shrink-0 text-gray-300 transition hover:text-red-500 group-hover:block" title="删除">×</button>
          </div>
        ))}
      </div>
    </div>
  )

  // 桌面端侧边栏（可折叠）+ 移动端抽屉
  const desktopSidebar = (
    <div className={`hidden shrink-0 ${collapsed ? 'lg:hidden' : 'lg:block'} border-r border-gray-200 dark:border-gray-800`}>
      {sidebar}
    </div>
  )

  const mobileSidebar = sidebarOpen && (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      <div className="absolute inset-y-0 left-0 w-64 shadow-2xl">{sidebar}</div>
    </div>
  )

  const layout = (
    <div className="flex h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900">
      {desktopSidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chatBody}</div>
      {mobileSidebar}
    </div>
  )

  return (
    <>
      <KbModal open={kbOpen} onClose={() => setKbOpen(false)} pageId={pageId} kbOn={kbOn} onToggleKb={toggleKb} onApplied={refreshKb} />
      {fullscreen
        ? createPortal(<div className="fixed inset-0 z-[100] bg-white dark:bg-gray-900">{layout}</div>, document.body)
        : layout}
    </>
  )
}
