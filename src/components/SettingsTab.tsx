import { useState } from "react";
import type { ReactNode } from "react";
import {
  loadCustomModelOn,
  saveCustomModelOn,
  loadTtsAudioUrl,
  saveTtsAudioUrl,
  loadTtsMode,
  saveTtsMode,
  TTS_VOICES,
  type ChatFontSize,
  type TtsMode,
  type TtsVolume,
  type TtsVoice,
} from "../lib/chatSettings";
import { LocalApiForm } from "./LocalApiForm";
import { SearchApiForm } from "./SearchApiForm";
import { DataModal } from "./DataModal";

/**
 * Agent 面板「设置」tab 的数据/回调集合。
 * 由 AIChat 构造并通过 AgentPanel 的 settings 属性传入（desktop/mobile 双渲染共用一份）。
 */
export interface AgentSettingsProps {
  pageId: number;
  canManage: boolean;
  hasCustom: boolean;
  botName: string;
  /** 搜索模式（设置页与「/」弹窗共用同一单选，双向同步） */
  searchMode: "fast" | "auto" | "deep";
  onSetSearchMode: (m: "fast" | "auto" | "deep") => void;
  chatFontSize?: ChatFontSize;
  onSetFontSize?: (v: ChatFontSize) => void;
  onCustomSaved: () => void;
  /** 自定义模型开关（由 AIChat 统一管理：关闭后不再识别为自定义，本地配置保留） */
  customModelOn?: boolean;
  onToggleCustomModel?: () => void;
  allowCustomApi?: boolean;
  /** TTS 总开关（默认关闭；关闭时隐藏消息「朗读」按钮） */
  ttsOn?: boolean;
  onToggleTts?: () => void;
  /** TTS 音量（音频输出控制） */
  ttsVolume?: TtsVolume;
  onSetTtsVolume?: (v: TtsVolume) => void;
  /** TTS 音色（voice 参数） */
  ttsVoice?: TtsVoice;
  onSetTtsVoice?: (v: TtsVoice) => void;
}

/** 设置卡片：细边框 + 无阴影（对齐 Live2D 面板质感），左侧灰色条作为区块标识 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/60 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
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
  searchMode,
  onSetSearchMode,
  chatFontSize = "base",
  onSetFontSize,
  onCustomSaved,
  customModelOn,
  onToggleCustomModel,
  allowCustomApi = true,
  ttsOn = false,
  onToggleTts,
  ttsVolume = "medium",
  onSetTtsVolume,
  ttsVoice = "zh-CN-XiaoxiaoNeural",
  onSetTtsVoice,
}: AgentSettingsProps) {
  // 自定义模型开关：由 AIChat 统一管理（props 驱动，关闭后不再识别为自定义）；
  // 未传 props 时回退本地逻辑（兼容旧用法）
  const customOn = customModelOn ?? (loadCustomModelOn() || hasCustom);
  const toggleCustom = () => {
    if (onToggleCustomModel) {
      onToggleCustomModel();
    } else {
      saveCustomModelOn(!customOn);
    }
  };
  const [dataOpen, setDataOpen] = useState(false);
  // 高级设置：模型API配置默认收起，仅高级用户手动展开
  const [modelApiOpen, setModelApiOpen] = useState(false);
  // 音频 TTS（独立卡片，默认收起表单）：browser=浏览器朗读 / audio=真实音频波形口型
  const [ttsMode, setTtsMode] = useState<TtsMode>(() => loadTtsMode());
  const [ttsAudioUrl, setTtsAudioUrl] = useState(() => loadTtsAudioUrl());
  const switchTtsMode = (m: TtsMode) => {
    setTtsMode(m);
    saveTtsMode(m);
  };
  const saveTtsUrl = () => {
    saveTtsAudioUrl(ttsAudioUrl);
    if (ttsAudioUrl.trim()) {
      setTtsMode("audio");
      saveTtsMode("audio");
    } else {
      setTtsMode("browser");
      saveTtsMode("browser");
    }
  };
  /** 搜索模式说明文案 */
  const searchModeDesc =
    searchMode === "fast"
      ? "纯本地快速：不联网、不生成文章，直接基于本地知识回答"
      : searchMode === "deep"
        ? "深度联网：搜索并生成完整综合文章（View 页面），仅此模式可生成文章"
        : "适当联网搜索：需要时自动联网搜索快速回答，不生成完整文章";

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
      </Section>

      {/* 搜索模式：网络模式 + 搜索速度 + 搜索深度 合并为 Fast/Auto/Deep 单选 */}
      <Section title="搜索模式">
        <div className="space-y-1.5">
          <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
            {(
              [
                { v: "fast", l: "Fast" },
                { v: "auto", l: "Auto" },
                { v: "deep", l: "Deep" },
              ] as { v: "fast" | "auto" | "deep"; l: string }[]
            ).map((m) => (
              <button
                key={m.v}
                onClick={() => onSetSearchMode(m.v)}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition ${
                  searchMode === m.v
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {m.l}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-gray-400">
            {searchModeDesc}
          </p>
        </div>
      </Section>

      {/* 搜索 API：第三方搜索平台（Tavily / SearXNG），同搜索模式卡片样式 */}
      <Section title="搜索 API">
        <div className="space-y-2 pt-1">
          <SearchApiForm />
          <p className="text-[11px] leading-relaxed text-gray-400">
            配置后优先走所选平台，实时获取当天信息；未配置或被拦自动降级。
          </p>
        </div>
      </Section>

      {/* 音频 TTS：同搜索 API 卡片样式；默认关闭（总开关默认关），开启后才展示模式/音量/表单 */}
      <Section title="音频 TTS">
        <div className="space-y-2">
          {/* TTS 总开关（默认关闭） */}
          <Toggle
            on={ttsOn}
            onClick={onToggleTts ?? (() => {})}
            label="朗读"
            sub={
              ttsOn
                ? "已开启：消息上显示「朗读」按钮，可朗读 AI 回复"
                : "已关闭：默认不朗读，消息上的「朗读」按钮隐藏"
            }
          />
          {!ttsOn ? (
            <p className="text-[11px] leading-relaxed text-gray-400">
              在设置中开启朗读后，可配置朗读方式与音量，AI 回复时角色表情动作随朗读触发。
            </p>
          ) : (
            <div className="space-y-2 pt-0.5">
              {/* 朗读模式分段单选（同搜索模式卡片样式） */}
              <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                {(
                  [
                    { v: "browser", l: "浏览器朗读" },
                    { v: "audio", l: "音频 TTS" },
                  ] as { v: TtsMode; l: string }[]
                ).map((m) => (
                  <button
                    key={m.v}
                    onClick={() => switchTtsMode(m.v)}
                    className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition ${
                      ttsMode === m.v
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                        : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
                  >
                    {m.l}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">
                {ttsMode === "audio"
                  ? "音频 TTS 模式：AI 回复更简短口语化，朗读用真实音频波形驱动口型。"
                  : "浏览器自带语音朗读；如需真实音频波形口型，切换到「音频 TTS」配置地址。"}
              </p>
              {/* 音频 TTS 表单（仅音频模式展示） */}
              {ttsMode === "audio" && (
                <div className="space-y-2 pt-0.5">
                  <input
                    value={ttsAudioUrl}
                    onChange={(e) => setTtsAudioUrl(e.target.value)}
                    placeholder="https://…/tts?text={text}"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800"
                  />
                  <button
                    onClick={saveTtsUrl}
                    className="w-full rounded-xl border border-gray-200 bg-white py-2 text-sm text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-600"
                  >
                    保存
                  </button>
                  <p className="text-[11px] leading-relaxed text-gray-400">
                    支持{" "}
                    <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">
                      {"{text}"}
                    </code>{" "}
                    占位符（URL 编码后替换）；留空并保存则回退浏览器朗读。
                  </p>
                  {/* 音色（voice 参数，edge-tts 免费中文神经语音） */}
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      音色
                    </span>
                    <select
                      value={ttsVoice}
                      onChange={(e) => onSetTtsVoice?.(e.target.value)}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 outline-none transition focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      {TTS_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {/* 音量（音频输出控制） */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  朗读音量
                </span>
                <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
                  {(
                    [
                      { v: "low", l: "低" },
                      { v: "medium", l: "中" },
                      { v: "high", l: "高" },
                    ] as { v: TtsVolume; l: string }[]
                  ).map((vl) => (
                    <button
                      key={vl.v}
                      onClick={() => onSetTtsVolume?.(vl.v)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                        ttsVolume === vl.v
                          ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                          : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                    >
                      {vl.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* 高级设置：模型API配置（原自定义模型）默认收起 */}
      <Section title="高级设置">
        {/* 模型API配置：使用自己的接口与密钥（原「自定义模型」并入高级设置） */}
        <div>
          <button
            type="button"
            onClick={() => setModelApiOpen((v) => !v)}
            className="flex w-full items-center justify-between py-1 text-left"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                模型API配置
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-400">
                使用自己的接口与密钥
              </span>
            </span>
            <svg
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${modelApiOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          {modelApiOpen && (
            <div className="space-y-2 pt-1">
              {canManage ? (
                <p className="rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  当前使用管理员在「AI 管理」中为「{botName}
                  」配置的默认模型，无需在 本机填写。
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
                  />
                  {customOn && (
                    <LocalApiForm
                      pageId={pageId}
                      variant="inline"
                      showEnabledHint={hasCustom}
                      onSaved={onCustomSaved}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* 数据：导出 / 导入 本机数据（知识库/对话/网页/自定义AI/Live2D） */}
      <Section title="数据">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setDataOpen(true)} className={ghostBtn}>
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
            导出数据
          </button>
          <button onClick={() => setDataOpen(true)} className={ghostBtn}>
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
            导入数据
          </button>
        </div>
      </Section>

      <p className="pt-1 text-center text-[11px] text-gray-400 dark:text-gray-500">
        AI 生成内容仅供参考
      </p>

      <DataModal open={dataOpen} onClose={() => setDataOpen(false)} />
    </div>
  );
}
