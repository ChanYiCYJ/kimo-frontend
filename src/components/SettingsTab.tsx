import { useState } from "react";
import type { ReactNode } from "react";
import {
  loadCustomModelOn,
  saveCustomModelOn,
  type ChatFontSize,
  type ChatNetMode,
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
  netMode: ChatNetMode;
  onSetNetMode: (mode: ChatNetMode) => void;
  autoKnowledge: boolean;
  onToggleAutoKnowledge: () => void;
  kbAiReadAll: boolean;
  onToggleKbAiReadAll: (v: boolean) => void;
  onExportAll: () => void;
  onImport: () => void;
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
  netMode,
  onSetNetMode,
  autoKnowledge,
  onToggleAutoKnowledge,
  kbAiReadAll,
  onToggleKbAiReadAll,
  onExportAll,
  onImport,
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
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
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
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              网络模式
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-400">
              {netMode === "auto"
                ? "Auto：自动调用"
                : netMode === "search"
                  ? "Search：联网搜索"
                  : "View：资料统计"}
            </span>
          </span>
          <div className="flex shrink-0 gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
            {(
              [
                { v: "auto", l: "Auto" },
                { v: "search", l: "Search" },
                { v: "view", l: "View" },
              ] as { v: ChatNetMode; l: string }[]
            ).map((m) => (
              <button
                key={m.v}
                onClick={() => onSetNetMode(m.v)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                  netMode === m.v
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {m.l}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800" />
        <Toggle
          on={autoKnowledge}
          onClick={onToggleAutoKnowledge}
          label="自动学习人格"
          sub="对话后自动学习，越聊越贴合人设"
        />
        <div className="border-t border-gray-100 dark:border-gray-800" />
        <Toggle
          on={kbAiReadAll}
          onClick={() => onToggleKbAiReadAll(!kbAiReadAll)}
          label="AI 读取知识库"
          sub="AI 回答自动参考知识库"
        />
      </Section>

      {/* 自定义模型 */}
      <Section title="自定义模型">
        {canManage ? (
          <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            当前使用管理员在「AI 管理」中为「{botName}」配置的默认模型，无需在
            本机填写。
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
                <p className="mb-2.5 text-[11px] leading-relaxed text-gray-400">
                  为「{botName}」配置本机模型，仅保存在当前浏览器
                </p>
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

      {/* 文档与开源 */}
      <Section title="文档与开源">
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
      </Section>

      <p className="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">
        AI 生成内容仅供参考
      </p>
    </div>
  );
}
