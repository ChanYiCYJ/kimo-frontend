import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { useSite } from '../lib/site'
import { resolveAsset } from '../lib/api'
import { Spinner } from '../components/Spinner'

type Mode = 'login' | 'register'

export function Login() {
  const { user, isAdmin, loading, login, register } = useAuth()
  const { settings } = useSite()
  const { success, error } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  const [mode, setMode] = useState<Mode>('login')
  const [userInfo, setUserInfo] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 已登录用户直接跳转
  useEffect(() => {
    if (!loading && user) {
      navigate(isAdmin ? '/dashboard' : '/', { replace: true })
    }
  }, [user, isAdmin, loading, navigate])

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      if (mode === 'login') {
        if (!userInfo || !password) {
          error('请输入用户名/邮箱和密码')
          return
        }
        const u = await login(userInfo, password)
        success(`欢迎回来，${u.user_name || u.email}！`)
        navigate(u.role === 0 ? (from ?? '/dashboard') : '/', { replace: true })
      } else {
        if (!username || !email || !password) {
          error('请填写完整信息')
          return
        }
        if (username.length < 2) {
          error('用户名至少 2 个字符')
          return
        }
        if (password.length < 6) {
          error('密码至少 6 位')
          return
        }
        const u = await register(username, email, password)
        success('注册成功，已自动登录！')
        navigate(u.role === 0 ? '/dashboard' : '/', { replace: true })
      }
    } catch (err) {
      error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fade-up mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center px-4">
      <div className="w-full">
        {/* 站点 Logo */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="grid h-16 w-16 place-content-center overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-gray-100">
            {settings.avatar ? (
              <img src={resolveAsset(settings.avatar)} alt="logo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-gray-900">K</span>
            )}
          </span>
          <h1 className="text-xl font-semibold text-gray-800">{settings.title || 'Kimo'}</h1>
        </div>

        <div className="rounded-xl bg-white p-6 shadow">
          {/* Tabs（原项目 login.html） */}
          <div className="mb-6 flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                mode === 'register' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'login' ? (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">用户名 / 邮箱</label>
                  <input
                    type="text"
                    value={userInfo}
                    onChange={(e) => setUserInfo(e.target.value)}
                    placeholder="请输入用户名或邮箱"
                    className={inputCls}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className={inputCls}
                    autoComplete="current-password"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">用户名</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="至少 2 个字符"
                    className={inputCls}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">邮箱</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 6 位"
                    className={inputCls}
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.99] disabled:opacity-60"
            >
              {submitting && <Spinner size="sm" className="border-white/30 border-t-white" />}
              {mode === 'login' ? '登录' : '注册'}
            </button>
          </form>

          {mode === 'login' && (
            <p className="mt-4 text-center text-xs text-gray-400">
              还没有账号？{' '}
              <button onClick={() => setMode('register')} className="text-gray-900 hover:underline">
                立即注册
              </button>
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          <Link to="/" className="hover:text-gray-600">
            ← 返回首页
          </Link>
        </p>
      </div>
    </div>
  )
}
