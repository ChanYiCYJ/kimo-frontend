import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { articleApi, resolveAsset } from '../../lib/api'
import type { ArticleListItem } from '../../lib/types'
import { Badge, EmptyState, Skeleton } from '../../components/ui'
import { ConfirmDialog } from '../../components/Modal'
import { useToast } from '../../lib/toast'
import { formatDate } from '../../lib/format'

export function ManageArticles() {
  const [articles, setArticles] = useState<ArticleListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<ArticleListItem | null>(null)
  const [busy, setBusy] = useState(false)
  const { success, error } = useToast()

  const load = () => {
    setLoading(true)
    articleApi
      .list(1)
      .then((res) => setArticles(res.items))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await articleApi.remove(deleting.id)
      success('文章已删除')
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
        <p className="text-sm text-gray-500">共 {articles.length} 篇文章（每页 5 篇）</p>
        <Link
          to="/dashboard/articles/new"
          className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98]"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          新建文章
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <EmptyState
          title="还没有文章"
          description="点击右上角「新建文章」发布第一篇吧"
          action={
            <Link
              to="/dashboard/articles/new"
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
            >
              新建文章
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {articles.map((a) => (
            <article
              key={a.id}
              className="card card-hover group flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
            >
              {/* 封面缩略图 */}
              {a.cover_image ? (
                <div className="h-16 w-full overflow-hidden rounded-xl bg-gray-100 sm:h-14 sm:w-20 sm:shrink-0">
                  <img src={resolveAsset(a.cover_image)} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="hidden h-14 w-20 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-300 sm:flex">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" />
                  </svg>
                </div>
              )}

              {/* 信息 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-medium text-gray-800">{a.title}</h3>
                  {a.category_name && <Badge tone="violet">{a.category_name}</Badge>}
                </div>
                <p className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                  <span>{formatDate(a.created)}</span>
                  {a.tags.length > 0 && (
                    <span className="truncate">
                      {a.tags.map((t) => `#${t.tag_name}`).join(' ')}
                    </span>
                  )}
                </p>
              </div>

              {/* 操作 */}
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/article/${a.id}`}
                  target="_blank"
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100"
                >
                  查看
                </Link>
                <Link
                  to={`/dashboard/articles/${a.id}/edit`}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
                >
                  编辑
                </Link>
                <button
                  onClick={() => setDeleting(a)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除文章"
        message={`确定要删除《${deleting?.title}》吗？此操作不可恢复。`}
        confirmText={busy ? '删除中...' : '删除'}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
