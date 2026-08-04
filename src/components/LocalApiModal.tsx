import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getLocalCfg, saveLocalCfg, clearLocalCfg, type LocalAIConfig } from '../lib/localCfg'

interface LocalApiModalProps {
  open: boolean
  onClose: () => void
  pageId: number
  botName: string
  onSaved: () => void
}

const inputCls =
  'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800'

export function LocalApiModal({ open, onClose, pageId, botName, onSaved }: LocalApiModalProps) {
  const [cfg, setCfg] = useState<LocalAIConfig>({ endpoint: '', apiKey: '', model: '' })
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (!open) return
    setCfg(getLocalCfg(pageId))
    setShowKey(false)
  }, [open, pageId])

  const save = () => {
    saveLocalCfg(pageId, { endpoint: cfg.endpoint.trim(), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() })
    onSaved()
    onClose()
  }

  const clear = () => {
    clearLocalCfg(pageId)
    setCfg({ endpoint: '', apiKey: '', model: '' })
    onSaved()
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">模型 API 设置 · {botName}</h3>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800" aria-label="关闭">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            🔒 <span className="font-medium">密钥声明：</span>你填写的 API Key <b>仅保存在本机浏览器</b>（localStorage），不会上传到服务器，仅用于在你自己的浏览器里调用对应模型接口。请勿在公共电脑上保存敏感密钥。
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">接口地址（留空使用默认）</label>
            <input value={cfg.endpoint} onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })} placeholder="https://api.openai.com/v1" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">API Key（留空使用默认）</label>
            <div className="relative">
              <input value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} type={showKey ? 'text' : 'password'} placeholder="sk-..." className={inputCls} />
              <button onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition hover:text-gray-600" aria-label="显示/隐藏">
                {showKey ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">模型（留空使用默认）</label>
            <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder="gpt-4o-mini" className={inputCls} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          <button onClick={clear} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400">
            清除本地配置
          </button>
          <button onClick={save} className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300">
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
