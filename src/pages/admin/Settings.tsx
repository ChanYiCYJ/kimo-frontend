import { useEffect, useRef, useState } from 'react'
import { resolveAsset, settingApi, uploadApi } from '../../lib/api'
import type { SiteSettings } from '../../lib/types'
import { PageSpinner } from '../../components/Spinner'
import { ConfirmDialog } from '../../components/Modal'
import { EmptyState } from '../../components/ui'
import { useToast } from '../../lib/toast'
import { useSite } from '../../lib/site'
import { getAIConfig, saveAIConfig, type AIConfig } from '../../lib/ai'

const KNOWN_KEYS: Array<{ key: string; label: string; placeholder: string; type?: 'text' | 'textarea' }> = [
  { key: 'title', label: '站点标题', placeholder: 'Kimo' },
  { key: 'ltitle', label: '副标题', placeholder: '简洁优雅的个人博客' },
  { key: 'avatar', label: '头像 URL', placeholder: '/favicon.svg' },
  { key: 'background', label: '背景图 URL', placeholder: 'https://api.1314.cool/bingimg' },
  { key: 'footer', label: '页脚文字', placeholder: '© Kimo', type: 'textarea' },
]

export function Settings() {
  const { settings, loaded, refresh } = useSite()
  const { success, error } = useToast()
  const [form, setForm] = useState<SiteSettings>({})
  const [saving, setSaving] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [ai, setAi] = useState<AIConfig>(getAIConfig())

  useEffect(() => {
    if (loaded) setForm(settings)
  }, [loaded, settings])

  if (!loaded) return <PageSpinner />

  const allKeys = new Set([...KNOWN_KEYS.map((k) => k.key), ...Object.keys(form)])

  const save = async () => {
    setSaving(true)
    try {
      for (const [k, v] of Object.entries(form)) {
        await settingApi.set(k, String(v ?? ''))
      }
      await refresh()
      success('设置已保存')
    } catch (e) {
      error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadApi.image(file)
      setForm((f) => ({ ...f, avatar: resolveAsset(res.url) }))
      success('头像已上传')
    } catch (err) {
      error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const addCustomKey = async () => {
    const key = newKey.trim()
    if (!key) {
      error('请输入键名')
      return
    }
    if (key in form) {
      error('该键已存在')
      return
    }
    setForm((f) => ({ ...f, [key]: newValue }))
    setNewKey('')
    setNewValue('')
    success(`已添加 ${key}`)
  }

  const confirmDelete = async () => {
    if (!deletingKey) return
    try {
      await settingApi.remove(deletingKey)
      setForm((f) => {
        const next = { ...f }
        delete next[deletingKey]
        return next
      })
      await refresh()
      success('已删除')
    } catch (e) {
      error(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeletingKey(null)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100'

  return (
    <div className="fade-up max-w-3xl space-y-6">
      {/* 基本设置 */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800">基本设置</h2>

        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-content-center overflow-hidden rounded-2xl bg-gray-100">
            {form.avatar ? (
              <img src={resolveAsset(form.avatar)} alt="头像" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-gray-900">K</span>
            )}
          </span>
          <div>
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={onUploadAvatar} className="hidden" id="avatar-upload" />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploading}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
            >
              {uploading ? '上传中...' : '上传头像'}
            </button>
            <p className="mt-1 text-xs text-gray-400">或直接在「头像 URL」输入图片地址</p>
          </div>
        </div>

        {KNOWN_KEYS.map((item) => (
          <div key={item.key}>
            <label className="mb-1.5 block text-sm font-medium text-gray-600">{item.label}</label>
            {item.type === 'textarea' ? (
              <textarea
                value={form[item.key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [item.key]: e.target.value }))}
                rows={2}
                placeholder={item.placeholder}
                className={`${inputCls} resize-none`}
              />
            ) : (
              <input
                value={form[item.key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [item.key]: e.target.value }))}
                placeholder={item.placeholder}
                className={inputCls}
              />
            )}
          </div>
        ))}

        {/* 开放注册开关 */}
        <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-700">开放注册</p>
            <p className="mt-0.5 text-xs text-gray-400">关闭后，新用户无法在登录页注册（后端也会拒绝注册请求）</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.allow_register !== '0'}
            onClick={() =>
              setForm((f) => ({ ...f, allow_register: f.allow_register === '0' ? '1' : '0' }))
            }
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              form.allow_register !== '0' ? 'bg-gray-900' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                form.allow_register !== '0' ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* 菜单显示开关 */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">菜单栏显示</p>
          <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
            <div>
              <p className="text-sm text-gray-700">后台入口</p>
              <p className="text-xs text-gray-400">在顶部菜单栏显示「管理后台」链接</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.show_dashboard !== '0'}
              onClick={() =>
                setForm((f) => ({ ...f, show_dashboard: f.show_dashboard === '0' ? '1' : '0' }))
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                form.show_dashboard !== '0' ? 'bg-gray-900' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  form.show_dashboard !== '0' ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
            <div>
              <p className="text-sm text-gray-700">自定义页面</p>
              <p className="text-xs text-gray-400">在顶部菜单栏显示自定义页面链接</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.show_pages !== '0'}
              onClick={() =>
                setForm((f) => ({ ...f, show_pages: f.show_pages === '0' ? '1' : '0' }))
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                form.show_pages !== '0' ? 'bg-gray-900' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  form.show_pages !== '0' ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            保存设置
          </button>
        </div>
      </section>

      {/* AI 润色设置（本地存储，不写入站点键值） */}
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">AI 润色</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={ai.enabled}
              onChange={(e) => setAi((a) => ({ ...a, enabled: e.target.checked }))}
              className="h-4 w-4 accent-gray-900"
            />
            启用
          </label>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          在文章编辑器的工具栏中使用「AI 润色」按钮。支持任意 OpenAI 兼容接口（DeepSeek、Moonshot、OpenAI 等）。
          配置仅保存在浏览器本地，不会上传到服务器。
        </p>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">接口地址（Base URL）</label>
          <input
            value={ai.endpoint}
            onChange={(e) => setAi((a) => ({ ...a, endpoint: e.target.value }))}
            placeholder="https://api.deepseek.com/v1"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">API Key</label>
          <input
            type="password"
            value={ai.apiKey}
            onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))}
            placeholder="sk-..."
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">模型</label>
          <input
            value={ai.model}
            onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}
            placeholder="deepseek-chat"
            className={inputCls}
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => {
              saveAIConfig(ai)
              success('AI 润色配置已保存')
            }}
            className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98]"
          >
            保存 AI 配置
          </button>
        </div>
      </section>

      {/* 全部键值 */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800">全部设置项</h2>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="键名，如 github"
            className={`${inputCls} sm:flex-1`}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="值"
            className={`${inputCls} sm:flex-1`}
          />
          <button
            onClick={addCustomKey}
            className="shrink-0 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            添加
          </button>
        </div>

        {allKeys.size === 0 ? (
          <EmptyState title="暂无设置项" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100">
            {[...allKeys].map((key, i) => (
              <div
                key={key}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-medium text-gray-700">{key}</p>
                  <p className="truncate text-sm text-gray-400">{form[key] || '(空)'}</p>
                </div>
                <button
                  onClick={() => setDeletingKey(key)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-500 transition hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!deletingKey}
        title="删除设置项"
        message={`确定要删除设置项「${deletingKey}」吗？`}
        onCancel={() => setDeletingKey(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
