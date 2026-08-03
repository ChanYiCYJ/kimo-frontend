import { Link } from 'react-router-dom'
import type { ArticleListItem } from '../lib/types'
import { resolveAsset } from '../lib/api'
import { formatDate } from '../lib/format'

export function PostCard({ post }: { post: ArticleListItem }) {
  return (
    <article
      className="card card-hover group flex flex-col gap-4 overflow-hidden p-4 md:flex-row md:gap-6"
    >
      {/* 封面（原项目：md:w-60 / rounded-2xl） */}
      {post.cover_image && (
        <div className="aspect-[16/9] w-full shrink-0 overflow-hidden rounded-2xl bg-gray-100 transition-transform duration-300 md:aspect-auto md:h-44 md:w-60">
          <img
            src={resolveAsset(post.cover_image)}
            alt={post.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      {/* 内容区（原项目：p-2 sm:p-3 gap-3） */}
      <div className="flex h-full flex-1 flex-col gap-3 p-1 sm:p-2">
        {/* 分类徽标 + 日期 */}
        <div className="flex flex-wrap items-center gap-2">
          {post.category_name && (
            <span className="pill-primary w-fit">{post.category_name}</span>
          )}
          <span className="text-xs text-gray-400">{formatDate(post.created)}</span>
        </div>

        {/* 标题 */}
        <h2 className="text-xl font-semibold leading-snug text-gray-900 line-clamp-2">
          <Link to={`/article/${post.id}`}>{post.title}</Link>
        </h2>

        {/* 描述 */}
        {post.description && (
          <p className="text-sm leading-relaxed text-gray-600 line-clamp-3">{post.description}</p>
        )}

        {/* 标签 */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.tags.slice(0, 3).map((t) => (
              <span key={t.id} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                #{t.tag_name}
              </span>
            ))}
          </div>
        )}

        {/* 阅读全文（原项目：rounded-full border px-4 py-2） */}
        <Link
          to={`/article/${post.id}`}
          className="mt-auto inline-flex w-fit items-center gap-1 rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900"
        >
          阅读全文
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </Link>
      </div>
    </article>
  )
}
