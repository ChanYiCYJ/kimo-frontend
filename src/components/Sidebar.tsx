import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { articleApi, categoryApi, tagApi } from '../lib/api'
import type { Category, Tag } from '../lib/types'
import { Skeleton } from './ui'

export function Sidebar() {
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [articleTotal, setArticleTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    Promise.allSettled([articleApi.list(1), categoryApi.list(), tagApi.list()]).then((res) => {
      if (!active) return
      if (res[0].status === 'fulfilled') setArticleTotal(res[0].value.total)
      if (res[1].status === 'fulfilled') setCategories(res[1].value)
      if (res[2].status === 'fulfilled') setTags(res[2].value)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const activeCategory = Number(params.get('category')) || 0

  const onTagClick = (tagName: string) => {
    navigate(`/?keyword=${encodeURIComponent(tagName)}`)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-3xl" />
        <Skeleton className="h-32 w-full rounded-3xl" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 站点统计 */}
      <section className="card p-3.5">
        <h3 className="mb-3 border-l-2 border-gray-900 pl-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">统计</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Link to="/" className="rounded-lg bg-gray-50 py-2 transition hover:bg-gray-100">
            <p className="text-lg font-semibold text-gray-900">{articleTotal}</p>
            <p className="text-[11px] text-gray-400">文章</p>
          </Link>
          <div className="rounded-lg bg-gray-50 py-2">
            <p className="text-lg font-semibold text-gray-900">{categories.length}</p>
            <p className="text-[11px] text-gray-400">分类</p>
          </div>
          <div className="rounded-lg bg-gray-50 py-2">
            <p className="text-lg font-semibold text-gray-900">{tags.length}</p>
            <p className="text-[11px] text-gray-400">标签</p>
          </div>
        </div>
      </section>

      {/* 分类 */}
      <section className="card p-3.5">
        <h3 className="mb-3 border-l-2 border-gray-900 pl-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">分类</h3>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => navigate('/')}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              activeCategory === 0
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/?category=${c.id}`)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                activeCategory === c.id
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      {/* 标签 */}
      {tags.length > 0 && (
        <section className="card p-3.5">
          <h3 className="mb-3 border-l-2 border-gray-900 pl-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">标签</h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t.id}
                onClick={() => onTagClick(t.tag_name)}
                className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-200"
              >
                #{t.tag_name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
