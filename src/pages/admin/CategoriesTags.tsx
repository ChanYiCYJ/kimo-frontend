import { useEffect, useState } from 'react'
import { categoryApi, tagApi } from '../../lib/api'
import type { Category, Tag } from '../../lib/types'
import { Skeleton } from '../../components/ui'
import { ConfirmDialog } from '../../components/Modal'
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
  // 编辑分类
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatDesc, setEditCatDesc] = useState('')
  const [editCatSlug, setEditCatSlug] = useState('')
  const [editCatBusy, setEditCatBusy] = useState(false)
  // 删除分类
  const [deletingCat, setDeletingCat] = useState<Category | null>(null)
  const [deleteCatBusy, setDeleteCatBusy] = useState(false)

  // 标签表单
  const [tagName, setTagName] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  // 编辑标签
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagBusy, setEditTagBusy] = useState(false)
  // 删除标签
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null)
  const [deleteTagBusy, setDeleteTagBusy] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([categoryApi.list(), tagApi.list()])
      .then(([c, t]) => {
        setCategories(c)
        setTags(t)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // ===== 分类操作 =====
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

  const startEditCat = (c: Category) => {
    setEditingCat(c)
    setEditCatName(c.name)
    setEditCatDesc(c.description ?? '')
    setEditCatSlug(c.slug)
  }

  const saveEditCat = async () => {
    if (!editingCat || !editCatName.trim()) {
      error('请输入分类名称')
      return
    }
    setEditCatBusy(true)
    try {
      const updated = await categoryApi.update(editingCat.id, {
        name: editCatName.trim(),
        description: editCatDesc.trim() || null,
        slug: editCatSlug.trim() || null,
      })
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      setEditingCat(null)
      success(`分类已更新`)
    } catch (e) {
      error(e instanceof Error ? e.message : '更新失败')
    } finally {
      setEditCatBusy(false)
    }
  }

  const confirmDeleteCat = async () => {
    if (!deletingCat) return
    setDeleteCatBusy(true)
    try {
      await categoryApi.remove(deletingCat.id)
      setCategories((prev) => prev.filter((c) => c.id !== deletingCat.id))
      setDeletingCat(null)
      success(`分类「${deletingCat.name}」已删除`)
    } catch (e) {
      error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleteCatBusy(false)
    }
  }

  // ===== 标签操作 =====
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

  const startEditTag = (t: Tag) => {
    setEditingTag(t)
    setEditTagName(t.tag_name)
  }

  const saveEditTag = async () => {
    if (!editingTag || !editTagName.trim()) {
      error('请输入标签名称')
      return
    }
    setEditTagBusy(true)
    try {
      const updated = await tagApi.update(editingTag.id, editTagName.trim())
      setTags((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      setEditingTag(null)
      success(`标签已更新`)
    } catch (e) {
      error(e instanceof Error ? e.message : '更新失败')
    } finally {
      setEditTagBusy(false)
    }
  }

  const confirmDeleteTag = async () => {
    if (!deletingTag) return
    setDeleteTagBusy(true)
    try {
      await tagApi.remove(deletingTag.id)
      setTags((prev) => prev.filter((t) => t.id !== deletingTag.id))
      setDeletingTag(null)
      success(`标签「${deletingTag.tag_name}」已删除`)
    } catch (e) {
      error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleteTagBusy(false)
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
      {/* ===== 分类管理 ===== */}
      <section className="card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-800">分类管理</h2>
        <p className="mt-1 text-sm text-gray-500">分类用于归档文章；slug 留空时后端会自动生成。</p>

        {/* 新增表单 */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createCategory()}
            placeholder="分类名称，如：技术"
            className={inputCls}
          />
          <input
            value={catDesc}
            onChange={(e) => setCatDesc(e.target.value)}
            placeholder="描述（可选）"
            className={`${inputCls} sm:max-w-[200px]`}
          />
          <input
            value={catSlug}
            onChange={(e) => setCatSlug(e.target.value)}
            placeholder="slug（可选）"
            className={`${inputCls} sm:max-w-[140px]`}
          />
          <button onClick={createCategory} disabled={catBusy} className={btnCls}>
            {catBusy ? '创建中...' : '新增'}
          </button>
        </div>

        {/* 列表 */}
        {categories.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">还没有分类，创建一个吧</p>
        ) : (
          <div className="mt-5 space-y-3">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                {editingCat?.id === c.id ? (
                  // 编辑模式
                  <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditCat()}
                      placeholder="名称"
                      className={`${inputCls} sm:max-w-[160px]`}
                      autoFocus
                    />
                    <input
                      value={editCatSlug}
                      onChange={(e) => setEditCatSlug(e.target.value)}
                      placeholder="slug"
                      className={`${inputCls} sm:max-w-[120px]`}
                    />
                    <input
                      value={editCatDesc}
                      onChange={(e) => setEditCatDesc(e.target.value)}
                      placeholder="描述"
                      className={`${inputCls} flex-1`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveEditCat}
                        disabled={editCatBusy}
                        className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-700 disabled:opacity-60"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingCat(null)}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 transition hover:bg-gray-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  // 展示模式
                  <>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-sm font-semibold text-gray-600">
                        #
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-800">{c.name}</p>
                        <p className="truncate text-xs text-gray-400">
                          /{c.slug}
                          {c.description ? ` · ${c.description}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => startEditCat(c)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50 sm:px-3"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setDeletingCat(c)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 sm:px-3"
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== 标签管理 ===== */}
      <section className="card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-gray-800">标签管理</h2>
        <p className="mt-1 text-sm text-gray-500">标签在发布文章时自动创建，也可以在这里手动新增、编辑或删除。</p>

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
            {tagBusy ? '创建中...' : '新增'}
          </button>
        </div>

        {/* 列表 */}
        {tags.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">还没有标签</p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            {tags.map((t) => (
              <span key={t.id} className="group inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600">
                {editingTag?.id === t.id ? (
                  <span className="flex items-center gap-1">
                    <input
                      value={editTagName}
                      onChange={(e) => setEditTagName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditTag()}
                      className="w-24 rounded-lg border border-gray-300 px-2 py-0.5 text-xs outline-none focus:border-gray-400"
                      autoFocus
                    />
                    <button
                      onClick={saveEditTag}
                      disabled={editTagBusy}
                      className="text-xs font-medium text-gray-900 hover:underline"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditingTag(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <>
                    <span
                      className="cursor-pointer"
                      onClick={() => startEditTag(t)}
                      title="点击编辑"
                    >
                      #{t.tag_name}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeletingTag(t) }}
                      className="ml-0.5 text-gray-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      title="删除"
                    >
                      ×
                    </button>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ===== 确认对话框 ===== */}
      <ConfirmDialog
        open={!!deletingCat}
        title="删除分类"
        message={`确定要删除分类「${deletingCat?.name}」吗？已有该分类的文章将变为"未分类"。`}
        confirmText={deleteCatBusy ? '删除中...' : '删除'}
        onCancel={() => setDeletingCat(null)}
        onConfirm={confirmDeleteCat}
      />
      <ConfirmDialog
        open={!!deletingTag}
        title="删除标签"
        message={`确定要删除标签「${deletingTag?.tag_name}」吗？该标签将从所有文章中移除。`}
        confirmText={deleteTagBusy ? '删除中...' : '删除'}
        onCancel={() => setDeletingTag(null)}
        onConfirm={confirmDeleteTag}
      />
    </div>
  )
}
