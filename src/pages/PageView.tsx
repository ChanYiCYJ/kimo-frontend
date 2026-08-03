import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { pageApi } from '../lib/api'
import type { Page } from '../lib/types'
import { PageSpinner } from '../components/Spinner'
import { EmptyState } from '../components/ui'

interface ListItem {
  title?: string
  description?: string
  [key: string]: unknown
}

export function PageView() {
  const { name } = useParams<{ name: string }>()
  const [page, setPage] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    pageApi
      .getByName(name ?? '')
      .then((p) => {
        if (!active) return
        // link 类型直接跳转
        if (p.type === 'link' && p.content) {
          window.open(p.content, '_blank', 'noopener')
          setPage(null)
        } else {
          setPage(p)
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message || '页面不存在')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [name])

  if (loading) return <PageSpinner />

  if (error || !page) {
    return (
      <EmptyState
        title="页面不存在"
        description={error || '这个页面可能已被删除'}
        action={
          <Link to="/" className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700">
            返回首页
          </Link>
        }
      />
    )
  }

  const renderContent = () => {
    switch (page.type) {
      case 'markdown': {
        // 后端已将 markdown 渲染为 HTML 字符串
        const html = page.content ?? ''
        return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
      }
      case 'html': {
        return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.content ?? '') }} />
      }
      case 'list': {
        let items: unknown[] = []
        try {
          const parsed = JSON.parse(page.content ?? '[]')
          items = Array.isArray(parsed) ? parsed : []
        } catch {
          items = []
        }
        return (
          <div className="space-y-3">
            {items.length === 0 && <p className="text-sm text-gray-400">暂无内容</p>}
            {items.map((raw, i) => {
              const item = (typeof raw === 'string' ? { title: raw } : raw) as ListItem
              const href = item.description && /^https?:\/\//.test(String(item.description)) ? String(item.description) : null
              const inner = (
                <>
                  <h3 className="text-base font-medium text-gray-800">{item.title || '未命名'}</h3>
                  {item.description && <p className="text-sm text-gray-500">{String(item.description)}</p>}
                </>
              )
              return (
                <div key={i} className="card card-hover flex items-center justify-between p-4">
                  <div className="min-w-0">{inner}</div>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-3 shrink-0 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                    >
                      前往 →
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )
      }
      default:
        return <div className="markdown-body">{page.content}</div>
    }
  }

  return (
    <div className="fade-up">
      <article className="card mx-auto max-w-3xl p-4 sm:p-6">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-400 transition hover:text-gray-600">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 010 1.06L9.332 10l3.458 3.71a.75.75 0 11-1.08 1.04l-4-4.25a.75.75 0 010-1.08l4-4.25a.75.75 0 011.08 0z" clipRule="evenodd" />
          </svg>
          返回首页
        </Link>
        <h1 className="mb-4 mt-4 text-center text-4xl text-gray-900">{page.name}</h1>
        <div className="mt-5 border-t border-gray-200" />
        <div className="mt-6 flex justify-center">
          <div className="w-full max-w-3xl">{renderContent()}</div>
        </div>
      </article>
    </div>
  )
}
