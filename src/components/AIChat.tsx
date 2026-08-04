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

export function AIChat({ config, pageId }: { config: AIChatConfig; pageId: number }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
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

  // 发送冷却定时器
  useEffect(() => {
    if (cooldown <= 0) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }; return }
    timerRef.current = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [cooldown])

  const send = async () => {
    const t = input.trim(); if (!t || loading || cooldown > 0) return
    const user: Message = { role: 'user' as const, content: t }
    const next: Message[] = [...messages, user]; setMessages(next); setInput(''); setLoading(true); save(next)
    setCooldown(10)
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
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" style={{ minHeight: 'min(400px, 70dvh)' }}>
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5 dark:border-gray-700 sm:px-4 sm:py-3">
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
      <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:space-y-4 sm:p-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center py-8 sm:py-12">
            {config.avatar ? (
              <img src={config.avatar} alt={config.botName} className="mb-3 h-12 w-12 rounded-full object-cover ring-2 ring-gray-100 sm:h-16 sm:w-16 dark:ring-gray-700" />
            ) : (
              <span className="mb-3 grid h-12 w-12 place-content-center rounded-full bg-gray-100 text-xl font-bold text-gray-400 sm:h-16 sm:w-16 sm:text-2xl dark:bg-gray-800">AI</span>
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
            <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap sm:max-w-[78%] sm:px-4 sm:py-2.5 sm:text-sm ${m.role === 'user' ? 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'}`}>{m.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {/* 输入框 */}
      <div className="border-t border-gray-100 p-2.5 dark:border-gray-700 sm:p-3">
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} placeholder={`向 ${config.botName || 'AI'} 发消息...`} disabled={loading}
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
