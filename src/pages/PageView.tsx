import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { pageApi } from '../lib/api'
import type { Page, AIChatConfig } from '../lib/types'
import { AI_CHAT_MARKER } from '../lib/types'
import { PageSpinner } from '../components/Spinner'
import { EmptyState } from '../components/ui'
import { AIChat } from '../components/AIChat'

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
    // ai-chat 兼容解码：html 类型 + JSON 配置
    if (page.type === 'html' && page.content?.startsWith(AI_CHAT_MARKER)) {
      try {
        const cfg: AIChatConfig = JSON.parse(page.content.slice(AI_CHAT_MARKER.length))
        return <AIChat config={cfg} pageId={page.id} />
      } catch { /* fall through */ }
    }
    switch (page.type) {
      case 'markdown': {
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
      {/* 头部：标题 + 分隔 — 与文章页统一 */}
      <div className="mx-auto max-w-3xl px-4 sm:px-0">
        <h1 className="mb-4 mt-6 text-center text-3xl font-semibold leading-snug tracking-tight text-gray-900 sm:text-4xl">
          {page.name}
        </h1>
        <div className="mt-6 border-t border-gray-200" />
      </div>

      {/* 正文 */}
      <div className="mx-auto mt-8 max-w-3xl px-4 sm:px-0">
        <div className="flex justify-center">
          <div className="w-full max-w-3xl">{renderContent()}</div>
        </div>
      </div>
    </div>
  )
}
