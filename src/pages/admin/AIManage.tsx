import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pageApi } from '../../lib/api'
import { AI_CHAT_MARKER, decodeKey, type AIChatConfig } from '../../lib/types'
import { BotEditorModal } from '../../components/BotEditorModal'
import type { BotItem } from '../../components/AIChat'

function parseBot(p: { id: number; name: string; content: string | null; type: string }): BotItem | null {
  if (p.type !== 'html' || !p.content?.startsWith(AI_CHAT_MARKER)) return null
  try {
    const raw = JSON.parse(p.content.slice(AI_CHAT_MARKER.length)) as AIChatConfig
    const config: AIChatConfig = { ...raw, apiKey: decodeKey(raw.apiKey) }
    return { id: p.id, name: p.name, config, page: p as BotItem['page'] }
  } catch {
    return null
  }
}

export function AIManage() {
  const [bots, setBots] = useState<BotItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<BotItem | null>(null)

  const loadBots = useCallback(async () => {
    setLoading(true)
    try {
      const pages = await pageApi.list()
      setBots(pages.map(parseBot).filter((b): b is BotItem => !!b))
    } catch {
      setBots([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBots()
  }, [loadBots])

  const deleteBot = useCallback(async (id: number) => {
    if (!window.confirm('确定删除该 AI 助手？此操作会删除对应页面。')) return
    try {
      await pageApi.remove(id)
      loadBots()
    } catch { /* 忽略 */ }
  }, [loadBots])

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI 助手管理</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            统一管理所有 AI 助手（对应页面），创建后可随时切换；访问 <Link to="/ai" className="text-blue-600 hover:underline dark:text-blue-400">/ai</Link> 使用。
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setEditorOpen(true) }}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 sm:w-auto dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          新建 AI 助手
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-400">加载中...</p>
      ) : bots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">
          还没有 AI 助手，点击右上角「新建 AI 助手」创建。
        </div>
      ) : (
        <div className="space-y-2">
          {bots.map((b) => (
            <div key={b.id} className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 sm:flex-row sm:items-center dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center gap-3">
                {b.config.avatar
                  ? <img src={b.config.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                  : <span className="grid h-11 w-11 shrink-0 place-content-center rounded-full bg-gray-100 text-sm font-bold text-gray-500 dark:bg-gray-800">{b.name.slice(0, 2)}</span>}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{b.name}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{b.config.botName || b.config.model}</span>
                    {b.config.adminOnly && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500 dark:bg-red-900/20 dark:text-red-400">仅管理员</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">
                    {b.config.model} · {b.config.endpoint}
                    {b.config.autoTTS ? ' · 自动朗读' : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:shrink-0">
                <Link to={`/ai/${b.id}`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
                  打开
                </Link>
                <button onClick={() => { setEditing(b); setEditorOpen(true) }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
                  编辑
                </button>
                <button onClick={() => deleteBot(b.id)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50 dark:border-gray-700">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <BotEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} bot={editing} onSaved={() => { setEditorOpen(false); loadBots() }} />
    </div>
  )
}
