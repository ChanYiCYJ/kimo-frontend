import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { articleApi, categoryApi, resolveAsset, uploadApi } from '../../lib/api'
import type { ArticleDetail, Category } from '../../lib/types'
import { MdEditor } from '../../components/MdEditor'
import { PageSpinner } from '../../components/Spinner'
import { useToast } from '../../lib/toast'

export function ArticleEditor() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const { success, error } = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [tagsInput, setTagsInput] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // 加载分类 & 编辑时加载文章
  useEffect(() => {
    categoryApi.list().then(setCategories).catch(() => {})
    if (isEdit) {
      articleApi
        .get(Number(id))
        .then((a: ArticleDetail) => {
          setTitle(a.title)
          setDescription(a.description ?? '')
          setContent(a.content)
          setCoverImage(a.cover_image ?? '')
          setCategoryId(a.category_id ?? '')
          setTagsInput(a.tags.map((t) => t.tag_name).join(', '))
        })
        .catch((e: Error) => error(e.message || '加载失败'))
        .finally(() => setLoading(false))
    }
  }, [isEdit, id, error])

  const onUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadApi.image(file)
      setCoverImage(resolveAsset(res.url))
      success('封面已上传')
    } catch (err) {
      error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      error('请输入文章标题')
      return
    }
    if (!content.trim()) {
      error('请输入文章内容')
      return
    }
    setSaving(true)
    const payload = {
      title: title.trim(),
      content,
      description: description.trim() || null,
      cover_image: coverImage || null,
      category_id: categoryId === '' ? null : Number(categoryId),
      tags: tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    }
    try {
      if (isEdit) {
        await articleApi.update(Number(id), payload)
        success('文章已更新')
      } else {
        await articleApi.create(payload)
        success('文章已发布')
      }
      navigate('/dashboard/articles')
    } catch (e) {
      error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner />

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100'

  return (
    <div className="fade-up space-y-5">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/dashboard/articles')}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
        >
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard/articles')}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isEdit ? '保存修改' : '发布'}
          </button>
        </div>
      </div>

      {/* 标题 */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="输入文章标题..."
        className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-2xl font-semibold text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
      />

      {/* 元信息 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">分类</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">无分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-gray-600">标签（用逗号分隔）</label>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="React, TypeScript, 随笔"
            className={inputCls}
          />
        </div>
      </div>

      {/* 摘要 & 封面 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">摘要</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="文章摘要，将显示在列表中..."
            className={`${inputCls} resize-none`}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">封面图</label>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            onChange={onUploadCover}
            className="hidden"
            id="cover-upload"
          />
          <div
            className={`flex h-[calc(100%-1.75rem)] min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition ${
              coverImage ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
            onClick={() => coverInputRef.current?.click()}
          >
            {uploading ? (
              <p className="text-sm text-gray-400">上传中...</p>
            ) : coverImage ? (
              <div className="relative w-full flex-1 overflow-hidden rounded-lg">
                <img src={coverImage} alt="封面" className="h-full w-full object-cover" />
                <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
                  点击更换
                </span>
              </div>
            ) : (
              <>
                <svg className="h-6 w-6 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" />
                </svg>
                <p className="text-sm text-gray-400">点击上传封面图片</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 正文编辑器 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-600">正文（Markdown）</label>
        <MdEditor value={content} onChange={setContent} height={560} />
      </div>
    </div>
  )
}
