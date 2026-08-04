import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { pageApi } from '../../lib/api'
import type { PageDisplayType, PageType, AIChatConfig } from '../../lib/types'
import { AI_CHAT_MARKER } from '../../lib/types'
import { MdEditor } from '../../components/MdEditor'
import { PageSpinner } from '../../components/Spinner'
import { useToast } from '../../lib/toast'

const TYPE_OPTIONS: Array<{ value: PageDisplayType; label: string; desc: string }> = [
  { value: 'markdown', label: 'Markdown', desc: '富文本页面，适合「关于」「归档」' },
  { value: 'html', label: 'HTML', desc: '自定义 HTML / JS 内容' },
  { value: 'list', label: 'List', desc: '链接列表，如「友链」' },
  { value: 'ai-chat', label: 'AI 对话', desc: '内嵌 AI 聊天组件，无需内容' },
  { value: 'link', label: 'Link', desc: '跳转到外部链接' },
]

export function PageEditor() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const { success, error } = useToast()

  const [name, setName] = useState('')
  const [type, setType] = useState<PageDisplayType>('markdown')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [hidden, setHidden] = useState(false)

  // AI 对话配置
  const [aiEndpoint, setAiEndpoint] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiBotName, setAiBotName] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')

  useEffect(() => {
    if (isEdit) {
      pageApi
        .get(Number(id))
        .then((p) => {
          setName(p.name)
          setHidden(p.status !== 0)
          if (p.type === 'html' && p.content?.startsWith(AI_CHAT_MARKER)) {
            setType('ai-chat')
            setContent('')
            try {
              const cfg: AIChatConfig = JSON.parse(p.content.slice(AI_CHAT_MARKER.length))
              setAiEndpoint(cfg.endpoint || '')
              setAiKey(cfg.apiKey || '')
              setAiModel(cfg.model || '')
              setAiBotName(cfg.botName || '')
              setAiPrompt(cfg.systemPrompt || '')
            } catch {}
          } else {
            setType(p.type as PageDisplayType)
            setContent(p.content ?? '')
          }
        })
        .catch((e: Error) => error(e.message || '加载失败'))
        .finally(() => setLoading(false))
    }
  }, [isEdit, id, error])

  if (loading) return <PageSpinner />

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100'

  const renderContentEditor = () => {
    switch (type) {
      case 'markdown':
        return <MdEditor value={content} onChange={setContent} height={420} />
      case 'html':
        return (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="<p>HTML 内容...</p>"
            className={`${inputCls} font-mono`}
          />
        )
      case 'list':
        return (
          <div className="space-y-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder='JSON 数组，例如：[{"title":"GitHub","description":"https://github.com"}]'
              className={`${inputCls} font-mono`}
            />
            <p className="text-xs text-gray-400">
              使用 JSON 数组格式，每项包含 <code className="rounded bg-gray-100 px-1">title</code> 与{' '}
              <code className="rounded bg-gray-100 px-1">description</code>（若 description 为链接会自动渲染「前往」按钮）
            </p>
          </div>
        )
      case 'link':
        return (
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="https://example.com"
            className={inputCls}
          />
        )
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      error('请输入页面名称')
      return
    }
    if (type !== 'list' && type !== 'ai-chat' && !content.trim()) {
      error('请输入页面内容')
      return
    }
    if (type === 'list') {
      try {
        JSON.parse(content || '[]')
      } catch {
        error('List 内容必须是合法的 JSON')
        return
      }
    }
    setSaving(true)
    // ai-chat 编码：用 html 类型 + JSON 配置存储，兼容后端 type 校验
    const saveType: PageType = type === 'ai-chat' ? 'html' : type
    const saveContent = type === 'ai-chat'
      ? AI_CHAT_MARKER + JSON.stringify({
          endpoint: aiEndpoint.trim(),
          apiKey: aiKey.trim(),
          model: aiModel.trim(),
          botName: aiBotName.trim(),
          systemPrompt: aiPrompt.trim(),
        } as AIChatConfig)
      : (content || null)
    const payload = { name: name.trim(), type: saveType, content: saveContent, status: hidden ? 1 : 0 }
    try {
      if (isEdit) {
        await pageApi.update(Number(id), payload)
        success('页面已更新')
      } else {
        await pageApi.create(payload)
        success('页面已创建')
      }
      navigate('/dashboard/pages')
    } catch (e) {
      error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/dashboard/pages')}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
        >
          ← 返回
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60"
        >
          {saving && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isEdit ? '保存修改' : '创建页面'}
        </button>
      </div>

      {/* 名称 + 隐藏开关 */}
      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="页面名称，如：about / 关于"
          className="flex-1 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 text-xl font-semibold text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
        />
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50">
          <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} className="h-4 w-4 accent-gray-900" />
          隐藏
        </label>
      </div>

      {/* 类型选择 */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-600">页面类型</label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setType(opt.value)}
              className={`rounded-2xl border p-3.5 text-left transition ${
                type === opt.value
                  ? 'border-gray-400 bg-gray-100 ring-2 ring-gray-100'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <p className={`text-sm font-semibold ${type === opt.value ? 'text-gray-900' : 'text-gray-700'}`}>
                {opt.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 内容 / AI配置 */}
      {type === 'ai-chat' ? (
        <div className="card space-y-4 p-5">
          <h3 className="text-sm font-semibold text-gray-800">AI 对话配置</h3>
          <p className="text-xs text-gray-400">密钥仅存储在页面数据中，不会被前端明文暴露给第三方。</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">机器人名称</label>
              <input value={aiBotName} onChange={e => setAiBotName(e.target.value)} placeholder="如：小K" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">模型</label>
              <input value={aiModel} onChange={e => setAiModel(e.target.value)} placeholder="如：gpt-4o-mini" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">API 接口地址</label>
            <input value={aiEndpoint} onChange={e => setAiEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">API 密钥</label>
            <input value={aiKey} onChange={e => setAiKey(e.target.value)} placeholder="sk-..." type="password" className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">系统提示词 <span className="text-gray-400">（定义机器人角色和行为）</span></label>
            <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3} placeholder="你是一个友好的助手..." className={`${inputCls} resize-none`} />
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">内容</label>
          {renderContentEditor()}
        </div>
      )}
    </div>
  )
}
