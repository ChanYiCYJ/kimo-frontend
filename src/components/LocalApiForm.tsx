import { useState } from "react";
import {
  getLocalCfg,
  saveLocalCfg,
  clearLocalCfg,
  type LocalAIConfig,
} from "../lib/localCfg";

/**
 * 本地模型 API 配置表单（共享组件）。
 * LocalApiModal 与 Agent 面板「设置」tab 的模型 API 区块共用，
 * 消除此前两处重复的 getLocalCfg/saveLocalCfg/clearLocalCfg 逻辑。
 */
export interface LocalApiFormProps {
  pageId: number;
  /** 保存/清除后回调（modal 在此负责关闭，inline 在此刷新外层状态） */
  onSaved: () => void;
  /** 渲染风格：modal=带 label 的完整表单；inline=紧凑占位符表单 */
  variant?: "modal" | "inline";
  /** inline 模式下显示“自定义 API 已启用（限制已解除）”提示 */
  showEnabledHint?: boolean;
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800";

export function LocalApiForm({
  pageId,
  onSaved,
  variant = "inline",
  showEnabledHint = false,
}: LocalApiFormProps) {
  const [cfg, setCfg] = useState<LocalAIConfig>(() => getLocalCfg(pageId));
  const [showKey, setShowKey] = useState(false);
  const isModal = variant === "modal";

  const save = () => {
    saveLocalCfg(pageId, {
      endpoint: cfg.endpoint.trim(),
      apiKey: cfg.apiKey.trim(),
      model: cfg.model.trim(),
      prompt: cfg.prompt,
    });
    onSaved();
  };
  const clear = () => {
    clearLocalCfg(pageId);
    setCfg({ endpoint: "", apiKey: "", model: "", prompt: "" });
    onSaved();
  };

  return (
    <>
      <div className="space-y-2">
        <div>
          {isModal && (
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              接口地址（留空使用默认）
            </label>
          )}
          <input
            value={cfg.endpoint}
            onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })}
            placeholder={
              isModal ? "https://api.openai.com/v1" : "接口地址（留空用默认）"
            }
            className={inputCls}
          />
        </div>
        <div>
          {isModal && (
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              API Key（留空使用默认）
            </label>
          )}
          <div className="relative">
            <input
              value={cfg.apiKey}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
              type={showKey ? "text" : "password"}
              placeholder={isModal ? "sk-..." : "API Key（留空用默认）"}
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
        </div>
        <div>
          {isModal && (
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              模型（留空使用默认）
            </label>
          )}
          <input
            value={cfg.model}
            onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
            placeholder={isModal ? "gpt-4o-mini" : "模型（留空用默认）"}
            className={inputCls}
          />
        </div>
        <div>
          {isModal && (
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              自定义提示词（覆盖默认人设，可选）
            </label>
          )}
          <textarea
            value={cfg.prompt || ""}
            onChange={(e) => setCfg({ ...cfg, prompt: e.target.value })}
            rows={isModal ? 4 : 3}
            placeholder={
              isModal
                ? "你是一个……（留空则使用默认人设）"
                : "自定义提示词（可选，覆盖默认人设）"
            }
            className={`${inputCls} resize-none`}
          />
        </div>
      </div>

      {isModal ? (
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          <button
            onClick={clear}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
          >
            清除本地配置
          </button>
          <button
            onClick={save}
            className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            保存
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              onClick={save}
              className="flex-1 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
            >
              保存
            </button>
            <button
              onClick={clear}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"
            >
              清除
            </button>
          </div>
          {showEnabledHint && (
            <p className="text-[11px] text-indigo-500 dark:text-indigo-400">
              ✓ 自定义 API 已启用（次数/冷却限制已解除）
            </p>
          )}
        </>
      )}
    </>
  );
}
