import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { useSite } from '../lib/site'
import { resolveAsset } from '../lib/api'

export function Layout() {
  const { settings } = useSite()
  const location = useLocation()

  // 路由切换时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="flex min-h-screen flex-col">
      {/* 背景（原项目：Bing 图 + 白色模糊遮罩） */}
      <div
        className="bg-fixed-cover"
        style={
          settings.background
            ? { backgroundImage: `url(${resolveAsset(settings.background)})` }
            : undefined
        }
      />
      <div className="bg-blur-overlay" />

      <Header />

      <main className="mx-auto my-10 w-full max-w-6xl flex-1 px-4 sm:px-6">
        {location.pathname === '/' || location.pathname.startsWith('/page/') ? (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="col-span-1 space-y-6 md:col-span-2">
              <Outlet />
            </div>
            <aside className="col-span-1">
              <div className="sticky top-24 space-y-4">
                <Sidebar />
              </div>
            </aside>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-gray-200/70 bg-white/60 py-10 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
            <div className="text-center sm:text-left">
              <p className="text-sm font-semibold text-gray-800">{settings.title || 'Kimo'}</p>
              <p className="mt-1 text-sm text-gray-400">
                {settings.footer ? settings.footer : '© ' + (settings.title || 'Kimo') + ' · Powered by FastAPI + React'}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>保持热爱</span>
              <span className="h-3 w-px bg-gray-300" />
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="flex items-center gap-1 transition hover:text-gray-600"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clipRule="evenodd" />
                </svg>
                回到顶部
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
