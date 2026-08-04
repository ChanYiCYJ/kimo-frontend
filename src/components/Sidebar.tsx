import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { categoryApi, pageApi, tagApi, resolveAsset } from '../lib/api'
import type { Category, Page, Tag } from '../lib/types'
import { useSite } from '../lib/site'
import { Skeleton } from './ui'

export function Sidebar() {
  const { settings } = useSite()
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    Promise.allSettled([categoryApi.list(), tagApi.list(), pageApi.list()]).then((res) => {
      if (!active) return
      if (res[0].status === 'fulfilled') setCategories(res[0].value)
      if (res[1].status === 'fulfilled') setTags(res[1].value)
      if (res[2].status === 'fulfilled') setPages(res[2].value)
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
    <div className="space-y-4">
      {/* 站点信息（横向紧凑布局，适配窄列） */}
      <section className="card flex items-center gap-3 p-4">
        <span className="grid h-14 w-14 shrink-0 place-content-center overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
          {settings.avatar ? (
            <img src={resolveAsset(settings.avatar)} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl font-bold text-gray-900">K</span>
          )}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-gray-900">{settings.title || 'Kimo'}</h2>
          {settings.ltitle && <p className="mt-0.5 truncate text-xs text-gray-500">{settings.ltitle}</p>}
        </div>
      </section>

      {/* 分类 */}
      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">分类</h3>
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
        <section className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">标签</h3>
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

      {/* 页面 */}
      {pages.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Pages</h3>
          <div className="space-y-2">
            {pages.map((p) => {
              const inner = (
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{p.name}</span>
              )
              return p.type === 'link' ? (
                <a
                  key={p.id}
                  href={p.content || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  {inner}
                  <span className="shrink-0 text-gray-300 transition group-hover:translate-x-0.5">→</span>
                </a>
              ) : (
                <Link
                  key={p.id}
                  to={`/page/${p.name}`}
                  className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  {inner}
                  <span className="shrink-0 text-gray-300 transition group-hover:translate-x-0.5">→</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
