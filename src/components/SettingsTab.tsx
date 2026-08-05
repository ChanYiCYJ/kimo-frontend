import { useState } from "react";
import type { ReactNode } from "react";
import {
  loadCustomModelOn,
  saveCustomModelOn,
  type ChatFontSize,
} from "../lib/chatSettings";
import { LocalApiForm } from "./LocalApiForm";

/**
 * Agent 面板「设置」tab 的数据/回调集合。
 * 由 AIChat 构造并通过 AgentPanel 的 settings 属性传入（desktop/mobile 双渲染共用一份）。
 */
export interface AgentSettingsProps {
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
  onClearMemory?: () => void;
  chatFontSize?: ChatFontSize;
  onSetFontSize?: (v: ChatFontSize) => void;
  onCustomSaved: () => void;
  allowCustomApi?: boolean;
}

/** Kimo 风格设置卡片：圆角 + 浅边框 + 轻阴影，左侧灰色条作为区块标识 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
        <span className="h-3 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        {title}
      </p>
      <div className="mt-2.5 space-y-2">{children}</div>
    </section>
  );
}

/** 简洁行式开关（无边框盒，贴近 Shiro 留白风格） */
function Toggle({
  on,
  onClick,
  label,
  sub,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
      role="switch"
      aria-checked={on}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        {sub && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-400">
            {sub}
          </span>
        )}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-gray-900 dark:bg-gray-200" : "bg-gray-300 dark:bg-gray-700"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

const ghostBtn =
  "flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800";

export function SettingsTab({
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
  onClearMemory,
  chatFontSize = "base",
  onSetFontSize,
  onCustomSaved,
  allowCustomApi = true,
}: AgentSettingsProps) {
  // 自定义模型开关：默认关闭（表单隐藏）；若已配置本地 API 则默认展开
  const [customOn, setCustomOn] = useState(
    () => loadCustomModelOn() || hasCustom,
  );
  const toggleCustom = () => {
    setCustomOn((v) => {
      const n = !v;
      saveCustomModelOn(n);
      return n;
    });
  };

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {/* 头部 */}
      <div className="flex items-baseline justify-between px-0.5 pt-0.5">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          设置
        </p>
        <p className="text-xs text-gray-400">{botName}</p>
      </div>

      {/* 通用 */}
      <Section title="通用">
        <div className="flex items-center justify-between py-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            对话字体
          </span>
          <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
            {(["sm", "base", "lg"] as const).map((sz) => (
              <button
                key={sz}
                onClick={() => onSetFontSize?.(sz)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  chatFontSize === sz
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {sz === "sm" ? "小" : sz === "lg" ? "大" : "中"}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800" />
        <Toggle
          on={ttsOn}
          onClick={onToggleTts}
          label="自动朗读回复"
          sub="AI 回复后自动用语音朗读"
        />
        <div className="border-t border-gray-100 dark:border-gray-800" />
        <Toggle
          on={webSearchOn}
          onClick={onToggleWebSearch}
          label="网络搜索"
          sub="开启后 AI 会联网检索最新信息"
        />
      </Section>

      {/* 自定义模型 */}
      <Section title="自定义模型">
        {canManage ? (
          <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            当前使用管理员在「AI 管理」中配置的默认模型。
          </p>
        ) : !allowCustomApi ? (
          <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            管理员已关闭访客自定义模型。
          </p>
        ) : (
          <>
            <Toggle
              on={customOn}
              onClick={toggleCustom}
              label="使用自定义模型"
              sub="填入自己的接口/密钥/模型，自动解除次数与冷却限制"
            />
            {customOn && (
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-800 dark:bg-gray-800/40">
                <LocalApiForm
                  pageId={pageId}
                  variant="inline"
                  showEnabledHint={hasCustom}
                  onSaved={onCustomSaved}
                />
              </div>
            )}
          </>
        )}
      </Section>

      {/* 会话数据 */}
      <Section title="会话数据">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onExportAll} className={ghostBtn}>
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
          <button onClick={onImport} className={ghostBtn}>
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
      </Section>

      {/* 对话记忆 */}
      <Section title="对话记忆">
        <p className="text-[11px] leading-relaxed text-gray-400">
          AI 会从过往对话中学习偏好，自动优化回复。
        </p>
        {onClearMemory && (
          <button
            onClick={onClearMemory}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2.5 text-sm text-red-500 transition hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
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
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
            清除本机记忆
          </button>
        )}
      </Section>

      {/* 文档与开源 */}
      <Section title="文档与开源">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onOpenDoc} className={ghostBtn}>
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
            className={ghostBtn}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.24 1.92 1.24 3.23 0 4.62-2.8 5.64-5.48 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.21.7.83.58A12.01 12.01 0 0024 12.5C24 5.87 18.63.5 12 .5z" />
            </svg>
            GitHub
          </a>
        </div>
      </Section>

      <p className="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">
        AI 生成内容仅供参考
      </p>
    </div>
  );
}
