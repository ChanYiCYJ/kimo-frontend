import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { articleApi, categoryApi } from '../lib/api'
import type { ArticleListItem, Category } from '../lib/types'
import { PostCard } from '../components/PostCard'
import { Pagination } from '../components/Pagination'
import { EmptyState, Skeleton } from '../components/ui'
import { useSite } from '../lib/site'

export function Home() {
  const { settings } = useSite()
  const [params] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const categoryId = Number(params.get('category')) || undefined
  const keyword = params.get('keyword')?.trim() || undefined

  const [articles, setArticles] = useState<ArticleListItem[]>([])
  const [totalPage, setTotalPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<Category[]>([])

  const categoryName = useMemo(
    () => categories.find((c) => c.id === categoryId)?.name,
    [categories, categoryId],
  )

  useEffect(() => {
    categoryApi.list().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    articleApi
      .list(page, categoryId, keyword)
      .then((res) => {
        if (!active) return
        setArticles(res.items)
        setTotalPage(res.total_page)
        setTotal(res.total)
      })
      .catch(() => {
        if (active) {
          setArticles([])
          setTotalPage(1)
          setTotal(0)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, categoryId, keyword])

  const title = keyword ? `“${keyword}” 的搜索结果` : categoryName ? `${categoryName} · 文章` : '最近文章'

  return (
    <div className="fade-up space-y-6">
      {/* Shiro 式欢迎区：仅首页第一屏且无筛选时展示 */}
      {page === 1 && !keyword && !categoryId && (
        <header className="mx-auto mb-8 max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
            {settings.title || 'Kimo'}
          </h2>
          {settings.ltitle && (
            <p className="mt-3 text-base leading-relaxed text-gray-500">{settings.ltitle}</p>
          )}
          <div className="mt-6 flex items-center justify-center gap-3 text-gray-300">
            <span className="h-px w-10 bg-gray-300" />
            <span className="h-1 w-1 rounded-full bg-gray-300" />
            <span className="h-px w-10 bg-gray-300" />
          </div>
        </header>
      )}

      {/* 列表头（原项目 index.html：text-xl font-medium + 更多文章 →） */}
      <div className="mb-2 ml-1 flex items-end justify-between">
        <div>
          {page === 1 && !keyword && !categoryId && (
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.22em] text-gray-400">Posts</p>
          )}
          <h2 className="text-xl font-medium tracking-tight text-gray-800">{title}</h2>
        </div>
        {!keyword && total > 5 && (
          <Link to={`/?page=${page + 1}`} className="text-xl font-medium text-gray-800 transition hover:text-gray-600">
            更多文章 →
          </Link>
        )}
        {keyword && (
          <button
            onClick={() => (window.location.href = '/')}
            className="text-sm text-gray-400 transition hover:text-gray-600"
          >
            清除搜索
          </button>
        )}
      </div>

      {/* 文章列表 */}
      {loading ? (
        <div className="space-y-5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-3xl" />
          ))}
        </div>
      ) : articles.length > 0 ? (
        <div className="space-y-5">
          {articles.map((a) => (
            <PostCard key={a.id} post={a} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={keyword ? '没有找到相关文章' : '暂无内容'}
          description={keyword ? '换个关键词试试吧' : '快去后台发布第一篇文章吧'}
          icon={
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          }
        />
      )}

      <Pagination page={page} totalPage={totalPage} extra={{ category: categoryId, keyword }} />
    </div>
  )
}
