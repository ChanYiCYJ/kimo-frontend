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

/**
 * 网络模式：Auto=智能（默认，先按速度回答，AI 缺准确数据时自动升级搜索/文章）、search=网络搜索、view=浏览 Agent（自动生成综合文章）
 */
export type ChatNetMode = "auto" | "search" | "view";

export const FONT_SIZES: readonly ChatFontSize[] = ["sm", "base", "lg"];

// ---- key 常量（保持线上稳定，勿随意改名）----
const KEY_FONT_SIZE = "kimo_ai_fontsize";
const KEY_NET_MODE = "kimo_ai_net_mode";
const KEY_WEB_SEARCH = "kimo_ai_websearch";
const KEY_BROWSE_AGENT = "kimo_ai_browse_agent";
const KEY_TTS = "kimo_ai_tts";
const KEY_MEMORY_PREFIX = "kimo_chat_memory_";
const KEY_CUSTOM_MODEL = "kimo_ai_custom_model";
const KEY_AUTO_KNOWLEDGE = "kimo_ai_autoknow";
const KEY_PERSONA_KNOWLEDGE_PREFIX = "kimo_ai_persona_";

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

// ---- 网络模式（Auto=智能(默认) / search=网络搜索 / view=浏览 Agent，三者互斥）----
export function loadNetMode(): ChatNetMode {
  const v = lsGet(KEY_NET_MODE);
  if (v === "search" || v === "view" || v === "auto") return v;
  // 兼容旧值：fast → auto（旧版 Fast=关闭网络，改名后合并为 Auto 智能模式）
  if (v === "fast") return "auto";
  // 迁移旧 key（无新模式时）：浏览 Agent 显式开启 → view；网络搜索显式开启 → search；否则默认 auto
  if (lsGet(KEY_BROWSE_AGENT) === "1") return "view";
  if (lsGet(KEY_WEB_SEARCH) === "1") return "search";
  return "auto";
}
export function saveNetMode(mode: ChatNetMode): void {
  lsSet(KEY_NET_MODE, mode);
}

// ---- 网络搜索（默认关闭，属于 search 模式）----
export function loadWebSearchOn(): boolean {
  return lsGet(KEY_WEB_SEARCH) === "1";
}
export function saveWebSearchOn(on: boolean): void {
  lsSet(KEY_WEB_SEARCH, on ? "1" : "0");
}

// ---- 浏览 Agent（默认关闭；与网络搜索互斥，开启后搜索自动生成综合文章）----
export function loadBrowseAgentOn(): boolean {
  return lsGet(KEY_BROWSE_AGENT) === "1";
}
export function saveBrowseAgentOn(on: boolean): void {
  lsSet(KEY_BROWSE_AGENT, on ? "1" : "0");
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

// ---- auto-knowledge（默认开启）：对话后自动学习人格笔记，越聊越贴合人设 ----
export function loadAutoKnowledge(): boolean {
  return lsGet(KEY_AUTO_KNOWLEDGE) !== "0";
}
export function saveAutoKnowledge(on: boolean): void {
  lsSet(KEY_AUTO_KNOWLEDGE, on ? "1" : "0");
}

/** 读取人格笔记（按 pageId 隔离） */
export function loadPersonaKnowledge(pageId: number): string {
  return lsGet(KEY_PERSONA_KNOWLEDGE_PREFIX + pageId) || "";
}
export function savePersonaKnowledge(pageId: number, text: string): void {
  lsSet(KEY_PERSONA_KNOWLEDGE_PREFIX + pageId, text);
}
export function clearPersonaKnowledge(pageId: number): void {
  lsRemove(KEY_PERSONA_KNOWLEDGE_PREFIX + pageId);
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

// ---- 记忆自动压缩（防止 token 滥用）----
// 记忆结构：每行一条 "- 用户问：xx → AI 答：yy"
// 压缩策略：
//   1. 相同「问题前段」视为同主题，合并为最新一条（避免重复积累）
//   2. 超过 MAX_MEMORY_LINES 时只保留最新条目（丢弃最旧）
//   3. 超长条目截断，保证总字符数可控
const MAX_MEMORY_LINES = 10;
const MAX_MEMORY_CHARS = 1400;
const MAX_LINE_CHARS = 220;

/** 解析记忆文本为行数组（过滤空行） */
function memoryLines(memory: string): string[] {
  return memory
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * 压缩记忆：合并同主题 + 限制条数/长度。
 * 输入旧记忆全文与新增 Q&A，返回压缩后的新记忆文本。
 */
export function compressMemory(
  oldMemory: string,
  question: string,
  answer: string,
): string {
  const insight = `用户问：${question.slice(0, 50)} → AI 答：${answer.slice(0, 80)}${answer.length > 80 ? "…" : ""}`;
  const lines = memoryLines(oldMemory);

  // 1) 同主题合并：问题前 12 字相同视为同一主题，覆盖旧条目
  const key = question.slice(0, 12);
  const deduped = lines.filter(
    (l) => !l.startsWith("- 用户问：") || !l.slice(0, 14).includes(key),
  );
  deduped.push(`- ${insight}`);

  // 2) 只保留最新 MAX_MEMORY_LINES 条
  const capped = deduped.slice(-MAX_MEMORY_LINES);

  // 3) 逐行截断 + 总量控制
  const truncated = capped.map((l) =>
    l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + "…" : l,
  );
  let total = truncated.join("\n");
  while (total.length > MAX_MEMORY_CHARS && truncated.length > 1) {
    truncated.shift();
    total = truncated.join("\n");
  }
  return total;
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
