import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { pageApi } from '../lib/api'
import { AI_CHAT_MARKER, decodeKey, type AIChatConfig } from '../lib/types'
import { useAuth } from '../lib/auth'
import { AIChat, type BotItem } from '../components/AIChat'
import { BotEditorModal } from '../components/BotEditorModal'

/** 解析 AI 页面 → BotItem */
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

export function AICenter() {
  const { botId } = useParams<{ botId: string }>()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [bots, setBots] = useState<BotItem[]>([])
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<BotItem | null>(null)

  const loadBots = useCallback(async () => {
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

  const active = bots.find((b) => b.id === Number(botId)) || bots[0]

  const switchBot = useCallback((id: number) => navigate(`/ai/${id}`), [navigate])

  const openNew = useCallback(() => {
    setManageOpen(false); setEditing(null); setEditorOpen(true)
  }, [])
  const openEdit = useCallback((b: BotItem) => {
    setManageOpen(false); setEditing(b); setEditorOpen(true)
  }, [])

  const deleteBot = useCallback(async (id: number) => {
    if (!window.confirm('确定删除该 AI 助手？此操作会删除对应页面。')) return
    try {
      await pageApi.remove(id)
      if (active?.id === id) navigate('/ai')
      loadBots()
    } catch { /* 忽略 */ }
  }, [active, navigate, loadBots])

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-white dark:bg-gray-900">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          加载中...
        </div>
      </div>
    )
  }

  return (
    <>
      {active ? (
        <AIChat
          key={active.id}
          center
          config={active.config}
          pageId={active.id}
          bots={bots}
          onSwitchBot={switchBot}
          canManage={isAdmin}
          onManage={() => setManageOpen(true)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-white p-8 text-center dark:bg-gray-900">
          <span className="grid h-16 w-16 place-content-center rounded-full bg-gray-100 text-2xl font-bold text-gray-400 dark:bg-gray-800">AI</span>
          <p className="text-base font-medium text-gray-700 dark:text-gray-300">还没有配置 AI 助手</p>
          <p className="max-w-sm text-sm text-gray-400">管理员可以在顶部「管理」中创建 AI 助手；普通访客请等待管理员配置。</p>
          {isAdmin && (
            <button onClick={openNew} className="mt-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
              创建 AI 助手
            </button>
          )}
        </div>
      )}

      {/* 管理弹窗 */}
      <ManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        bots={bots}
        onNew={openNew}
        onEdit={openEdit}
        onDelete={deleteBot}
      />
      <BotEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} bot={editing} onSaved={() => { setEditorOpen(false); loadBots() }} />
    </>
  )
}

function ManageModal({
  open, onClose, bots, onNew, onEdit, onDelete,
}: {
  open: boolean
  onClose: () => void
  bots: BotItem[]
  onNew: () => void
  onEdit: (b: BotItem) => void
  onDelete: (id: number) => void
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">管理 AI 助手</h3>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800" aria-label="关闭">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {bots.length === 0 && <p className="py-8 text-center text-sm text-gray-400">暂无 AI 助手</p>}
          {bots.map((b) => (
            <div key={b.id} className="group flex items-center gap-3 rounded-xl border border-gray-100 p-3 dark:border-gray-800">
              {b.config.avatar
                ? <img src={b.config.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                : <span className="grid h-9 w-9 shrink-0 place-content-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-800">{b.name.slice(0, 2)}</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{b.name}</p>
                <p className="truncate text-xs text-gray-400">{b.config.botName || b.config.model} · /ai/{b.id}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => onEdit(b)} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800" title="编辑" aria-label="编辑">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
                </button>
                <button onClick={() => onDelete(b.id)} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-800" title="删除" aria-label="删除">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 border-t border-gray-100 p-3 dark:border-gray-700">
          <button onClick={onNew} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            新建 AI 助手
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
