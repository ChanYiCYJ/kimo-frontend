import { useState, useRef, useEffect } from 'react'
import { aiChat, getAIConfig } from '../lib/ai'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function AIChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cfg = getAIConfig()
    setConfigured(cfg.enabled && !!cfg.endpoint && !!cfg.apiKey && !!cfg.model)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    const userMsg: Message = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    try {
      const reply = await aiChat(text, '你是友好的AI助手，简洁回答，用中文。')
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `错误：${e instanceof Error ? e.message : '请求失败'}` }])
    } finally {
      setLoading(false)
    }
  }

  if (!configured) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">
        AI 对话未配置。请在后台「站点设置 → AI 润色」中配置接口。
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" style={{ minHeight: 420 }}>
      {/* 消息列表 */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-400">发送消息开始对话</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-100 px-4 py-2.5 text-sm text-gray-400 dark:bg-gray-800">
              AI 思考中...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t border-gray-100 p-3 dark:border-gray-700">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="输入消息..."
            disabled={loading}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none transition focus:border-gray-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
