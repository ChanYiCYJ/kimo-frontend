import { useState } from "react";
import {
  getLocalCfg,
  saveLocalCfg,
  clearLocalCfg,
  type LocalAIConfig,
} from "../lib/localCfg";
import {
  PROVIDER_PRESETS,
  detectProvider,
  type AiProvider,
} from "../lib/providerPresets";
import {
  testModelConnection,
  formatLatency,
  type TestConnectionResult,
} from "../lib/providerTest";

/**
 * 本地模型 API 配置表单（共享组件）。
 * LocalApiModal 与 Agent 面板「设置」tab 的模型 API 区块共用，
 * 消除此前两处重复的 getLocalCfg/saveLocalCfg/clearLocalCfg 逻辑。
 *
 * 新增 DeepSeek / Kimi / OpenAI 一键预设：点击自动填充接口地址与推荐模型，
 * 并在已填入时按 endpoint/model 识别当前服务商。
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

/** 服务商识别徽标（DeepSeek / Kimi 等） */
function ProviderBadge({ id }: { id: AiProvider }) {
  if (id === "other") return null;
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
      {preset?.name || id}
    </span>
  );
}

export function LocalApiForm({
  pageId,
  onSaved,
  variant = "inline",
  showEnabledHint = false,
}: LocalApiFormProps) {
  const [cfg, setCfg] = useState<LocalAIConfig>(() => getLocalCfg(pageId));
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<"idle" | "loading" | "done">(
    "idle",
  );
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(
    null,
  );
  const isModal = variant === "modal";

  const provider = detectProvider(cfg.endpoint, cfg.model);
  const preset = PROVIDER_PRESETS.find((p) => p.id === provider);

  /** 连接测试：用当前表单值发起最小请求，校验 接口/密钥/模型 是否可用 */
  const runTest = async () => {
    const target = {
      endpoint: cfg.endpoint.trim(),
      apiKey: cfg.apiKey.trim(),
      model: cfg.model.trim(),
    };
    setTestState("loading");
    setTestResult(null);
    const r = await testModelConnection(target);
    setTestResult(r);
    setTestState("done");
  };

  /** 一键填充服务商预设（接口地址 + 推荐模型；不覆盖用户已填的 API Key / 提示词） */
  const applyPreset = (id: AiProvider) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setCfg((prev) => ({
      ...prev,
      endpoint: p.endpoint,
      // 模型为空或当前非该服务商时填入推荐模型（避免覆盖已选好的同类模型）
      model:
        !prev.model.trim() || detectProvider(prev.endpoint, prev.model) !== id
          ? p.model
          : prev.model,
    }));
  };

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
      {/* 一键预设：DeepSeek / Kimi / OpenAI */}
      <div className="space-y-1">
        {isModal && (
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
            快捷预设（一键填充接口与模型）
          </label>
        )}
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              title={p.desc}
              className={`rounded-full border px-2.5 py-1 text-xs transition active:scale-95 ${
                provider === p.id
                  ? "border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        {preset && (
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <ProviderBadge id={provider} />
            <span className="truncate">{preset.desc}</span>
          </p>
        )}
      </div>

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
            list="kimo-ai-model-list"
            placeholder={isModal ? "gpt-4o-mini" : "模型（留空用默认）"}
            className={inputCls}
          />
          {/* 当前识别服务商的可选模型下拉（datalist，不强制） */}
          {preset && preset.models.length > 0 && (
            <datalist id="kimo-ai-model-list">
              {preset.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
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

      {/* 连接测试：校验 接口/密钥/模型 是否真实可用 */}
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={runTest}
          disabled={testState === "loading"}
          className={`w-full rounded-xl border px-3 py-2 text-sm transition active:scale-[0.98] disabled:opacity-50 ${
            testResult?.ok
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
              : testResult
                ? "border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500"
          }`}
        >
          {testState === "loading" ? (
            <span className="inline-flex items-center gap-1.5">
              <svg
                className="h-3.5 w-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              测试中…
            </span>
          ) : (
            <span className="inline-flex items-center justify-center gap-1.5">
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
                />
              </svg>
              测试连接
            </span>
          )}
        </button>
        {testResult && (
          <p
            className={`flex items-center gap-1.5 text-[11px] leading-relaxed ${
              testResult.ok
                ? "text-green-600 dark:text-green-400"
                : "text-red-500 dark:text-red-400"
            }`}
          >
            {testResult.ok ? "✓" : "✗"}
            <span className="min-w-0 flex-1">
              {testResult.message}
              {testResult.latencyMs != null &&
                ` · ${formatLatency(testResult.latencyMs)}`}
            </span>
          </p>
        )}
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
