import { useState, useRef, useEffect, useCallback } from 'react'
import type { AIChatConfig } from '../lib/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STORAGE_PREFIX = 'kimo_chat_'

async function streamChat(cfg: AIChatConfig, msgs: Message[], onChunk: (t: string) => void, signal: AbortSignal) {
  const res = await fetch(cfg.endpoint.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: cfg.systemPrompt }, ...msgs.map(m => ({ role: m.role, content: m.content }))],
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
  const [cooldown, setCooldown] = useState(0)
  const [speakingIdx, setSpeakingIdx] = useState(-1)
  const [consented, setConsented] = useState(() => {
    try { return localStorage.getItem(STORAGE_PREFIX + 'consent_' + pageId) === '1' } catch { return false }
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>(null)

  useEffect(() => {
    try { const r = localStorage.getItem(STORAGE_PREFIX + 'history_' + pageId); if (r) setMessages(JSON.parse(r)) } catch {}
  }, [pageId])

  const save = useCallback((msgs: Message[]) => {
    try { localStorage.setItem(STORAGE_PREFIX + 'history_' + pageId, JSON.stringify(msgs)) } catch {}
  }, [pageId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (cooldown <= 0) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }; return }
    timerRef.current = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [cooldown])

  const playTTS = useCallback((text: string, idx: number) => {
    if (speakingIdx === idx) { window.speechSynthesis.cancel(); setSpeakingIdx(-1); return }
    setSpeakingIdx(idx)
    const clean = text.replace(/[*_`#~>\[\]\(\)]/g, '').slice(0, 600)
    speak(clean)
    const check = setInterval(() => { if (!window.speechSynthesis.speaking) { setSpeakingIdx(-1); clearInterval(check) } }, 300)
  }, [speakingIdx])

  const send = async () => {
    const t = input.trim(); if (!t || loading || cooldown > 0) return
    const user: Message = { role: 'user' as const, content: t }
    const next: Message[] = [...messages, user]; setMessages(next); setInput(''); setLoading(true); save(next)
    setCooldown(20)
    const ctrl = new AbortController(); abortRef.current = ctrl; let reply = ''
    try {
      reply = await streamChat(config, next, full => setMessages([...next, { role: 'assistant' as const, content: full }]), ctrl.signal)
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      reply = `错误：${e instanceof Error ? e.message : '请求失败'}`
    } finally { if (abortRef.current === ctrl) abortRef.current = null; setLoading(false) }
    const fin: Message[] = [...next, { role: 'assistant' as const, content: reply }]; setMessages(fin); save(fin)
  }

  if (!consented) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">知情同意声明</h3>
        <div className="mt-4 space-y-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          <p>在开始对话前，请了解：</p>
          <ul className="ml-4 list-disc space-y-1">
            <li>对话记录保存在您的浏览器本地，不会上传服务器。</li>
            <li>AI 回复由配置的第三方 API 生成，请自行评估内容准确性。</li>
            <li>请勿输入密码、身份证号等敏感个人信息。</li>
            <li>您可随时清除对话记录。</li>
          </ul>
        </div>
        <button onClick={() => { setConsented(true); try { localStorage.setItem(STORAGE_PREFIX + 'consent_' + pageId, '1') } catch {} }}
          className="mt-6 w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
          我已了解，开始对话
        </button>
      </div>
    )
  }

  if (!config.endpoint || !config.apiKey || !config.model) {
    return <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">AI 对话未配置。请在后台编辑此页面。</div>
  }

  return (
    <div className="flex flex-col bg-white dark:bg-gray-900 max-sm:fixed max-sm:inset-0 max-sm:z-30 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-gray-200 sm:dark:border-gray-700" style={{ height: 'auto', minHeight: 'min(480px, 100dvh)' }}>
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2.5 dark:border-gray-700 sm:px-4 sm:py-3">
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
            <p className="text-[11px] text-gray-400">{config.model || 'AI'}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1">
          <button onClick={() => { setMessages([]); try { localStorage.removeItem(STORAGE_PREFIX + 'history_' + pageId) } catch {} }}
            className="rounded-lg px-1.5 py-1 text-xs text-gray-400 transition hover:text-red-500 sm:px-2">清除</button>
          <button onClick={() => abortRef.current?.abort()} disabled={!loading}
            className="rounded-lg px-1.5 py-1 text-xs text-gray-400 transition hover:text-gray-600 disabled:opacity-30 sm:px-2">停止</button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2 sm:space-y-4 sm:px-4 sm:py-3">
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
                  className={`absolute -bottom-1 -right-1 rounded-full p-1 transition sm:opacity-0 sm:group-hover:opacity-100 ${speakingIdx === i ? 'bg-blue-500 text-white opacity-100' : 'bg-white text-gray-400 shadow-sm hover:text-gray-600 dark:bg-gray-700'}`}>
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
      </div>

      {/* 输入框 */}
      <div className="shrink-0 border-t border-gray-100 p-2.5 dark:border-gray-700 sm:p-3">
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
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
