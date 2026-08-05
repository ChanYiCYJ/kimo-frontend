import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { articleApi, categoryApi, pageApi, tagApi, userApi } from '../../lib/api'
import type { ArticleListItem } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { useToast } from '../../lib/toast'
import { useSite } from '../../lib/site'
import { generateSiteReport, getAIConfig } from '../../lib/ai'

export function DashboardHome() {
  const { settings } = useSite()
  const { success, error } = useToast()
  const [stats, setStats] = useState<Record<string, number>>({
    articles: 0,
    categories: 0,
    tags: 0,
    pages: 0,
    users: 0,
  })
  const [recent, setRecent] = useState<ArticleListItem[]>([])
  const [loading, setLoading] = useState(true)
  // AI 站点统计
  const [report, setReport] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    Promise.allSettled([
      articleApi.list(1),
      categoryApi.list(),
      tagApi.list(),
      pageApi.list(),
      userApi.list(),
    ]).then((res) => {
      if (!active) return
      const art = res[0].status === 'fulfilled' ? res[0].value : null
      if (art) {
        setStats((s) => ({ ...s, articles: art.total }))
        setRecent(art.items)
      }
      const cat = res[1].status === 'fulfilled' ? res[1].value.length : 0
      const tag = res[2].status === 'fulfilled' ? res[2].value.length : 0
      const page = res[3].status === 'fulfilled' ? res[3].value.length : 0
      const usr = res[4].status === 'fulfilled' ? res[4].value.length : 0
      setStats((s) => ({ ...s, categories: cat, tags: tag, pages: page, users: usr }))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const runAiReport = async () => {
    if (!getAIConfig().enabled) {
      error('请先在「站点设置 → AI 润色」中配置 AI 接口')
      return
    }
    setAiLoading(true)
    setReport('')
    try {
      // 分类分布：按最近一页文章统计
      const dist = new Map<string, number>()
      recent.forEach((a) => {
        const k = a.category_name || '未分类'
        dist.set(k, (dist.get(k) ?? 0) + 1)
      })
      const text = await generateSiteReport({
        siteName: settings.title || 'Kimo',
        articles: stats.articles,
        categories: stats.categories,
        tags: stats.tags,
        pages: stats.pages,
        users: stats.users,
        recentTitles: recent.map((a) => a.title),
        categoryDistribution: [...dist.entries()].map(([name, count]) => ({ name, count })),
      })
      setReport(text)
    } catch (e) {
      error(e instanceof Error ? e.message : 'AI 报告生成失败')
    } finally {
      setAiLoading(false)
    }
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      success('报告已复制')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      error('复制失败')
    }
  }

  const links = [
    { to: '/dashboard/articles/new', title: '创建文章', desc: '写一篇新的文章' },
    { to: '/dashboard/articles', title: '管理文章', desc: '编辑、删除已有文章' },
    { to: '/dashboard/pages/new', title: '创建页面', desc: '关于、友链等自定义页面' },
    { to: '/dashboard/users', title: '用户管理', desc: '管理注册用户与权限' },
    { to: '/dashboard/settings', title: '站点设置', desc: '标题、副标题、AI 润色等' },
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
          <Link to="/dashboard/articles" className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm">
            <p className="text-3xl font-semibold text-gray-900">{stats.articles}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">文章 <span className="text-gray-300">→</span></p>
          </Link>
          <Link to="/dashboard/categories" className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm">
            <p className="text-3xl font-semibold text-gray-900">{stats.categories}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">分类 <span className="text-gray-300">→</span></p>
          </Link>
          <Link to="/dashboard/categories" className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm">
            <p className="text-3xl font-semibold text-gray-900">{stats.tags}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">标签 <span className="text-gray-300">→</span></p>
          </Link>
          <Link to="/dashboard/pages" className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm">
            <p className="text-3xl font-semibold text-gray-900">{stats.pages}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">页面 <span className="text-gray-300">→</span></p>
          </Link>
          <Link to="/dashboard/users" className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm">
            <p className="text-3xl font-semibold text-gray-900">{stats.users}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">用户 <span className="text-gray-300">→</span></p>
          </Link>
        </div>
      )}

      {/* AI 站点统计 */}
      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
              <svg className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
              AI 站点统计
            </h2>
            <p className="mt-1 text-sm text-gray-500">基于当前站点数据，用 AI 生成运营分析报告</p>
          </div>
          <button
            onClick={runAiReport}
            disabled={aiLoading}
            className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60"
          >
            {aiLoading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            )}
            {aiLoading ? '分析中…' : '生成 AI 报告'}
          </button>
        </div>

        {report ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-2">
              <span className="text-xs font-medium text-gray-500">AI 分析结果</span>
              <button
                onClick={copyReport}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
              >
                {copied ? '已复制 ✓' : '复制'}
              </button>
            </div>
            <div className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-gray-700">
              {report}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-5 py-8 text-center text-sm text-gray-400">
            {aiLoading
              ? '正在分析站点数据…'
              : '点击「生成 AI 报告」，AI 会根据文章/分类/标签等数据给出运营建议。首次使用请先在「站点设置 → AI 润色」配置接口。'}
          </div>
        )}
      </section>

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
