import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="fade-up flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-7xl font-bold text-gray-200">404</p>
      <h1 className="mt-4 text-xl font-semibold text-gray-700">页面走丢了</h1>
      <p className="mt-2 text-sm text-gray-400">你访问的页面不存在或已被移除</p>
      <Link
        to="/"
        className="mt-6 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700"
      >
        返回首页
      </Link>
    </div>
  )
}
