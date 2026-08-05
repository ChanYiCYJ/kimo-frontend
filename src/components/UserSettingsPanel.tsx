import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getLocalCfg,
  saveLocalCfg,
  clearLocalCfg,
  type LocalAIConfig,
} from "../lib/localCfg";

interface UserSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  pageId: number;
  canManage: boolean;
  hasCustom: boolean;
  botName: string;
  ttsOn: boolean;
  onToggleTts: () => void;
  webSearchOn: boolean;
  onToggleWebSearch: () => void;
  onExportAll: () => void;
  onImport: () => void;
  onOpenDoc: () => void;
  onCustomSaved: () => void;
  allowCustomApi?: boolean;
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800";

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-gray-100 px-3.5 py-3 dark:border-gray-800"
      role="switch"
      aria-checked={on}
    >
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-gray-900 dark:bg-gray-200" : "bg-gray-300 dark:bg-gray-700"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export function UserSettingsPanel({
  open,
  onClose,
  pageId,
  canManage,
  hasCustom,
  botName,
  ttsOn,
  onToggleTts,
  webSearchOn,
  onToggleWebSearch,
  onExportAll,
  onImport,
  onOpenDoc,
  onCustomSaved,
  allowCustomApi = true,
}: UserSettingsPanelProps) {
  const [cfg, setCfg] = useState<LocalAIConfig>({
    endpoint: "",
    apiKey: "",
    model: "",
    prompt: "",
  });
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) {
      setCfg(getLocalCfg(pageId));
      setShowKey(false);
    }
  }, [open, pageId]);

  if (!open) return null;

  const saveCfg = () => {
    saveLocalCfg(pageId, {
      endpoint: cfg.endpoint.trim(),
      apiKey: cfg.apiKey.trim(),
      model: cfg.model.trim(),
      prompt: cfg.prompt,
    });
    onCustomSaved();
  };
  const clearCfg = () => {
    clearLocalCfg(pageId);
    setCfg({ endpoint: "", apiKey: "", model: "", prompt: "" });
    onCustomSaved();
  };

  return createPortal(
    <div className="fixed inset-0 z-[95]">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              用户设置
            </h3>
            <p className="text-xs text-gray-400">{botName}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="关闭"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {/* 通用 */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-gray-400">通用</p>
            <Toggle on={ttsOn} onClick={onToggleTts} label="自动朗读回复" />
            <Toggle
              on={webSearchOn}
              onClick={onToggleWebSearch}
              label="网络搜索"
            />
          </section>

          {/* 会话数据 */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-gray-400">会话数据</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onExportAll}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                导出全部
              </button>
              <button
                onClick={onImport}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M7.5 12a4.5 4.5 0 109 0m-4.5-9v13.5"
                  />
                </svg>
                导入会话
              </button>
            </div>
          </section>

          {/* 模型 API */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-gray-400">模型 API</p>
            {canManage ? (
              <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                当前使用管理员在「AI 管理」中配置的默认模型。
              </p>
            ) : !allowCustomApi ? (
              <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                管理员已关闭访客自定义模型 API。
              </p>
            ) : (
              <div className="space-y-2 rounded-xl border border-gray-100 p-3 dark:border-gray-800">
                <input
                  value={cfg.endpoint}
                  onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })}
                  placeholder="接口地址（留空用默认）"
                  className={inputCls}
                />
                <div className="relative">
                  <input
                    value={cfg.apiKey}
                    onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                    type={showKey ? "text" : "password"}
                    placeholder="API Key（留空用默认）"
                    className={inputCls}
                  />
                  <button
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600"
                    aria-label="显示/隐藏"
                  >
                    {showKey ? "🙈" : "👁️"}
                  </button>
                </div>
                <input
                  value={cfg.model}
                  onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                  placeholder="模型（留空用默认）"
                  className={inputCls}
                />
                <textarea
                  value={cfg.prompt || ""}
                  onChange={(e) => setCfg({ ...cfg, prompt: e.target.value })}
                  rows={3}
                  placeholder="自定义提示词（可选，覆盖默认人设）"
                  className={`${inputCls} resize-none`}
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveCfg}
                    className="flex-1 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
                  >
                    保存
                  </button>
                  <button
                    onClick={clearCfg}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
                  >
                    清除
                  </button>
                </div>
                {hasCustom && (
                  <p className="text-[11px] text-indigo-500 dark:text-indigo-400">
                    ✓ 自定义 API 已启用（次数/冷却限制已解除）
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 文档与开源 */}
          <section className="space-y-2">
            <p className="text-xs font-medium text-gray-400">文档与开源</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onOpenDoc}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                使用文档
              </button>
              <a
                href="https://github.com/ChanYiCYJ/kimo-frontend"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.24 1.92 1.24 3.23 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.21.7.83.58A12.01 12.01 0 0024 12.5C24 5.87 18.63.5 12 .5z" />
                </svg>
                GitHub
              </a>
            </div>
          </section>

          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
            AI 生成内容仅供参考
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
