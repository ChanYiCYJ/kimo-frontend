import { useEffect, useState } from 'react'
import { categoryApi, tagApi } from '../../lib/api'
import type { Category, Tag } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { useToast } from '../../lib/toast'

export function CategoriesTags() {
  const [categories, setCategories] = useState<Category[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const { success, error } = useToast()

  // 分类表单
  const [catName, setCatName] = useState('')
  const [catDesc, setCatDesc] = useState('')
  const [catSlug, setCatSlug] = useState('')
  const [catBusy, setCatBusy] = useState(false)
  // 标签表单
  const [tagName, setTagName] = useState('')
  const [tagBusy, setTagBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([categoryApi.list(), tagApi.list()])
      .then(([c, t]) => {
        if (!active) return
        setCategories(c)
        setTags(t)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const createCategory = async () => {
    if (!catName.trim()) {
      error('请输入分类名称')
      return
    }
    setCatBusy(true)
    try {
      const c = await categoryApi.create({
        name: catName.trim(),
        description: catDesc.trim() || null,
        slug: catSlug.trim() || null,
      })
      setCategories((prev) => [...prev, c])
      setCatName('')
      setCatDesc('')
      setCatSlug('')
      success(`分类「${c.name}」已创建`)
    } catch (e) {
      error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCatBusy(false)
    }
  }

  const createTag = async () => {
    const name = tagName.trim()
    if (!name) {
      error('请输入标签名称')
      return
    }
    setTagBusy(true)
    try {
      const t = await tagApi.create(name)
      setTags((prev) => [...prev, t])
      setTagName('')
      success(`标签「${t.tag_name}」已创建`)
    } catch (e) {
      error(e instanceof Error ? e.message : '创建失败')
    } finally {
      setTagBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
  const btnCls =
    'shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60'

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="fade-up space-y-6">
      {/* 分类 */}
      <section className="card p-6">
        <h2 className="text-base font-semibold text-gray-800">分类管理</h2>
        <p className="mt-1 text-sm text-gray-500">分类用于归档文章；slug 留空时后端会自动按拼音生成。</p>

        {/* 新增表单 */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="分类名称，如：技术"
            className={inputCls}
          />
          <input
            value={catDesc}
            onChange={(e) => setCatDesc(e.target.value)}
            placeholder="描述（可选）"
            className={`${inputCls} sm:flex-1`}
          />
          <input
            value={catSlug}
            onChange={(e) => setCatSlug(e.target.value)}
            placeholder="slug（可选）"
            className={`${inputCls} sm:w-40`}
          />
          <button onClick={createCategory} disabled={catBusy} className={btnCls}>
            {catBusy ? '创建中...' : '新增分类'}
          </button>
        </div>

        {/* 列表 */}
        {categories.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">还没有分类</p>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-sm font-semibold text-gray-600">
                  #
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-800">{c.name}</p>
                  <p className="truncate text-xs text-gray-400">
                    /{c.slug}
                    {c.description ? ` · ${c.description}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 标签 */}
      <section className="card p-6">
        <h2 className="text-base font-semibold text-gray-800">标签管理</h2>
        <p className="mt-1 text-sm text-gray-500">标签在发布文章时自动创建，也可以在这里手动新增。</p>

        {/* 新增表单 */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createTag()}
            placeholder="标签名称，如：React"
            className={inputCls}
          />
          <button onClick={createTag} disabled={tagBusy} className={btnCls}>
            {tagBusy ? '创建中...' : '新增标签'}
          </button>
        </div>

        {/* 列表 */}
        {tags.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">还没有标签</p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            {tags.map((t) => (
              <span key={t.id} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600">
                #{t.tag_name}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
