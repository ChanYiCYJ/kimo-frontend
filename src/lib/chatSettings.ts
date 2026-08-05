import type { AIChatConfig } from "./types";
import type { LocalAIConfig } from "./localCfg";

/**
 * AI Chat 用户设置统一存储层
 * ------------------------------------------------------------------
 * 收敛散落在 AIChat / SettingsTab 中的 localStorage 读写：
 * - 统一 key 常量（保持线上已部署的 key 名，避免破坏存量用户偏好，不做破坏性迁移）
 * - 统一默认值、类型校验与读写容错（try/catch 全部内聚于此）
 * - 纯函数实现，可直接在 vitest 中单测
 *
 * 覆盖「用户偏好类」设置：对话字体 / 网络搜索 / 自动朗读 / 本机记忆 / effCfg 合并。
 * 会话、冷却、每日额度、consent 等「会话数据」仍由 AIChat 内部管理。
 */

export type ChatFontSize = "sm" | "base" | "lg";

export const FONT_SIZES: readonly ChatFontSize[] = ["sm", "base", "lg"];

// ---- key 常量（保持线上稳定，勿随意改名）----
const KEY_FONT_SIZE = "kimo_ai_fontsize";
const KEY_WEB_SEARCH = "kimo_ai_websearch";
const KEY_TTS = "kimo_ai_tts";
const KEY_MEMORY_PREFIX = "kimo_chat_memory_";
const KEY_CUSTOM_MODEL = "kimo_ai_custom_model";

// ---- localStorage 安全封装 ----
export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 忽略（隐私模式/配额满） */
  }
}
export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

// ---- 对话字体 ----
export function loadChatFontSize(): ChatFontSize {
  const v = lsGet(KEY_FONT_SIZE);
  return FONT_SIZES.includes(v as ChatFontSize) ? (v as ChatFontSize) : "base";
}
export function saveChatFontSize(v: ChatFontSize): void {
  lsSet(KEY_FONT_SIZE, v);
}

// ---- 网络搜索 ----
export function loadWebSearchOn(): boolean {
  return lsGet(KEY_WEB_SEARCH) === "1";
}
export function saveWebSearchOn(on: boolean): void {
  lsSet(KEY_WEB_SEARCH, on ? "1" : "0");
}

// ---- 自动朗读（用户浏览器偏好优先，未设置时跟随 config.autoTTS）----
export interface TtsPref {
  /** 是否已由用户显式设置过 */
  set: boolean;
  /** 生效值 */
  on: boolean;
}
export function loadTtsPref(configAutoTTS?: boolean): TtsPref {
  const p = lsGet(KEY_TTS);
  if (p === "1" || p === "0") return { set: true, on: p === "1" };
  return { set: false, on: !!configAutoTTS };
}
export function saveTtsPref(on: boolean): void {
  lsSet(KEY_TTS, on ? "1" : "0");
}

// ---- 本机记忆（按 pageId 隔离）----
export function loadMemory(pageId: number): string {
  return lsGet(KEY_MEMORY_PREFIX + pageId) || "";
}
export function saveMemory(pageId: number, memory: string): void {
  lsSet(KEY_MEMORY_PREFIX + pageId, memory);
}
export function clearMemory(pageId: number): void {
  lsRemove(KEY_MEMORY_PREFIX + pageId);
}

// ---- 自定义模型开关（默认关闭，仅控制设置面板中表单的展开）----
export function loadCustomModelOn(): boolean {
  return lsGet(KEY_CUSTOM_MODEL) === "1";
}
export function saveCustomModelOn(on: boolean): void {
  lsSet(KEY_CUSTOM_MODEL, on ? "1" : "0");
}

// ---- 有效配置合并（本地自定义 API/提示词 > 选中人设 > 机器人默认）----
export function hasLocalApi(cfg: LocalAIConfig): boolean {
  return !!(cfg.endpoint || cfg.apiKey || cfg.model);
}

export function mergeEffCfg(
  config: AIChatConfig,
  localCfg: LocalAIConfig,
  activePromptIdx?: number | null,
): AIChatConfig {
  const prompts = config.prompts || [];
  const selected =
    activePromptIdx != null ? prompts[activePromptIdx] : undefined;
  return {
    ...config,
    endpoint: localCfg.endpoint || config.endpoint,
    apiKey: localCfg.apiKey || config.apiKey,
    model: localCfg.model || config.model,
    systemPrompt:
      localCfg.prompt || selected?.systemPrompt || config.systemPrompt,
  };
}
