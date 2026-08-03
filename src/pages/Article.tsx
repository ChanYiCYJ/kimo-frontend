import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { articleApi, resolveAsset } from '../lib/api'
import type { ArticleDetail } from '../lib/types'
import { Markdown } from '../components/Markdown'
import { PageSpinner } from '../components/Spinner'
import { formatDate, readingTime } from '../lib/format'
import { EmptyState } from '../components/ui'

export function Article() {
  const { id } = useParams<{ id: string }>()
  const [article, setArticle] = useState<ArticleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    articleApi
      .get(Number(id))
      .then((a) => {
        if (active) setArticle(a)
      })
      .catch((e: Error) => {
        if (active) setError(e.message || '文章不存在')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  if (loading) return <PageSpinner />

  if (error || !article) {
    return (
      <EmptyState
        title="文章不存在"
        description={error || '这篇文章可能已被删除'}
        icon={
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        }
        action={
          <Link to="/" className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700">
            返回首页
          </Link>
        }
      />
    )
  }

  return (
    <div className="fade-up">
      <article className="card mx-auto max-w-3xl p-4 sm:p-6">
        {/* 返回 */}
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-400 transition hover:text-gray-600"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.332 10l3.458 3.71a.75.75 0 11-1.08 1.04l-4-4.25a.75.75 0 010-1.08l4-4.25a.75.75 0 011.08 0z" clipRule="evenodd" />
          </svg>
          返回列表
        </Link>

        {/* 封面（原项目：h-64 md:h-96 rounded-2xl） */}
        {article.cover_image && (
          <div className="h-64 w-full overflow-hidden rounded-2xl bg-gray-100 md:h-96">
            <img
              src={resolveAsset(article.cover_image)}
              alt={article.title}
              className="h-full w-full object-cover transition-transform duration-300"
            />
          </div>
        )}

        {/* 标题（原项目：text-center text-4xl） */}
        <h1 className="mb-4 mt-4 text-center text-4xl leading-tight text-gray-900">
          {article.title}
        </h1>

        {/* 元信息（原项目：rounded-full border px-4 py-1） */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {article.category_name && (
            <span className="inline-block rounded-full border px-4 py-1 text-sm text-gray-700">
              {article.category_name}
            </span>
          )}
          <span className="inline-block rounded-full border px-4 py-1 text-sm text-gray-700">
            {formatDate(article.created)}
          </span>
          <span className="inline-block rounded-full border px-4 py-1 text-sm text-gray-700">
            约 {readingTime(article.content)} 分钟
          </span>
        </div>

        {/* 标签 */}
        {article.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {article.tags.map((t) => (
              <span key={t.id} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                #{t.tag_name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 border-t border-gray-200" />

        {/* 正文（原项目：flex justify-center + max-w-3xl，18px 由 .markdown-body 提供） */}
        <div className="mt-6 flex justify-center">
          <div className="w-full max-w-3xl">
            <Markdown content={article.content} />
          </div>
        </div>
      </article>
    </div>
  )
}
