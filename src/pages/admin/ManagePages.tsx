import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pageApi } from '../../lib/api'
import type { Page } from '../../lib/types'
import { Badge, EmptyState, Skeleton } from '../../components/ui'
import { ConfirmDialog } from '../../components/Modal'
import { useToast } from '../../lib/toast'

const TYPE_TONE: Record<string, 'violet' | 'blue' | 'green' | 'amber' | 'gray'> = {
  markdown: 'gray',
  html: 'gray',
  list: 'gray',
  link: 'gray',
}

export function ManagePages() {
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<Page | null>(null)
  const [busy, setBusy] = useState(false)
  const { success, error } = useToast()

  const load = () => {
    setLoading(true)
    pageApi
      .list()
      .then(setPages)
      .catch(() => setPages([]))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await pageApi.remove(deleting.id)
      success('页面已删除')
      setDeleting(null)
      load()
    } catch (e) {
      error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-up space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {pages.length} 个自定义页面</p>
        <Link
          to="/dashboard/pages/new"
          className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98]"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          新建页面
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          title="还没有页面"
          description="创建 Markdown / List / Link 类型的自定义页面"
          action={
            <Link
              to="/dashboard/pages/new"
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
            >
              新建页面
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {pages.map((p) => (
            <div key={p.id} className="card card-hover flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-sm font-semibold text-gray-600">
                  #
                </span>
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-gray-800">{p.name}</h3>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge tone={TYPE_TONE[p.type] ?? 'gray'}>{p.type}</Badge>
                    {p.type !== 'link' && (
                      <Link to={`/page/${p.name}`} target="_blank" className="text-xs text-gray-400 hover:text-gray-900">
                        预览 →
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/dashboard/pages/${p.id}/edit`}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                >
                  编辑
                </Link>
                <button
                  onClick={() => setDeleting(p)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除页面"
        message={`确定要删除页面「${deleting?.name}」吗？`}
        confirmText={busy ? '删除中...' : '删除'}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
