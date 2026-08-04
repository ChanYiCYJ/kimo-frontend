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
            <aside className="col-span-1 space-y-6">
              <Sidebar />
            </aside>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-gray-200/70 bg-white/60 py-8 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-400 sm:px-6">
          {settings.footer ? (
            <p>{settings.footer}</p>
          ) : (
            <p>© {settings.title || 'Kimo'} · Powered by FastAPI + React</p>
          )}
        </div>
      </footer>
    </div>
  )
}
