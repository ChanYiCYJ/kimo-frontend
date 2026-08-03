import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useSite } from '../lib/site'
import { useAuth } from '../lib/auth'
import { resolveAsset } from '../lib/api'

export function Header() {
  const { settings } = useSite()
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const kw = keyword.trim()
    navigate(kw ? `/?keyword=${encodeURIComponent(kw)}` : '/')
    setMobileOpen(false)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* 左侧：站点标题 + 副标题（原项目 header.html 样式） */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-9 w-9 shrink-0 place-content-center overflow-hidden rounded-xl bg-gray-100 sm:grid">
            {settings.avatar ? (
              <img src={resolveAsset(settings.avatar)} alt="logo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-base font-bold text-gray-900">K</span>
            )}
          </span>
          <Link to="/" className="flex min-w-0 flex-col">
            <span className="truncate text-xl font-medium leading-tight text-gray-900">
              {settings.title || 'Kimo'}
            </span>
            {settings.ltitle && (
              <span className="hidden truncate text-sm text-gray-400 sm:block">{settings.ltitle}</span>
            )}
          </Link>
        </div>

        {/* 右侧：搜索 + 导航（原项目：bg-white border rounded-3xl 搜索框） */}
        <nav className="hidden items-center gap-4 text-sm text-gray-500 md:flex">
          <form onSubmit={submitSearch}>
            <div className="flex items-center overflow-hidden rounded-3xl border border-gray-300 bg-white transition focus-within:border-gray-400">
              <svg className="ml-3 h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索文章..."
                className="w-32 bg-transparent px-2.5 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 lg:w-40"
              />
              <button
                type="submit"
                className="bg-gray-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-gray-700"
              >
                搜索
              </button>
            </div>
          </form>

          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `transition ${isActive ? 'font-medium text-gray-900' : 'hover:text-gray-900'}`
            }
          >
            首页
          </NavLink>

          {isAdmin ? (
            <Link
              to="/dashboard"
              className="flex items-center gap-1 rounded-full border border-gray-200 px-4 py-1.5 font-medium text-gray-700 transition hover:bg-gray-100 hover:text-gray-900"
            >
              管理后台
            </Link>
          ) : (
            <NavLink
              to="/login"
              className={({ isActive }) =>
                `transition ${isActive ? 'font-medium text-gray-900' : 'hover:text-gray-900'}`
              }
            >
              {user ? (user.user_name || user.email) : '登录'}
            </NavLink>
          )}
        </nav>

        {/* 移动端菜单按钮 */}
        <button
          className="rounded-xl p-2 text-gray-600 hover:bg-gray-100 md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="菜单"
        >
          {mobileOpen ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* 移动端面板 */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-4 py-4 md:hidden">
          <form onSubmit={submitSearch} className="mb-3">
            <div className="flex items-center overflow-hidden rounded-3xl border border-gray-300 bg-white">
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索文章..."
                className="flex-1 bg-transparent px-4 py-2 text-sm outline-none placeholder:text-gray-400"
              />
              <button
                type="submit"
                className="bg-gray-900 px-4 py-2 text-xs font-medium text-white"
              >
                搜索
              </button>
            </div>
          </form>
          <nav className="flex flex-col gap-1 text-sm">
            <NavLink to="/" end onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100">
              首页
            </NavLink>
            {isAdmin ? (
              <Link to="/dashboard" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-gray-900 hover:bg-gray-100">
                管理后台
              </Link>
            ) : (
              <NavLink to="/login" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100">
                登录 / 注册
              </NavLink>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
