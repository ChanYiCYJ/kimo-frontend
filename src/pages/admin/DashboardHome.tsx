import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { articleApi, categoryApi, pageApi, tagApi } from '../../lib/api'
import { Skeleton } from '../../components/ui'

export function DashboardHome() {
  const [stats, setStats] = useState<Record<string, number>>({
    articles: 0,
    categories: 0,
    tags: 0,
    pages: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.allSettled([
      articleApi.list(1),
      categoryApi.list(),
      tagApi.list(),
      pageApi.list(),
    ]).then((res) => {
      if (!active) return
      setStats({
        articles: res[0].status === 'fulfilled' ? res[0].value.total : 0,
        categories: res[1].status === 'fulfilled' ? res[1].value.length : 0,
        tags: res[2].status === 'fulfilled' ? res[2].value.length : 0,
        pages: res[3].status === 'fulfilled' ? res[3].value.length : 0,
      })
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const links = [
    { to: '/dashboard/articles/new', title: '创建文章', desc: '写一篇新的文章' },
    { to: '/dashboard/articles', title: '管理文章', desc: '编辑、删除已有文章' },
    { to: '/dashboard/pages/new', title: '创建页面', desc: '关于、友链等自定义页面' },
    { to: '/dashboard/settings', title: '站点设置', desc: '标题、副标题、头像等' },
  ]

  return (
    <div className="space-y-8">
      {/* 统计 */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="card p-5">
            <p className="text-3xl font-semibold text-gray-900">{stats.articles}</p>
            <p className="mt-1 text-sm text-gray-500">文章</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-semibold text-gray-900">{stats.categories}</p>
            <p className="mt-1 text-sm text-gray-500">分类</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-semibold text-gray-900">{stats.tags}</p>
            <p className="mt-1 text-sm text-gray-500">标签</p>
          </div>
          <div className="card p-5">
            <p className="text-3xl font-semibold text-gray-900">{stats.pages}</p>
            <p className="mt-1 text-sm text-gray-500">页面</p>
          </div>
        </div>
      )}

      {/* 快捷入口 */}
      <div>
        <h2 className="mb-3 text-base font-medium text-gray-700">快捷入口</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="group flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-1 hover:border-gray-300 hover:shadow-sm"
            >
              <div>
                <h3 className="text-base font-medium text-gray-800">{l.title}</h3>
                <p className="mt-0.5 text-sm text-gray-500">{l.desc}</p>
              </div>
              <span className="text-gray-300 transition group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
