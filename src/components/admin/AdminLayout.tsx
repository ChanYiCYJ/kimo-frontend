import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from '../../lib/auth'
import { useSite } from '../../lib/site'
import { PageSpinner } from '../Spinner'
import { resolveAsset } from '../../lib/api'

interface NavItem {
  to: string
  end?: boolean
  label: string
  icon: React.ReactNode
}

const ICON = {
  home: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
    </svg>
  ),
  article: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  manage: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  pages: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  ),
  settings: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  tag: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  ),
}

const NAV: NavItem[] = [
  { to: '/dashboard', end: true, label: '概览', icon: ICON.home },
  { to: '/dashboard/articles/new', label: '新建文章', icon: ICON.article },
  { to: '/dashboard/articles', label: '文章管理', icon: ICON.manage },
  { to: '/dashboard/pages', label: '页面管理', icon: ICON.pages },
  { to: '/dashboard/categories', label: '分类标签', icon: ICON.tag },
  { to: '/dashboard/settings', label: '站点设置', icon: ICON.settings },
]

const TITLES: Array<[string, string]> = [
  ['/dashboard/articles/new', '新建文章'],
  ['/dashboard/articles/', '文章管理'],
  ['/dashboard/pages/new', '新建页面'],
  ['/dashboard/pages', '页面管理'],
  ['/dashboard/categories', '分类 / 标签'],
  ['/dashboard/settings', '站点设置'],
  ['/dashboard', '控制台'],
]

export function AdminLayout() {
  const { user, loading, isAdmin, logout } = useAuth()
  const { settings } = useSite()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate('/login', { replace: true, state: { from: location.pathname } })
    }
  }, [loading, isAdmin, navigate, location.pathname])

  if (loading) return <PageSpinner />
  if (!isAdmin) return null

  const title = TITLES.find(([prefix]) => location.pathname.startsWith(prefix))?.[1] ?? '控制台'

  const handleLogout = () => {
    logout()
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 左侧图标导航 */}
      <div className="flex h-screen w-20 flex-col justify-between border-r border-gray-100 bg-white">
        <div>
          <a href="/" className="inline-flex h-20 w-20 items-center justify-center">
            <span className="grid h-12 w-12 place-content-center overflow-hidden rounded-xl bg-gray-100">
              {settings.avatar ? (
                <img src={resolveAsset(settings.avatar)} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg font-bold text-gray-900">K</span>
              )}
            </span>
          </a>

          <ul className="space-y-1 border-t border-gray-100 pt-4">
            {NAV.map((item) => (
              <li key={item.to} className="relative group flex justify-center">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex h-11 w-11 items-center justify-center rounded-xl transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                    }`
                  }
                >
                  {item.icon}
                </NavLink>
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 底部 */}
        <div className="border-t border-gray-100 py-3">
          <div className="flex flex-col items-center gap-2">
            <a
              href="/"
              title="返回前台"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </a>
            <button
              onClick={handleLogout}
              title="退出登录"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 transition hover:bg-red-50 hover:text-red-600"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 顶栏 */}
        <header className="flex h-16 items-center justify-between border-b border-gray-100 bg-white px-6">
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <p className="font-medium text-gray-700">{user?.user_name || user?.email}</p>
              <p className="text-gray-400">{user?.role === 0 ? '管理员' : '用户'}</p>
            </div>
            <span className="grid h-9 w-9 place-content-center rounded-full bg-gray-100 text-sm font-bold text-gray-700">
              {(user?.user_name || user?.email || 'U').slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>

        {/* 内容 */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
