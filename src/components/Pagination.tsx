import { useNavigate } from 'react-router-dom'

interface PaginationProps {
  page: number
  totalPage: number
  /** 额外拼接到 query 的参数 */
  extra?: Record<string, string | number | undefined>
}

export function Pagination({ page, totalPage, extra = {} }: PaginationProps) {
  const navigate = useNavigate()

  if (totalPage <= 1) return null

  const go = (p: number) => {
    const sp = new URLSearchParams()
    sp.set('page', String(p))
    Object.entries(extra).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== 0) sp.set(k, String(v))
    })
    navigate(`/?${sp.toString()}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 生成页码（最多显示 5 个）
  const pages: number[] = []
  const start = Math.max(1, Math.min(page - 2, totalPage - 4))
  const end = Math.min(totalPage, start + 4)
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <nav className="card mt-12 flex justify-center p-6">
      <ul className="flex items-center gap-2 text-sm select-none">
        {/* 上一页 */}
        {page > 1 && (
          <li>
            <button
              onClick={() => go(page - 1)}
              className="rounded-xl border px-3 py-1.5 text-gray-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-gray-100 active:translate-y-0"
            >
              ←
            </button>
          </li>
        )}

        {/* 页码 */}
        {pages.map((p) => (
          <li key={p}>
            <button
              onClick={() => go(p)}
              className={`min-w-[2.25rem] rounded-xl border px-3 py-1.5 text-center transition-all duration-200 ${
                p === page
                  ? 'pointer-events-none scale-110 bg-gray-900 text-white shadow-sm'
                  : 'text-gray-600 hover:-translate-y-0.5 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          </li>
        ))}

        {/* 下一页 */}
        {page < totalPage && (
          <li>
            <button
              onClick={() => go(page + 1)}
              className="rounded-xl border px-3 py-1.5 text-gray-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-gray-100 active:translate-y-0"
            >
              →
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}
