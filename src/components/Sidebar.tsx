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
      <div className="space-y-5">
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 头像 / 站点信息（原项目 layout.html 侧栏） */}
      <section className="card p-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="relative h-24 w-24 overflow-hidden rounded-full ring-2 ring-gray-200 transition hover:ring-gray-400">
            {settings.avatar ? (
              <img src={resolveAsset(settings.avatar)} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-content-center bg-gray-100 text-3xl font-bold text-gray-900">
                K
              </span>
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{settings.title || 'Kimo'}</h2>
            <p className="mt-1 text-sm text-gray-500">{settings.ltitle}</p>
          </div>
        </div>
      </section>

      {/* 分类 */}
      <section className="card p-6">
        <h3 className="mb-4 font-semibold text-gray-900">分类</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate('/')}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
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
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
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
        <section className="card p-6">
          <h3 className="mb-4 font-semibold text-gray-900">标签</h3>
          <div className="flex flex-wrap gap-2">
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

      {/* 页面（原项目：rounded-2xl border bg-white 列表项） */}
      {pages.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-3 ml-2 mt-2 font-semibold text-gray-900">Pages</h3>
          <div className="space-y-3">
            {pages.map((p) => {
              const inner = (
                <div className="ml-2 flex-1 min-w-0">
                  <h4 className="truncate text-base font-medium text-gray-800">{p.name}</h4>
                </div>
              )
              return p.type === 'link' ? (
                <a
                  key={p.id}
                  href={p.content || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="group mt-4 flex items-center rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-1 hover:border-gray-300 hover:shadow-sm active:scale-[0.98]"
                >
                  {inner}
                  <span className="mr-1 text-gray-300 transition group-hover:translate-x-0.5">→</span>
                </a>
              ) : (
                <Link
                  key={p.id}
                  to={`/page/${p.name}`}
                  className="group mt-4 flex items-center rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-1 hover:border-gray-300 hover:shadow-sm active:scale-[0.98]"
                >
                  {inner}
                  <span className="mr-1 text-gray-300 transition group-hover:translate-x-0.5">→</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
