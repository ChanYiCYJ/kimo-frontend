import { useState, useRef, useEffect, useCallback } from 'react'
import type { AIChatConfig } from '../lib/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STORAGE_PREFIX = 'kimo_chat_'

async function streamChat(cfg: AIChatConfig, msgs: Message[], onChunk: (t: string) => void, signal: AbortSignal, summary = '') {
  const sys = (cfg.systemPrompt || '') + (summary ? `\n\n对话知识库摘要：\n${summary}` : '')
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

export function AIChat({ config, pageId }: { config: AIChatConfig; pageId: number }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(() => {
    try {
      const end = Number(localStorage.getItem(STORAGE_PREFIX + 'cooldown_' + pageId))
      if (end > Date.now()) return Math.ceil((end - Date.now()) / 1000)
    } catch {}
    return 0
  })
  const [speakingIdx, setSpeakingIdx] = useState(-1)
  const [stick, setStick] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [ttsOn, setTtsOn] = useState(!!config.autoTTS)
  const [consented, setConsented] = useState(() => {
    try { return localStorage.getItem(STORAGE_PREFIX + 'consent_' + pageId) === '1' } catch { return false }
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgListRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 修复手机键盘弹起时页面跳动
  useEffect(() => {
    const el = inputRef.current; if (!el) return
    const onFocus = () => {
      setStick(true)
      setTimeout(autoScroll, 300)
    }
    el.addEventListener('focus', onFocus)
    return () => el.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    try { const r = localStorage.getItem(STORAGE_PREFIX + 'history_' + pageId); if (r) setMessages(JSON.parse(r)) } catch {}
  }, [pageId])

  const save = useCallback((msgs: Message[]) => {
    try { localStorage.setItem(STORAGE_PREFIX + 'history_' + pageId, JSON.stringify(msgs)) } catch {}
  }, [pageId])

  const isNearBottom = () => {
    const el = msgListRef.current; if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  // 仅当用户位于底部时才自动跟随，避免阅读中被拽走
  const autoScroll = useCallback(() => {
    if (isNearBottom()) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [])

  // 用户手动上滑时停止跟随
  const onScroll = useCallback(() => {
    if (!isNearBottom()) setStick(false)
  }, [])

  useEffect(() => {
    if (stick) autoScroll()
  }, [messages, stick, autoScroll])

  useEffect(() => {
    if (cooldown <= 0) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      try { localStorage.removeItem(STORAGE_PREFIX + 'cooldown_' + pageId) } catch {}
      return
    }
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

  const send = async () => {
    const t = input.trim(); if (!t || loading || cooldown > 0) return
    // 消息数限制检查
    const max = config.maxMessages || 0
    if (max > 0 && messages.length >= max) {
      setMessages(prev => [...prev, { role: 'assistant' as const, content: `对话已达上限（${max} 条），请点击「清除」开始新对话。` }])
      save([...messages, { role: 'assistant' as const, content: `对话已达上限（${max} 条），请点击「清除」开始新对话。` }])
      return
    }
    const user: Message = { role: 'user' as const, content: t }
    const allMsgs = [...messages, user]
    // 知识库摘要：超过6条时提取前部对话作为上下文
    let summary = ''
    const recent = allMsgs.length > 6 ? allMsgs.slice(-6) : allMsgs
    if (allMsgs.length > 6) {
      summary = allMsgs.slice(0, allMsgs.length - 6).map((m, i) => `${m.role === 'user' ? '问' : '答'}${i+1}: ${m.content.slice(0, 60)}`).join('; ')
    }
    setMessages(allMsgs); setInput(''); setLoading(true); save(allMsgs)
    setStick(true)
    setCooldown(config.cooldown || 60)
    try { localStorage.setItem(STORAGE_PREFIX + 'cooldown_' + pageId, String(Date.now() + (config.cooldown || 60) * 1000)) } catch {}
    const ctrl = new AbortController(); abortRef.current = ctrl; let reply = ''
    try {
      reply = await streamChat(config, recent, full => setMessages([...allMsgs, { role: 'assistant' as const, content: full }]), ctrl.signal, summary)
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      reply = `错误：${e instanceof Error ? e.message : '请求失败'}`
    } finally { if (abortRef.current === ctrl) abortRef.current = null; setLoading(false) }
    const fin: Message[] = [...allMsgs, { role: 'assistant' as const, content: reply }]; setMessages(fin); save(fin)
    // 自动朗读
    if (ttsOn) { setTimeout(() => speak(reply.replace(/[*_`#~>\[\]\(\)]/g, '').slice(0, 600)), 500) }
  }

  const exportChat = () => {
    const text = messages.map(m => `**${m.role === 'user' ? '👤 用户' : '🤖 ' + (config.botName || 'AI')}**\n${m.content}\n`).join('\n---\n\n')
    const blob = new Blob(['\uFEFF' + text], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `chat-${config.botName || 'ai'}-${new Date().toISOString().slice(0,10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
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

  return (
    <div ref={containerRef} className={`flex flex-col bg-white dark:bg-gray-900 ${fullscreen ? 'fixed inset-0 z-50 rounded-none border-0 max-sm:m-0' : 'sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-gray-700 max-sm:-mx-4 max-sm:-mt-10'}`} style={{ height: '100dvh', maxHeight: fullscreen ? '100dvh' : 'calc(100dvh - 4rem)' }}>
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2.5 dark:border-gray-700 sm:px-4 sm:py-3 sm:rounded-t-2xl">
        <div className="flex items-center gap-2 sm:gap-3">
          {config.avatar ? (
            <img src={config.avatar} alt={config.botName} className="h-7 w-7 rounded-full object-cover ring-1 ring-gray-200 sm:h-8 sm:w-8 dark:ring-gray-700" />
          ) : (
            <span className="grid h-7 w-7 place-content-center rounded-full bg-gray-900 text-[10px] font-bold text-white sm:h-8 sm:w-8 sm:text-xs dark:bg-gray-200 dark:text-gray-900">
              {(config.botName || 'AI').slice(0, 2)}
            </span>
          )}
          <div>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{config.botName || 'AI 助手'}</span>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${loading ? 'bg-green-400 animate-pulse' : 'bg-green-500'}`} />
              <p className="text-[11px] text-gray-400">{loading ? '回复中...' : '在线'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1">
          {config.autoTTS && (
            <button onClick={() => setTtsOn(!ttsOn)}
              className={`rounded-lg px-1.5 py-1 text-xs transition sm:px-2 ${ttsOn ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'text-gray-400 hover:text-gray-600'}`}
              title={ttsOn ? '关闭自动朗读' : '开启自动朗读'}>
              {ttsOn ? '🔊' : '🔇'}
            </button>
          )}
          <button onClick={() => { setMessages([]); try { localStorage.removeItem(STORAGE_PREFIX + 'history_' + pageId) } catch {} }}
            className="rounded-lg px-1.5 py-1 text-xs text-gray-400 transition hover:text-red-500 sm:px-2">清除</button>
          <button onClick={() => setFullscreen(!fullscreen)}
            className="rounded-lg px-1.5 py-1 text-xs text-gray-400 transition hover:text-gray-600 sm:px-2" title={fullscreen ? '退出全屏' : '全屏显示'}>
            {fullscreen ? '⤢' : '⛶'}
          </button>
          {messages.length > 0 && (
            <button onClick={exportChat}
              className="rounded-lg px-1.5 py-1 text-xs text-gray-400 transition hover:text-gray-600 sm:px-2" title="导出对话">导出</button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={msgListRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-3 py-2 sm:space-y-4 sm:px-4 sm:py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center py-12 sm:py-16">
            {config.avatar ? (
              <img src={config.avatar} alt={config.botName} className="mb-3 h-14 w-14 rounded-full object-cover ring-2 ring-gray-100 sm:h-16 sm:w-16 dark:ring-gray-700" />
            ) : (
              <span className="mb-3 grid h-14 w-14 place-content-center rounded-full bg-gray-100 text-xl font-bold text-gray-400 sm:h-16 sm:w-16 sm:text-2xl dark:bg-gray-800">AI</span>
            )}
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{config.botName || 'AI 助手'}</p>
            <p className="mt-0.5 text-xs text-gray-400 sm:mt-1">有什么可以帮你？</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {m.role === 'assistant' && (
              config.avatar
                ? <img src={config.avatar} className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-700" alt="" />
                : <span className="grid h-6 w-6 shrink-0 place-content-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800">AI</span>
            )}
            <div className="group relative max-w-[82%] sm:max-w-[78%]">
              <div className={`rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap sm:px-4 sm:py-2.5 sm:text-sm ${m.role === 'user' ? 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}`}>{m.content}</div>
              {m.role === 'assistant' && (
                <button onClick={() => playTTS(m.content, i)}
                  className={`absolute -bottom-1 -right-1 rounded-full p-1.5 transition shadow-sm ${speakingIdx === i ? 'bg-blue-500 text-white' : 'bg-white text-gray-400 hover:text-gray-600 dark:bg-gray-700 dark:hover:text-gray-300'}`}>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z"/>
                    <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
        {messages.length > 0 && (
          <p className="text-center text-[11px] text-gray-300 dark:text-gray-600 pt-1">
            AI 生成内容仅供参考 · 联系：jasonchan0654@gmail.com
          </p>
        )}
      </div>

      {/* 输入框 */}
      <div className="shrink-0 border-t border-gray-100 p-2.5 dark:border-gray-700 sm:p-3">
        <div className="flex gap-2">
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={`向 ${config.botName || 'AI'} 发消息...`} disabled={loading}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-gray-400 disabled:opacity-50 sm:px-4 sm:py-2.5 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
          <button onClick={send} disabled={loading || !input.trim() || cooldown > 0}
            className="shrink-0 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50 sm:px-4 sm:py-2.5 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
            {cooldown > 0 ? `${cooldown}s` : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
