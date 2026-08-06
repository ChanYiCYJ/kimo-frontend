import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AIChatConfig, Page } from "../lib/types";
import { useSite } from "../lib/site";
import { useTheme } from "../lib/theme";
import {
  webSearch,
  fetchWebpage,
  searchWithCache,
  readSearchCache,
  writeSearchCache,
  webSearchWithContent,
} from "../lib/search";
import {
  getKbSelections,
  getKbNotes,
  assembleKnowledge,
  parseKbTool,
  saveKbEntry,
  detectKbSaveIntent,
} from "../lib/kb";
import { getLocalCfg } from "../lib/localCfg";
import {
  mergeEffCfg,
  hasLocalApi,
  loadChatFontSize,
  loadNetMode,
  saveNetMode,
  loadTtsPref,
  saveTtsPref,
  loadMemory,
  saveMemory,
  saveChatFontSize,
  compressMemory,
  loadAutoKnowledge,
  saveAutoKnowledge,
  loadPersonaKnowledge,
  savePersonaKnowledge,
  type ChatFontSize,
  type ChatNetMode,
} from "../lib/chatSettings";
import { LocalApiModal } from "./LocalApiModal";
import { ArticleComposerModal } from "./ArticleComposerModal";
import { AgentPanel } from "./AgentPanel";
// 性能优化：AgentPanel 是重型组件（含编辑器/知识库/Live2D 等）且桌面+移动双实例渲染；
// memo 后配合稳定 props，在输入/冷却/流式等父组件重渲染时跳过不必要的重复渲染
const MemoAgentPanel = memo(AgentPanel);
import { KbPicker } from "./KbPicker";
import {
  detectEmotion,
  detectReplyEmotion,
  LIVE2D_CHARACTERS,
  LIVE2D_MODEL_AUTO,
  loadLive2dModel,
  onAutoPickRequest,
  parseEmotionTag,
  saveAutoPick,
  stripEmotionTag,
  type Emotion,
} from "../lib/live2d";
import {
  getState,
  loadModel,
  setEmotion as applyL2dModelEmotion,
} from "../lib/live2dCore";
import { pickLive2dCharacter } from "../lib/ai";
import { parseDelta, resolveMaxTokens } from "../lib/providerPresets";
import type { AgentSettingsProps } from "./SettingsTab";
import { Live2DBackground } from "./Live2DBackground";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** 附加的知识库条目（对话中以卡片展示，AI 上下文仍会注入内容） */
  attachments?: { id: string; title: string; content: string }[];
}

/**
 * 从 AI 回复显示文本中过滤工具指令（[SEARCH:] / [BROWSE:] / [EDIT:] / [KB-*] 等），
 * 它们由 toolCalls 小卡片承载展示，避免在消息里露出原始标记。
 */
import { stripToolCmds } from "../lib/toolCmds";

interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

/**
 * 消息 Markdown 渲染（memo 化）：
 * 性能优化——流式生成/长会话时仅最后一条消息内容变化，其余消息的 ReactMarkdown
 * 解析（含 rehype-highlight）每次父组件重渲染都会重复执行；抽成 memo 后，
 * content 未变的消息直接复用上一次解析结果，避免长对话/流式下反复高亮渲染卡顿。
 */
const MarkdownContent = memo(function MarkdownContent({
  content,
  fallback,
}: {
  content: string;
  fallback: string;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {stripToolCmds(content) || fallback}
    </ReactMarkdown>
  );
});

/** 导航栏角色头像：懒加载 + 加载完成淡入（优化模型图片加载），无图时显示首字占位 */
function BotAvatar({
  src,
  name,
  className = "h-5 w-5",
  textCls = "",
}: {
  src?: string;
  name?: string;
  className?: string;
  textCls?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  if (!src) {
    return (
      <span
        className={`grid shrink-0 place-content-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300 ${textCls} ${className}`}
      >
        {(name || "AI").slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onLoad={() => setLoaded(true)}
      className={`shrink-0 rounded-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
    />
  );
}

export interface BotItem {
  id: number;
  name: string;
  config: AIChatConfig;
  page: Page;
}

interface AIChatProps {
  config: AIChatConfig;
  pageId: number;
  center?: boolean;
  bots?: BotItem[];
  onSwitchBot?: (id: number) => void;
  canManage?: boolean;
  onManage?: () => void;
  enableArticles?: boolean;
  enableCustomApi?: boolean;
}

const STORAGE_PREFIX = "kimo_chat_";

/** 截断长文本到上限（末尾省略号），避免知识库/浏览文章/网络结果等上下文过度消耗 token */
function clamp(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/** Agent 面板状态（打开/tab/地址/编辑内容）持久化 key */
const AGENT_STATE_KEY = (pageId: number) => `kimo_ai_agent_state_${pageId}`;
/** 各会话最近生成的 View 文章话题持久化 key */
const VIEW_TOPIC_KEY = (pageId: number) => `kimo_ai_viewtopic_${pageId}`;

async function streamChat(
  cfg: AIChatConfig,
  msgs: Message[],
  onUpdate: (content: string) => void,
  signal: AbortSignal,
  summary = "",
  knowledge = "",
  memory = "",
  web = "",
  webTools = true,
  browseMode = false,
  viewArticle = "",
  personaKnowledge = "",
  autoMode = false,
) {
  // Token 优化：注入的上下文统一截断上限，控制单次请求 token 消耗
  const capKnowledge = clamp(knowledge, 6000);
  const capMemory = clamp(memory, 2000);
  const capPersona = clamp(personaKnowledge, 2000);
  const capSummary = clamp(summary, 1500);
  const capWeb = clamp(web, 6000);
  const capView = clamp(viewArticle, 5000);
  const sys =
    (capKnowledge
      ? `【重要】你必须优先基于以下用户知识库回答。如果知识库有相关信息，请以此为权威来源：\n${capKnowledge}\n\n---\n\n`
      : "") +
    (cfg.systemPrompt || "") +
    (capMemory
      ? `\n\n以下是过往对话中学习到的用户偏好与经验，请据此优化你的回答：\n${capMemory}`
      : "") +
    (capPersona
      ? `\n\n【auto-knowledge 人格笔记】以下是你越聊越懂用户、越贴合人设的自动学习笔记（每条为一段对话后提炼）。请自然地融入你的性格与回答，不要提及这些笔记本身：\n${capPersona}`
      : "") +
    (capSummary ? `\n\n对话上下文摘要：\n${capSummary}` : "") +
    (capWeb
      ? `\n\n以下是来自网络的最新搜索结果，请基于它们回答（并在适当时注明来源）：\n${capWeb}`
      : "") +
    (capView
      ? `\n\n【当前浏览文章】以下是 View 面板中当前生成的综合文章，用户可能会基于它继续提问、总结或要求优化。请以它为事实基础作答；**当用户要求修改/优化这篇文章时，直接输出修改后的完整文章并用 [VIEW:内容] 括起（不要用 [EDIT:]），我会更新 View 面板中的文章**。\n${capView}`
      : "") +
    (autoMode
      ? `\n\n【智能模式 Auto】当前为智能模式：默认直接基于你的知识快速、简洁地回答（不需要联网就绝不联网）。但如果你对用户的问题**没有准确、可靠或最新的数据**，必须主动升级，二选一：
① 需要实时/最新资讯，或只需简单事实核查 → 先输出 1-2 句中文说明，然后附上 [SEARCH:关键词]（简短关键词即可），我会联网搜索并让你基于结果准确回答；
② 问题适合生成一篇**完整的综合文章**（介绍/盘点/攻略/评测等长篇内容）→ **先输出 1-2 句中文说明并询问用户是否要生成**（如“要我为你整理一篇关于 X 的完整文章吗？”），**不要立即附 [VIEW:]**；等用户明确同意/要求生成后，下一条回复再附 [VIEW:关键词]（简短关键词即可，**不要**输出整篇文章）来生成综合文章。若用户一开始就已明确要求“生成/写一篇 X 文章”，则直接附 [VIEW:关键词]。
判断原则：能直接回答就回答（快）；拿不准/信息过时/不熟悉才升级。不要为了联网而联网。`
      : "") +
    (browseMode
      ? `\n\n【联网浏览模式】当前已开启「view」，详细内容由 view 生成文章，你只需简短引导。规则：当用户提问需要查询外部/最新/不熟悉的信息时，只允许输出 1-2 句简短的中文说明（不超过 50 字），然后必须附上 [SEARCH:关键词]；严禁自行展开成长篇回答，详细内容一律交给 view 生成。**这 1-2 句说明请严格保持你一贯的语气与性格（按你的系统人设来回应，自然、有辨识度），不要用生硬的套话。**若问题不需要联网（寒暄、写代码、简单常识等），正常按你的风格简短回答即可。`
      : "") +
    `\n\n工具使用说明：${webTools ? "当用户询问实时动态、最新资讯、或不熟悉的时效性信息时，请主动联网搜索并回复 [SEARCH:关键词]（直接给出简洁关键词，不要构造或浏览搜索引擎 URL）；当用户明确给出某个网页链接并要求获取其内容时，回复 [BROWSE:url]；" : ""}当需要帮你写作文档或编辑内容时，用 [EDIT:内容] 括起完整内容（必须用 ] 闭合，且编辑内容之后不要再追加其他文字）；当需要更新当前浏览文章（View 面板中的文章）时，用 [VIEW:修改后的完整文章] 括起。

【知识库操作（重要，务必遵循）】用户用「帮我记/记一下/保存到知识库/存入知识库/整理要点/记笔记/沉淀知识/收藏这段」等表达时，你**必须**把内容保存进知识库，用 [KB-SAVE:标题]内容[/KB-SAVE]（标题要简短概括，内容是完整要点；同名标题会更新，不要新建重复条目）；用户要求「修改/更新知识库里的 xxx」时，用 [KB-EDIT:标题]新内容[/KB-EDIT]（按标题匹配改写）；用户需要「查看/整理/用到知识库」时，回复 [KB:说明]（会自动打开知识库面板）。注意：以上三个指令都**必须写完整闭合标签**，保存/编辑内容要紧跟在标题后，否则无法识别。

重要：使用任何工具指令时，必须先输出一两句面向用户的中文说明文字（如"好的，我帮你记一下"），再附上工具指令，禁止只输出工具标记。一次只回复一个工具指令。

【Live2D 角色】你现在以一个 Live2D 角色（对话界面旁显示的虚拟形象）的身份与用户对话，让这个形象配合你的情绪。思考/组织语言时形象会自动显示"思考"；**每次回复时请在回复最末尾附一个表情标记 [表情:名称]**，名称只能是：平静/开心/难过/生气/惊讶/害羞/思考/困倦/眨眼。例如：开心地回应 → [表情:开心]；安慰难过的用户 → [表情:难过] 或 [表情:平静]；被夸奖而害羞 → [表情:害羞]；遇到惊讶的事 → [表情:惊讶]。标记必须放在末尾、不要影响正文。`;
  const res = await fetch(
    cfg.endpoint.replace(/\/+$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: sys },
          ...msgs.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        stream: true,
        // 按模型适配输出上限：推理模型（reasoner/thinking）思考先占 token 必须给足；
        // Kimi moonshot-v1 默认仅 1024，长文/文章生成易被截断，自动调大
        max_tokens: resolveMaxTokens(cfg.model),
      }),
      signal,
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `AI 请求失败 (${res.status})${t ? ": " + t.slice(0, 100) : ""}`,
    );
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("不支持流式");
  const dec = new TextDecoder();
  let full = "";
  // 推理模型（reasoner/thinking）思考在 delta.reasoning_content 或 <|thinking|> 内，
  // 本地累计仅用于从正文剥离，不展示、不入消息
  let reasoning = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec
      .decode(value, { stream: true })
      .split("\n")
      .filter((l) => l.startsWith("data: "))) {
      const d = line.slice(6);
      if (d === "[DONE]") continue;
      try {
        const j = JSON.parse(d);
        const { content: t, reasoning: rt } = parseDelta(j.choices?.[0]?.delta);
        // 兼容部分服务端把思考直接放 content（无 reasoning_content）的模型：
        // 形如 <|thinking|>...<|/thinking|> 时剥离，仅保留正文
        if (rt) {
          reasoning += rt;
        } else if (t) {
          const isReasoningStream =
            cfg.model.toLowerCase().includes("reasoner") ||
            cfg.model.toLowerCase().includes("thinking");
          if (isReasoningStream && t.includes("<|thinking|>")) {
            let rest = t;
            while (rest.includes("<|thinking|>")) {
              const i0 = rest.indexOf("<|thinking|>");
              const i1 = rest.indexOf("<|/thinking|>");
              if (i1 > i0) {
                full += rest.slice(0, i0);
                reasoning += rest.slice(i0 + "<|thinking|>".length, i1);
                rest = rest.slice(i1 + "<|/thinking|>".length);
              } else {
                // 未闭合：当前块之后的剩余都视为思考（下次 chunk 拼接）
                full += rest.slice(0, i0);
                reasoning += rest.slice(i0 + "<|thinking|>".length);
                rest = "";
              }
            }
            full += rest;
            onUpdate(full);
          } else {
            full += t;
            onUpdate(full);
          }
        }
      } catch {}
    }
  }
  return { content: full };
}

/** TTS 朗读文本 */
function speak(text: string) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 1.1;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

const SESSION_STORAGE = (pageId: number) =>
  STORAGE_PREFIX + "sessions_" + pageId;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 用 AI 从对话上下文提炼 1 个搜索关键词（避免把闲聊/追问当关键词），失败返回空串 */
async function deriveSearchKeyword(
  cfg: AIChatConfig,
  msgs: Message[],
): Promise<string> {
  try {
    const convo = msgs
      .slice(-5)
      .map(
        (m) =>
          `${m.role === "user" ? "用户" : "AI"}：${m.content
            .replace(/\[[\s\S]*?\]/g, "")
            .slice(0, 200)}`,
      )
      .join("\n");
    if (!convo.trim()) return "";
    const sys =
      "你是搜索关键词提取器。根据下面这段对话，提炼 1 个最合适的网络搜索关键词（中文或英文，5-20 字，可直接用于搜索引擎）。只输出关键词本身，不要引号、不要解释、不要换行。";
    const body = () =>
      JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: convo },
        ],
        temperature: 0.3,
        // 推理模型会先消耗 reasoning token，按模型调大避免 content 为空
        max_tokens: resolveMaxTokens(cfg.model, 800),
        stream: false,
      });
    // 推理模型会先消耗 reasoning token，max_tokens 给足 + 空内容重试一次
    const fetchOnce = async () => {
      const res = await fetch(
        cfg.endpoint.replace(/\/+$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: body(),
        },
      );
      if (!res.ok) return "";
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return String(j?.choices?.[0]?.message?.content || "").trim();
    };
    let raw = await fetchOnce();
    if (!raw) raw = await fetchOnce();
    const kw = raw.replace(/["'“”]/g, "").replace(/\n+/g, " ");
    return kw.slice(0, 40);
  } catch {
    return "";
  }
}

/**
 * auto-knowledge：对话完成后在后台提炼「人格笔记」+ 值得联网补充的话题关键词。
 * 返回 { note, keyword }；失败返回空。
 */
async function derivePersonaKnowledge(
  cfg: AIChatConfig,
  msgs: Message[],
  currentKnowledge: string,
): Promise<{ note: string; keyword: string }> {
  try {
    const convo = msgs
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "用户" : "AI"}：${m.content
            .replace(/\[[\s\S]*?\]/g, "")
            .slice(0, 180)}`,
      )
      .join("\n");
    const sys =
      "你是「人格学习引擎」。阅读这段对话，提炼 1 条能让你更贴合自己人设、更懂用户的简短笔记（≤60 字，写人格洞察/用户偏好/相处之道），并给出 1 个值得联网补充了解的话题关键词（若有，否则写“无”）。严格按两行输出：\n笔记：...\n关键词：... 或 无";
    const userMsg = `已有笔记：\n${currentKnowledge || "（无）"}\n\n本次对话：\n${convo}`;
    const body = () =>
      JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        temperature: 0.5,
        // 推理模型会先消耗 reasoning token，按模型调大避免 content 为空
        max_tokens: resolveMaxTokens(cfg.model, 1200),
        stream: false,
      });
    // 推理模型会先消耗 reasoning token，max_tokens 给足 + 空内容重试一次
    const fetchOnce = async () => {
      const res = await fetch(
        cfg.endpoint.replace(/\/+$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: body(),
        },
      );
      if (!res.ok) return "";
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return String(j?.choices?.[0]?.message?.content || "").trim();
    };
    let raw = await fetchOnce();
    if (!raw) raw = await fetchOnce();
    // 解析：优先 "笔记：" 前缀；取不到时把整段第一行当笔记，避免格式漂移丢数据
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let note = "";
    let keyword = "";
    for (const l of lines) {
      if (!note && /^笔记[:：]/.test(l)) note = l.replace(/^笔记[:：]\s*/, "");
      else if (/^关键词[:：]/.test(l))
        keyword = l.replace(/^关键词[:：]\s*/, "");
    }
    if (!note && lines.length) {
      const first = lines[0].replace(/^笔记[:：]\s*/, "");
      if (!/^关键词[:：]/.test(first)) note = first;
    }
    if (!keyword) {
      const k = lines.find((l) => l.startsWith("关键词"));
      if (k) keyword = k.replace(/^关键词[:：]\s*/, "");
    }
    note = note
      .replace(/["'“”]/g, "")
      .replace(/\n+/g, " ")
      .slice(0, 80);
    const kwRaw = keyword
      .replace(/["'“”]/g, "")
      .replace(/\n+/g, " ")
      .trim();
    const kw = kwRaw && kwRaw !== "无" ? kwRaw.slice(0, 40) : "";
    return { note, keyword: kw };
  } catch {
    return { note: "", keyword: "" };
  }
}

export function AIChat({
  config,
  pageId,
  center,
  bots,
  onSwitchBot,
  canManage,
  onManage,
  enableCustomApi,
}: AIChatProps) {
  const { settings } = useSite();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [sessions, setSessions] = useState<Session[]>(() => {
    try {
      const r = localStorage.getItem(SESSION_STORAGE(pageId));
      if (r) {
        const p = JSON.parse(r);
        if (Array.isArray(p) && p.length) return p;
      }
    } catch {}
    return [
      { id: uid(), title: "新对话", messages: [], createdAt: Date.now() },
    ];
  });
  const [activeId, setActiveId] = useState<string>(() => sessions[0]?.id || "");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(() => {
    try {
      const end = Number(
        localStorage.getItem(STORAGE_PREFIX + "cooldown_" + pageId),
      );
      if (end > Date.now()) return Math.ceil((end - Date.now()) / 1000);
    } catch {}
    return 0;
  });
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [stick, setStick] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("kimo_ai_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [localCfg, setLocalCfg] = useState(() => getLocalCfg(pageId));
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [articleOpen, setArticleOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(() => {
    try {
      const s = JSON.parse(
        localStorage.getItem(AGENT_STATE_KEY(pageId)) || "{}",
      );
      return s.open === true;
    } catch {}
    return false;
  });
  /** 移动端「工具箱」入口小提示（浏览/知识库/编辑器），首次显示几秒后消失 */
  const [agentHint, setAgentHint] = useState(false);
  useEffect(() => {
    // 桌面端不需要提示；仅移动端且尚未提示过时显示
    const shown = localStorage.getItem("kimo_agent_hint_shown") === "1";
    if (window.innerWidth < 1024 && !shown && !agentOpen) {
      setAgentHint(true);
      const t = setTimeout(() => {
        setAgentHint(false);
        try {
          localStorage.setItem("kimo_agent_hint_shown", "1");
        } catch {}
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [agentOpen]);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [kbPickerSelected, setKbPickerSelected] = useState<string[]>([]);
  const [kbAttachments, setKbAttachments] = useState<
    { id: string; title: string; content: string }[]
  >([]);
  /** 知识库弹窗：选中回调稳定化（配合 KbPicker 的 memo 行组件，弹窗期间父组件重渲染不导致全量重建） */
  const onKbPickerToggle = useCallback((id: string) => {
    setKbPickerSelected((p) =>
      p.includes(id) ? p.filter((x: string) => x !== id) : [...p, id],
    );
  }, []);
  const onKbPickerInsert = useCallback(
    (notes: { id: string; title: string; content: string }[]) => {
      setKbAttachments((prev) => [
        ...prev,
        ...notes.filter((n) => !prev.find((x) => x.id === n.id)),
      ]);
    },
    [],
  );
  // Live2D 化身：默认开启（「/」弹窗可关），AI 根据对话情境控制表情
  const [live2dOn, setLive2dOn] = useState(() => {
    try {
      return localStorage.getItem("kimo_live2d_on") !== "0";
    } catch {
      return true;
    }
  });
  /** Live2D 功能是否生效（用户开关 + 后台开关） */
  const l2dEnabled = live2dOn && settings.live2d_enable !== "0";
  /** 手机布局检测（沉浸 Live2D 模式仅手机） */
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1024,
  );
  useEffect(() => {
    const onR = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  /** 手机沉浸 Live2D：角色全屏背景 + 保留顶栏/旧输入条浮空 + 只展示 AI 一句 */
  const live2dImmersive = l2dEnabled && !agentOpen && isMobile;
  /** 手机沉浸：输入框聚焦（键盘弹出）时减少底部安全区留白，避免对话栏下方出现大块空白 */
  const [inputFocused, setInputFocused] = useState(false);
  const toggleLive2d = useCallback(() => {
    setLive2dOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("kimo_live2d_on", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  /** 应用表情：直接写入 live2dCore（Agent 面板 Live2D 舞台 / 移动端 dock 订阅其状态） */
  const applyL2dEmotion = useCallback((em: Emotion) => {
    applyL2dModelEmotion(em);
  }, []);
  const [agentInitUrl, setAgentInitUrl] = useState<string | undefined>(() => {
    try {
      const s = JSON.parse(
        localStorage.getItem(AGENT_STATE_KEY(pageId)) || "{}",
      );
      return s.url || undefined;
    } catch {}
    return undefined;
  });
  const [agentTab, setAgentTab] = useState<
    "web" | "kb" | "edit" | "settings" | "live2d"
  >(() => {
    try {
      const s = JSON.parse(
        localStorage.getItem(AGENT_STATE_KEY(pageId)) || "{}",
      );
      if (
        s.tab === "web" ||
        s.tab === "edit" ||
        s.tab === "settings" ||
        s.tab === "live2d"
      )
        return s.tab;
    } catch {}
    return "kb";
  });
  const [agentEditContent, setAgentEditContent] = useState<string | undefined>(
    () => {
      try {
        const s = JSON.parse(
          localStorage.getItem(AGENT_STATE_KEY(pageId)) || "{}",
        );
        return s.edit || undefined;
      } catch {}
      return undefined;
    },
  );
  /** 当前会话浏览生成的 View 文章话题（用于让 AI 读取文章并支持对话续优化） */
  const [viewTopic, setViewTopic] = useState("");
  // Agent 面板状态持久化：刷新后恢复打开状态 / tab / 地址 / 编辑内容
  useEffect(() => {
    try {
      localStorage.setItem(
        AGENT_STATE_KEY(pageId),
        JSON.stringify({
          open: agentOpen,
          tab: agentTab,
          url: agentInitUrl || "",
          edit: agentEditContent || "",
        }),
      );
    } catch {}
  }, [agentOpen, agentTab, agentInitUrl, agentEditContent, pageId]);
  // viewTopic 按会话记忆：切换会话恢复、变更时显式保存（避免跨会话串写）
  const saveViewTopic = useCallback(
    (sid: string, topic: string) => {
      try {
        const m = JSON.parse(
          localStorage.getItem(VIEW_TOPIC_KEY(pageId)) || "{}",
        );
        if (topic) m[sid] = topic;
        else delete m[sid];
        localStorage.setItem(VIEW_TOPIC_KEY(pageId), JSON.stringify(m));
      } catch {}
    },
    [pageId],
  );
  const changeViewTopic = useCallback(
    (topic: string) => {
      setViewTopic(topic);
      saveViewTopic(activeId, topic);
    },
    [activeId, saveViewTopic],
  );
  useEffect(() => {
    try {
      const m = JSON.parse(
        localStorage.getItem(VIEW_TOPIC_KEY(pageId)) || "{}",
      );
      setViewTopic(m[activeId] || "");
    } catch {
      setViewTopic("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pageId]);
  const [agentKbOpen, setAgentKbOpen] = useState<
    | {
        nonce: number;
        entry: { id: string; name: string; content: string; createdAt: number };
      }
    | undefined
  >();
  const [agentWidth, setAgentWidth] = useState(() => {
    // 拖拽允许范围 [300, 视口-360]（给聊天区留空间），这里保持一致，避免拖宽后刷新被丢弃
    const maxW =
      typeof window === "undefined"
        ? 520
        : Math.max(320, window.innerWidth - 360);
    try {
      const saved = Number(localStorage.getItem("kimo_ai_agent_width"));
      if (saved >= 300 && saved <= maxW) return saved;
    } catch {}
    if (typeof window === "undefined") return 384;
    return Math.min(520, Math.max(320, Math.round(window.innerWidth * 0.3)));
  });
  const [attachedFile, setAttachedFile] = useState("");
  const [searching, setSearching] = useState(false);
  const [kbText, setKbText] = useState("");
  const [chatFontSize, setChatFontSize] = useState<ChatFontSize>(() =>
    loadChatFontSize(),
  );
  const fontSizeCls =
    chatFontSize === "sm"
      ? "text-sm"
      : chatFontSize === "lg"
        ? "text-lg"
        : "text-[15px]";
  /** 网络模式：Auto(智能,默认,先按速度回答，缺准确数据自动升级) / search(网络搜索) / view(浏览 Agent，自动生成综合文章)，三者互斥 */
  const [netMode, setNetMode] = useState<ChatNetMode>(() => loadNetMode());
  const autoMode = netMode === "auto";
  const webSearchOn = netMode === "search";
  const browseAgentOn = netMode === "view";
  const changeNetMode = useCallback((mode: ChatNetMode) => {
    setNetMode(mode);
    saveNetMode(mode);
  }, []);
  /** auto-knowledge：对话后自动学习人格笔记，越聊越贴合人设（默认开） */
  const [autoKnowledge, setAutoKnowledge] = useState(() => loadAutoKnowledge());
  const [personaKnowledge, setPersonaKnowledge] = useState(() =>
    loadPersonaKnowledge(pageId),
  );
  const toggleAutoKnowledge = useCallback(() => {
    setAutoKnowledge((v) => {
      const n = !v;
      saveAutoKnowledge(n);
      return n;
    });
  }, []);
  // 防并发：一次只跑一个后台人格学习任务
  const personaRunningRef = useRef(false);
  /** AI 读取知识库开关（默认开，设置里可关） */
  const [kbAiReadAll, setKbAiReadAll] = useState(() => {
    try {
      return localStorage.getItem("kimo_kb_ai_read_all") !== "0";
    } catch {
      return true;
    }
  });
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  /** 模型切换下拉（portal 到 body，避免被 Agent 面板/移动弹层遮盖）；记录锚定位置 */
  const botBtnRef = useRef<HTMLButtonElement>(null);
  const [botMenuPos, setBotMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const toggleBotMenu = () => {
    setBotMenuOpen((v) => {
      const nv = !v;
      if (nv) {
        const r = botBtnRef.current?.getBoundingClientRect();
        if (r) {
          const W = 240;
          const left = Math.min(r.left, window.innerWidth - W - 8);
          setBotMenuPos({
            left: Math.max(8, left),
            top: r.bottom + 4,
          });
        }
      }
      return nv;
    });
  };
  const [limitReached, setLimitReached] = useState(false);
  const [toolCalls, setToolCalls] = useState<
    {
      msgIdx: number;
      type: string;
      detail: string;
      tab?: "web" | "kb" | "edit" | "settings";
      /** 浏览/搜索关键词（点击卡片时传给 Agent 面板触发 AI 搜索） */
      query?: string;
      /** 文章后台生成中（卡片显示「生成中…」） */
      pending?: boolean;
      /** 所属会话 id（刷新后按会话恢复工具卡历史） */
      sessionId?: string;
    }[]
  >(() => {
    try {
      const r = JSON.parse(
        localStorage.getItem("kimo_ai_toolcalls_" + pageId) || "[]",
      );
      return Array.isArray(r)
        ? r
            .filter(
              (t) =>
                typeof t?.msgIdx === "number" &&
                typeof t?.type === "string" &&
                !t.pending,
            )
            // 兼容旧数据：网络搜索/浏览网页 → Search/View（历史卡片名也统一大写）
            .map((t) => ({
              ...t,
              type:
                t.type === "search" || t.type === "网络搜索"
                  ? "Search"
                  : t.type === "view" || t.type === "浏览网页"
                    ? "View"
                    : t.type,
            }))
        : [];
    } catch {
      return [];
    }
  });
  // 工具卡持久化（刷新后保留历史；不含生成中 pending）
  useEffect(() => {
    try {
      localStorage.setItem(
        "kimo_ai_toolcalls_" + pageId,
        JSON.stringify(toolCalls.filter((t) => !t.pending)),
      );
    } catch {}
  }, [toolCalls, pageId]);
  // 卡片点击后强制重新触发浏览（避免同关键词二次点击不生效）
  const [agentSearchNonce, setAgentSearchNonce] = useState(0);
  const [dailyUsed, setDailyUsed] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      return Number(
        localStorage.getItem(
          STORAGE_PREFIX + "daily_" + pageId + "_" + today,
        ) || 0,
      );
    } catch {
      return 0;
    }
  });
  const [memory, setMemory] = useState(() => loadMemory(pageId));
  // 自动朗读：优先用户浏览器偏好（kimo_ai_tts），默认关；用户关闭则进入页面即为关
  const [ttsOn, setTtsOn] = useState(() => loadTtsPref(config.autoTTS).on);
  const toggleTts = useCallback(() => {
    setTtsOn((prev) => {
      const n = !prev;
      saveTtsPref(n);
      return n;
    });
  }, []);
  const customApiEnabled = enableCustomApi !== false;
  const [consented, setConsented] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + "consent_" + pageId) === "1";
    } catch {
      return false;
    }
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgListRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const agentPanelRef = useRef<HTMLDivElement>(null);
  /** 「/」按钮 ref：知识库弹窗锚定在其上方 */
  const kbAnchorRef = useRef<HTMLButtonElement>(null);
  const active = sessions.find((s) => s.id === activeId) || sessions[0];
  const messages = active?.messages || [];

  // Agent 面板宽度拖拽：拖拽期间直接改 DOM 宽度（不触发 React 重渲染），松手才提交 state
  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = agentPanelRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.offsetWidth;
    const prevTransition = el.style.transition;
    el.style.transition = "none";
    const onMove = (ev: MouseEvent) => {
      const d = startX - ev.clientX;
      // 上限 = 视口 - 360（给聊天区留至少 360px），避免拖宽后面板/画布溢出屏幕
      const w = Math.min(
        Math.round(window.innerWidth - 360),
        Math.max(300, startW + d),
      );
      el.style.width = w + "px";
    };
    const onUp = () => {
      el.style.transition = prevTransition;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 安全宽度：拖拽结束时若面板被异常拖塌/拖出范围，钳回合法区间（防 canvas/角色塌陷）
      const w = el.offsetWidth;
      const safe = Math.max(
        300,
        Math.min(
          window.innerWidth - 360,
          Number.isFinite(w) && w > 0 ? w : 380,
        ),
      );
      setAgentWidth(safe);
      try {
        localStorage.setItem("kimo_ai_agent_width", String(safe));
      } catch {}
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // 人设选择（多套人设由 BotEditorModal 配置；选中后覆盖默认 systemPrompt）
  const [activePromptIdx, setActivePromptIdx] = useState<number | null>(null);
  const allPrompts = (config.prompts || []).filter(
    (p: { systemPrompt: string }) => p.systemPrompt.trim(),
  );

  // 有效配置：本地自定义 API/提示词 > 选中人设 > 机器人默认（非管理员各自本地设置）
  const effCfg: AIChatConfig = mergeEffCfg(config, localCfg, activePromptIdx);
  const hasCustom = hasLocalApi(localCfg);

  // Live2D auto 模式：让 AI 根据人设/记忆/人格笔记/知识库选一个最契合的角色
  // 挂载时（auto 已开）与收到 requestAutoPick 时各选一次；缓存 saveAutoPick，避免反复换角
  const autoPickBusyRef = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (!l2dEnabled || loadLive2dModel() !== LIVE2D_MODEL_AUTO) return;
      if (autoPickBusyRef.current) return;
      autoPickBusyRef.current = true;
      // 延迟等知识库异步加载完成后再选角
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const model = await pickLive2dCharacter(
          {
            persona: effCfg.systemPrompt || "",
            botName: effCfg.botName || "",
            memory: memory || "",
            personaKnowledge: personaKnowledge || "",
            knowledge: kbText || "",
          },
          LIVE2D_CHARACTERS,
        );
        if (model && getState().modelName !== model) {
          saveAutoPick(model);
          loadModel(model).catch(() => {});
        }
      } catch {
        /* AI 选角失败则保持当前（随机兜底）角色 */
      }
      autoPickBusyRef.current = false;
    };
    run();
    const unsub = onAutoPickRequest(run);
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l2dEnabled, effCfg.systemPrompt, effCfg.botName]);

  const dailyLimit = effCfg.dailyLimit || config.dailyLimit || 0;
  const dailyRemaining =
    dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : -1;

  // 性能优化：流式期间每条 chunk 都会更新会话 → localStorage 写入改防抖（300ms 合并），
  // 避免同步 setItem 高频执行阻塞主线程；卸载时兜底 flush 最新状态
  const sessionsRef = useRef<Session[]>(sessions);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const flushSessions = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    try {
      localStorage.setItem(
        SESSION_STORAGE(pageId),
        JSON.stringify(sessionsRef.current),
      );
    } catch {}
  }, [pageId]);
  const persistSessions = useCallback(
    (next: Session[]) => {
      // 立即更新 ref（保证 flush/卸载读到最新），写入延迟合并
      sessionsRef.current = next;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(flushSessions, 300);
    },
    [flushSessions],
  );
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      try {
        localStorage.setItem(
          SESSION_STORAGE(pageId),
          JSON.stringify(sessionsRef.current),
        );
      } catch {}
    };
  }, [pageId]);

  const saveSessions = useCallback(
    (next: Session[]) => {
      setSessions(next);
      persistSessions(next);
    },
    [persistSessions],
  );

  // 更新当前会话消息：用函数式 setState 避免异步流式回调里的旧闭包导致消息丢失
  const updateActive = useCallback(
    (mut: (msgs: Message[]) => Message[]) => {
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeId) return s;
          const msgs = mut(s.messages);
          // 首次对话自动根据用户消息设置标题
          const title =
            s.title === "新对话" && msgs.length && msgs[0].role === "user"
              ? msgs[0].content.slice(0, 20)
              : s.title;
          return { ...s, messages: msgs, title };
        });
        persistSessions(next);
        return next;
      });
    },
    [activeId, persistSessions],
  );

  const newSession = useCallback(() => {
    const s: Session = {
      id: uid(),
      title: "新对话",
      messages: [],
      createdAt: Date.now(),
    };
    saveSessions([s, ...sessions]);
    setActiveId(s.id);
    setStick(true);
    setSidebarOpen(false);
    setLimitReached(false);
    // 新建会话：清空上一会话遗留的工具卡/内嵌浏览等临时状态
    setToolCalls([]);
    setAgentKbOpen(undefined);
    setAgentEditContent(undefined);
    setAgentInitUrl(undefined);
    setAgentSearchNonce((n) => n + 1);
    setKbPickerOpen(false);
  }, [sessions, saveSessions]);

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
    setStick(true);
    setSidebarOpen(false);
  }, []);

  const deleteSession = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const rest = sessions.filter((s) => s.id !== id);
      saveSessions(
        rest.length
          ? rest
          : [
              {
                id: uid(),
                title: "新对话",
                messages: [],
                createdAt: Date.now(),
              },
            ],
      );
      if (id === activeId) setActiveId((rest[0] || sessions[0]).id);
    },
    [sessions, activeId, saveSessions],
  );

  // 手机键盘
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onFocus = () => {
      setStick(true);
      setTimeout(autoScroll, 300);
    };
    el.addEventListener("focus", onFocus);
    return () => el.removeEventListener("focus", onFocus);
  });

  useEffect(() => {
    if (activeId && !sessions.find((s) => s.id === activeId))
      setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  const isNearBottom = () => {
    const el = msgListRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const autoScroll = useCallback(() => {
    if (isNearBottom()) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);
  const onScroll = useCallback(() => {
    if (!isNearBottom()) setStick(false);
  }, []);
  useEffect(() => {
    if (stick) autoScroll();
  }, [messages, stick, autoScroll]);

  useEffect(() => {
    if (cooldown <= 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      try {
        localStorage.removeItem(STORAGE_PREFIX + "cooldown_" + pageId);
      } catch {}
      return;
    }
    timerRef.current = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cooldown, pageId]);

  const playTTS = useCallback(
    (text: string, idx: number) => {
      if (speakingIdx === idx) {
        window.speechSynthesis.cancel();
        setSpeakingIdx(-1);
        return;
      }
      setSpeakingIdx(idx);
      const clean = text.replace(/[*_`#~>\[\]\(\)]/g, "").slice(0, 600);
      speak(clean);
      const check = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          setSpeakingIdx(-1);
          clearInterval(check);
        }
      }, 300);
    },
    [speakingIdx],
  );

  // 知识库：根据选择 + 本地笔记组装文本（KbModal 保存后调用 refreshKb 刷新缓存）
  const refreshKb = useCallback(async () => {
    try {
      const sel = getKbSelections(pageId);
      const notes = getKbNotes();
      const text = await assembleKnowledge(sel, notes);
      setKbText(text);
    } catch {
      setKbText("");
    }
  }, [pageId]);

  // 知识库默认启用，初始加载时刷新
  useEffect(() => {
    refreshKb();
  }, [refreshKb]);

  // 会话重命名
  const startRename = useCallback((e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    setEditingSessionId(s.id);
    setEditTitle(s.title);
  }, []);
  const commitRename = useCallback(() => {
    if (editingSessionId) {
      saveSessions(
        sessions.map((x) =>
          x.id === editingSessionId
            ? { ...x, title: editTitle.trim() || "新对话" }
            : x,
        ),
      );
    }
    setEditingSessionId(null);
  }, [editingSessionId, editTitle, sessions, saveSessions]);

  const learn = useCallback(
    (q: string, a: string) => {
      // 自动压缩记忆（合并同主题 + 限制条数/长度），防止 token 滥用
      const next = compressMemory(memory, q, a);
      setMemory(next);
      saveMemory(pageId, next);
    },
    [memory, pageId],
  );

  // Markdown 文件上传解析
  const onUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedFile(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (inputRef.current) {
        setInput((prev) => (prev ? prev + "\n\n" : "") + text);
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const send = async (overrideText?: string) => {
    const t = (overrideText ?? input).trim();
    if (!t || loading || cooldown > 0) return;

    // AI→Agent 语音触发：用户说"打开浏览器"/"搜索xxx"→自动打开 Agent 网页 tab
    const browserCmd = t.match(
      /(?:打开|浏览|用|帮我).*(?:浏览器|网页|网站|搜索)\s*(.+)?/,
    );
    const browserUrl = t.match(/(?:打开|浏览)\s*(https?:\/\/[^\s，,。]+)/);
    if (browserCmd || browserUrl) {
      const target = browserUrl?.[1] || browserCmd?.[1]?.trim();
      if (target) {
        const searchUrl = target.startsWith("http")
          ? target
          : `https://www.google.com/search?q=${encodeURIComponent(target)}`;
        setAgentInitUrl(searchUrl);
      }
      setAgentTab("web");
      setAgentEditContent(undefined);
      setAgentOpen(true);
    }

    // 默认服务端 API 有限制；用户自定义 API 时解除次数/冷却限制
    if (!hasCustom) {
      if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
        const msg: Message = {
          role: "assistant" as const,
          content: `今日额度已用完（${dailyLimit} 条/天）。可使用自定义 API 解除限制，或明天再试。`,
        };
        updateActive((prev) => [...prev, msg]);
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const newUsed = dailyUsed + 1;
      setDailyUsed(newUsed);
      try {
        localStorage.setItem(
          STORAGE_PREFIX + "daily_" + pageId + "_" + today,
          String(newUsed),
        );
      } catch {}
      const max = effCfg.maxMessages || 0;
      if (max > 0 && messages.length >= max) {
        setLimitReached(true);
        const msg: Message = {
          role: "assistant" as const,
          content: `单次对话已达上限（${max} 条）。可使用自定义 API 解除限制，或新建会话。`,
        };
        updateActive((prev) => [...prev, msg]);
        return;
      }
    }
    const user: Message = {
      role: "user" as const,
      content: t,
      attachments: kbAttachments.length ? kbAttachments : undefined,
    };
    const allMsgs = [...messages, user];
    // 知识库保存意图（AI 漏发 [KB-SAVE:] 时前端兜底，保证知识库操作可靠）
    const kbSaveIntent = detectKbSaveIntent(t);
    let summary = "";
    const recent = allMsgs.length > 6 ? allMsgs.slice(-6) : allMsgs;
    // 用户明确要求保存时，给 AI 强调务必输出 [KB-SAVE:]，并兜底指令只追加到当前用户消息
    const kbInstr = kbSaveIntent
      ? `\n\n（用户明确要求把以上内容保存到知识库。请务必输出工具指令 [KB-SAVE:简短标题]完整内容[/KB-SAVE] 来保存，标题概括主题，内容是完整要点；不要只口头答应。如果你漏发，系统会自动保存。）`
      : "";
    // 注入附件的完整内容给 AI（显示层只展示卡片，不显示大段文字；每条截断防 token 膨胀）
    const injectAttachments = (msgs: Message[]) =>
      msgs.map((m, idx) => {
        const suffix = idx === msgs.length - 1 ? kbInstr : "";
        return m.role === "user" && m.attachments?.length
          ? {
              role: m.role,
              content:
                m.content +
                (m.content.trim()
                  ? "\n\n【附加知识条目】\n"
                  : "【附加知识条目】\n") +
                m.attachments
                  .map((a) => "- " + a.title + "：" + clamp(a.content, 800))
                  .join("\n") +
                suffix,
            }
          : { role: m.role, content: m.content + suffix };
      });
    if (allMsgs.length > 6)
      summary = clamp(
        allMsgs
          .slice(0, allMsgs.length - 6)
          .map(
            (m, i) =>
              `${m.role === "user" ? "问" : "答"}${i + 1}: ${m.content.slice(0, 60)}`,
          )
          .join("; "),
        1500,
      );
    updateActive((prev) => [...prev, user]);
    setInput("");
    setKbAttachments([]);
    setLoading(true);
    // Live2D 预判：先按用户消息情绪做出反应（听到你开心/难过就相应表情）；中性时随机回应小动作（更灵动）
    if (l2dEnabled) {
      const reacted = detectEmotion(t);
      if (reacted === "neutral") {
        const responses: Emotion[] = ["thinking", "thinking", "wink", "shy"];
        applyL2dEmotion(
          responses[Math.floor(Math.random() * responses.length)],
        );
      } else {
        applyL2dEmotion(reacted);
      }
    }
    setStick(true);
    if (!hasCustom) {
      setCooldown(effCfg.cooldown || 60);
      try {
        localStorage.setItem(
          STORAGE_PREFIX + "cooldown_" + pageId,
          String(Date.now() + (effCfg.cooldown || 60) * 1000),
        );
      } catch {}
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let reply = "";
    // 网络搜索：开启时先抓取结果注入上下文（带加载动画）
    let web = "";
    if (webSearchOn) {
      setSearching(true);
      try {
        web = await webSearch(t);
      } catch {
        web = "";
      } finally {
        setSearching(false);
      }
    }
    // 浏览器浏览：消息里含 http(s) URL 时自动抓取正文注入上下文
    const urlMatch = t.match(/https?:\/\/[^\s，,。]+/);
    if (urlMatch) {
      setSearching(true);
      try {
        const pageText = await fetchWebpage(urlMatch[0]);
        if (pageText) web = "网页 " + urlMatch[0] + " 的内容：\n" + pageText;
      } catch {
      } finally {
        setSearching(false);
      }
    }
    // 流式：始终只保留一条正在增长的 assistant 消息（替换上一条）
    const upsertAssistant = (content: string) =>
      updateActive((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant"
          ? [...prev.slice(0, -1), { role: "assistant" as const, content }]
          : [...prev, { role: "assistant" as const, content }];
      });
    // 每次发送时实时读取知识库（尊重 AI读取开关 + 附件；供主回复与 auto 重答共用）
    const kbKnowledge = (() => {
      try {
        const aiReadAll = localStorage.getItem("kimo_kb_ai_read_all") !== "0";
        const notes = aiReadAll ? getKbNotes() : [];
        const attachNotes = kbAttachments.map(
          (a: { title: string; content: string }) => ({
            title: a.title,
            content: a.content,
          }),
        );
        const all = aiReadAll ? [...attachNotes, ...notes] : attachNotes;
        const unique = new Map<string, { title: string; content: string }>();
        for (const n of all) {
          if (n.content && !unique.has(n.content)) unique.set(n.content, n);
        }
        const valid = [...unique.values()];
        if (valid.length)
          return (
            "【知识库条目】\n" +
            valid
              .map((n) => "- " + n.title + "：" + clamp(n.content, 600))
              .join("\n")
              .slice(0, 6000)
          );
      } catch {}
      return "";
    })();
    // 每次发送时实时读取当前 View 文章，让 AI 能读取面板里的内容（对话续优化）
    const viewArticle = (() => {
      if (!viewTopic) return "";
      try {
        const e = readSearchCache(viewTopic);
        return e?.article ? clamp(e.article, 5000) : "";
      } catch {
        return "";
      }
    })();
    try {
      const result = await streamChat(
        effCfg,
        injectAttachments(recent),
        upsertAssistant,
        ctrl.signal,
        summary,
        kbKnowledge || kbText,
        memory,
        web,
        autoMode || webSearchOn,
        browseAgentOn,
        viewArticle,
        autoKnowledge ? personaKnowledge : "",
        autoMode,
      );
      reply = result.content;
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      reply = `错误：${e instanceof Error ? e.message : "请求失败"}`;
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setLoading(false);
    }
    // Live2D 化身：AI 控制表情（[表情:xxx] 标签优先；无标签则按回复的表演提示推断）
    // 标签一律从显示文本剥离（含方括号/中文括号），Live2D 关闭时也隐藏，避免露出明文
    const tagEmotion = l2dEnabled ? parseEmotionTag(reply) : null;
    const cleanReply = stripEmotionTag(reply);
    if (l2dEnabled) {
      applyL2dEmotion(tagEmotion || detectReplyEmotion(cleanReply));
    }
    reply = cleanReply;
    upsertAssistant(reply);

    // AI→Agent 工具调用：解析 [BROWSE:url] / [SEARCH:query] / [EDIT:content] / [VIEW:文章] / [KB:指令]
    const browseCmd = reply.match(/\[BROWSE:\s*(https?:\/\/[^\s\]]+)\s*\]/);
    const searchCmd = reply.match(/\[SEARCH:\s*([^\]]+)\s*\]/);
    // EDIT 内容可能较长且 AI 偶尔不写闭合 ]，兼容未闭合到末尾的情况
    const editClosed = reply.match(/\[EDIT:\s*([\s\S]*?)\s*\]/);
    const editOpen =
      !editClosed && reply.includes("[EDIT:")
        ? reply.match(/\[EDIT:\s*([\s\S]*)/)
        : null;
    const editCmd = editClosed || editOpen;
    // VIEW 更新：AI 基于当前浏览文章输出优化后的完整文章
    const viewClosed = reply.match(/\[VIEW:\s*([\s\S]*?)\s*\]/);
    const viewOpen =
      !viewClosed && reply.includes("[VIEW:")
        ? reply.match(/\[VIEW:\s*([\s\S]*)/)
        : null;
    const viewCmd = viewClosed || viewOpen;
    const kbCmd = reply.match(/\[(?:KB|OPEN_KB|知识库)(?::\s*([^\]]+))?\]/);
    const kbSaveCmd = parseKbTool(reply);
    // 工具卡/内嵌浏览挂到 AI 消息底部（messages 是发送前的快照：用户消息在 messages.length，AI 回复在 +1）
    const msgIdx = messages.length + 1;
    // 电脑端工具触发后自动打开 Agent 面板；手机端仅展示小卡片，用户点击卡片才打开
    const autoOpenAgent = () => {
      if (window.innerWidth >= 1024) setAgentOpen(true);
    };
    // 浏览 Agent 接管：让对话回复自然——AI 已给简短回复则保留；长篇则取其开头自然引语
    const setBrowseNote = (q: string) => {
      updateActive((prev) => {
        let lastAsstIdx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant") {
            lastAsstIdx = i;
            break;
          }
        }
        if (lastAsstIdx < 0) return prev;
        const c = (prev[lastAsstIdx].content || "").trim();
        // 已给出简短自然的回复（≤200 字，如“好的，我去搜一下”）→ 保留，不替换
        if (c.length <= 200) return prev;
        // 长篇全问答 → 取其第一句自然引语作为简短回复，其余交给浏览文章
        const firstLine =
          c
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s && !/^[#>-]/.test(s))[0] || "";
        let short = "";
        if (firstLine) {
          const sent = firstLine.slice(0, 100);
          if (sent.length >= 6) short = sent;
        }
        if (!short)
          short = `好的，已为你联网搜索「${q}」，正在生成综合文章，结果请看浏览面板。`;
        return prev.map((m, i) =>
          i === lastAsstIdx ? { ...m, content: short } : m,
        );
      });
    };
    // 统一浏览触发：桌面自动弹面板、手机仅出卡片；后台生成文章（写缓存）供点卡片即看
    const triggerBrowse = (
      q: string,
      label: string,
      opts?: { keepReply?: boolean },
    ) => {
      setAgentTab("web");
      setAgentInitUrl(q);
      autoOpenAgent();
      if (!opts?.keepReply) setBrowseNote(q.slice(0, 60));
      setToolCalls((prev) => [
        ...prev,
        {
          msgIdx,
          type: label,
          detail: q.slice(0, 60),
          tab: "web",
          query: q,
          pending: true,
          sessionId: activeId,
        },
      ]);
      searchWithCache(q, { maxSources: 5, perSourceChars: 2200 })
        .then((r) => {
          // 生成成功：记录当前 View 文章话题，供 AI 读取 / 对话续优化
          if (r && r.article) changeViewTopic(q);
          return null;
        })
        .catch(() => null)
        .then(() => {
          setToolCalls((prev) =>
            prev.map((tc) => (tc.query === q ? { ...tc, pending: false } : tc)),
          );
        });
    };
    // AUTO 模式：AI 发出 [SEARCH:q] → 联网搜索后用结果重新回答，给出准确答案
    const autoSearchAndReanswer = async (sq: string): Promise<string> => {
      let newReply = reply;
      setSearching(true);
      try {
        const webBlock = await webSearchWithContent(sq, 4, 1800);
        if (webBlock) {
          const result = await streamChat(
            effCfg,
            injectAttachments(recent),
            upsertAssistant,
            ctrl.signal,
            summary,
            kbKnowledge || kbText,
            memory,
            webBlock,
            true,
            false,
            viewArticle,
            autoKnowledge ? personaKnowledge : "",
            autoMode,
          );
          newReply = result.content;
          upsertAssistant(newReply);
        }
      } catch {
        /* 重答失败：保留原回复 */
      } finally {
        setSearching(false);
      }
      return newReply;
    };

    if (viewCmd) {
      const vc = (viewCmd[1] || "").trim();
      // 判断是「更新当前浏览文章」（有浏览文章且内容为完整长文）还是「请求生成新文章」（auto 模式给关键词）
      const looksLikeArticle = vc.length > 80 || vc.includes("\n\n");
      if (viewTopic && looksLikeArticle) {
        // AI 基于当前浏览文章输出优化后的完整文章 → 更新 View 面板（写缓存 + 重触发浏览）
        if (vc) {
          writeSearchCache(viewTopic, { article: vc });
          setAgentTab("web");
          setAgentInitUrl(viewTopic);
          setAgentEditContent(undefined);
          setAgentSearchNonce((n) => n + 1);
          autoOpenAgent();
          setToolCalls((prev) => [
            ...prev,
            {
              msgIdx,
              type: "优化文章",
              detail: viewTopic.slice(0, 60),
              tab: "web",
              query: viewTopic,
              sessionId: activeId,
            },
          ]);
        }
      } else if (autoMode && vc) {
        // AUTO：AI 判断问题值得生成综合文章 → 用关键词生成到 View 面板
        const sq = vc.slice(0, 60);
        if (sq) triggerBrowse(sq, "View");
      }
    } else if (kbSaveCmd) {
      const entry = saveKbEntry(kbSaveCmd.title, kbSaveCmd.content);
      setAgentKbOpen({ nonce: Date.now(), entry });
      setAgentTab("edit");
      setAgentInitUrl(undefined);
      setAgentEditContent(kbSaveCmd.content);
      autoOpenAgent();
      setToolCalls((prev) => [
        ...prev,
        {
          msgIdx,
          type: kbSaveCmd.mode === "edit" ? "编辑知识库" : "保存知识库",
          detail: kbSaveCmd.title.slice(0, 60),
          tab: "edit",
          sessionId: activeId,
        },
      ]);
    } else if (kbSaveIntent) {
      // AI 漏发 [KB-SAVE:] 但用户明确要求保存 → 前端兜底直接保存，并让 AI 回复补充确认
      const entry = saveKbEntry(kbSaveIntent.title, kbSaveIntent.content);
      setAgentKbOpen({ nonce: Date.now(), entry });
      setAgentTab("edit");
      setAgentInitUrl(undefined);
      setAgentEditContent(kbSaveIntent.content);
      autoOpenAgent();
      setToolCalls((prev) => [
        ...prev,
        {
          msgIdx,
          type: "保存知识库",
          detail: kbSaveIntent.title.slice(0, 60),
          tab: "edit",
          sessionId: activeId,
        },
      ]);
      // 在 AI 回复末尾补一句已保存确认（用户能明确知道存进去了）
      const confirm = `\n\n（已自动保存到知识库「${kbSaveIntent.title}」，可在 Agent 面板「知识库」查看）`;
      updateActive((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant") {
            return prev.map((m, j) =>
              j === i ? { ...m, content: m.content + confirm } : m,
            );
          }
        }
        return prev;
      });
      reply += confirm;
    } else if (browseCmd) {
      setAgentEditContent(undefined);
      triggerBrowse(browseCmd[1], "View", { keepReply: true });
    } else if (searchCmd) {
      const sq = searchCmd[1].trim();
      if (browseAgentOn) {
        // View 模式开启时自动生成文章：桌面自动开面板，手机只出卡片（生成中→可点）
        if (sq) triggerBrowse(sq, "Search");
      } else if (autoMode && sq) {
        // AUTO：AI 认为缺少数据 → 联网搜索重答（给出准确答案）+ 搜索卡片
        reply = await autoSearchAndReanswer(sq);
        setToolCalls((prev) => [
          ...prev,
          {
            msgIdx,
            type: "Search",
            detail: sq.slice(0, 60),
            tab: "web",
            query: sq,
            sessionId: activeId,
          },
        ]);
      }
      setAgentEditContent(undefined);
    } else if (editCmd) {
      setAgentTab("edit");
      setAgentInitUrl(undefined);
      setAgentEditContent(editCmd[1].trim());
      autoOpenAgent();
      setToolCalls((prev) => [
        ...prev,
        {
          msgIdx,
          type: "编辑文档",
          detail: editCmd[1].trim().slice(0, 60),
          tab: "edit",
          sessionId: activeId,
        },
      ]);
    } else if (kbCmd) {
      setAgentTab("kb");
      setAgentInitUrl(undefined);
      setAgentEditContent(undefined);
      autoOpenAgent();
      setToolCalls((prev) => [
        ...prev,
        {
          msgIdx,
          type: "打开知识库",
          detail: (kbCmd[1] || "查看/整理知识库条目").slice(0, 60),
          tab: "kb",
          sessionId: activeId,
        },
      ]);
    }
    // 显式搜索兜底：View 模式开启时无需再说「搜索」，任何提问都自动生成文章
    // （除非 AI 已发工具指令或给出代码块）；桌面自动开面板、手机只出卡片
    if (
      browseAgentOn &&
      !viewCmd &&
      !kbSaveCmd &&
      !kbSaveIntent &&
      !browseCmd &&
      !searchCmd &&
      !editCmd &&
      !kbCmd
    ) {
      const isCode = /```/.test(reply) || /```[a-zA-Z]*\n/.test(reply);
      if (!isCode) {
        // 用 AI 从对话上下文提炼搜索关键词，避免把闲聊/追问当关键词（如"没有图片啊"）
        const derived = await deriveSearchKeyword(effCfg, allMsgs);
        const q = (derived || t.trim()).slice(0, 60);
        if (q) {
          setAgentSearchNonce((n) => n + 1);
          triggerBrowse(q, "Search");
        }
      }
    }
    // 网络资料不再以卡片展示（浏览结果由 View 自动呈现），避免刷屏

    if (!reply.startsWith("错误")) learn(t, reply);
    // auto-knowledge：对话完成后后台自动学习人格笔记 + 联网补充（不阻塞发送）
    if (
      autoKnowledge &&
      !reply.startsWith("错误") &&
      !personaRunningRef.current
    ) {
      personaRunningRef.current = true;
      const pkSnapshot = personaKnowledge;
      const msgsSnapshot = allMsgs;
      const cfgSnapshot = effCfg;
      derivePersonaKnowledge(cfgSnapshot, msgsSnapshot, pkSnapshot)
        .then(({ note, keyword }) => {
          if (note) {
            setPersonaKnowledge((prev) => {
              const lines = prev
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
              if (lines.some((l) => l.slice(0, 12) === note.slice(0, 12)))
                return prev;
              const next = [...lines, "- " + note].slice(-12).join("\n");
              savePersonaKnowledge(pageId, next);
              return next;
            });
          }
          // 值得补充的话题：后台自动搜索，完成后记入人格笔记（供后续 AI 读取）
          if (keyword) {
            searchWithCache(keyword, {
              maxSources: 3,
              perSourceChars: 1500,
            })
              .then((r) => {
                if (r && r.article) {
                  setPersonaKnowledge((prev) => {
                    const lines = prev
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean);
                    if (lines.some((l) => l.includes(keyword))) return prev;
                    const next = [...lines, `- 资料：${keyword}（已自动补充）`]
                      .slice(-12)
                      .join("\n");
                    savePersonaKnowledge(pageId, next);
                    return next;
                  });
                }
              })
              .catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => {
          personaRunningRef.current = false;
        });
    }
    if (ttsOn)
      setTimeout(
        () => speak(reply.replace(/[*_`#~>\[\]\(\)]/g, "").slice(0, 600)),
        500,
      );
  };

  // 导出全部会话（JSON，可再导入）
  // useCallback + 读取 sessionsRef：保证引用稳定（配合 AgentPanel memo），且导出时始终拿到最新会话
  const exportAllSessions = useCallback(() => {
    const data = {
      app: "kimo-ai",
      version: 1,
      bot: config.botName,
      exportedAt: new Date().toISOString(),
      sessions: sessionsRef.current,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kimo-ai-${(config.botName || "chat").replace(/[\s\\/]/g, "-")}-sessions.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [config.botName]);

  // 导入全部会话（JSON，合并到当前列表）
  const onImportAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ""));
        const arr = Array.isArray(data.sessions)
          ? data.sessions
          : Array.isArray(data)
            ? data
            : [];
        const clean: Session[] = arr
          .filter((s: Session) => s && Array.isArray(s.messages))
          .map((s: Session) => ({
            id: uid(),
            title: s.title || "新对话",
            messages: s.messages,
            createdAt: s.createdAt || Date.now(),
          }));
        if (!clean.length) {
          alert("导入失败：文件中没有有效会话");
          return;
        }
        if (
          !window.confirm(`导入 ${clean.length} 个会话？将合并到当前会话列表。`)
        )
          return;
        saveSessions([...clean, ...sessions]);
        setActiveId(clean[0].id);
        setStick(true);
      } catch {
        alert("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
    if (importRef.current) importRef.current.value = "";
  };

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  // 性能优化：lastAssistantContent 只在回复完成后（loading→false）提交，
  // 流式期间保持上一次稳定值，让 memo(AgentPanel) 不随每条 stream chunk 重渲染
  const lastAssistantRef = useRef<string | undefined>(undefined);
  lastAssistantRef.current = lastAssistant?.content;
  const [settledAssistant, setSettledAssistant] = useState<string | undefined>(
    undefined,
  );
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      setSettledAssistant(lastAssistantRef.current);
    }
    wasLoadingRef.current = loading;
  }, [loading]);

  // AgentPanel 稳定回调（配合 memo）：桌面/移动双实例共用，避免每次父组件重渲染重建引用
  const closeAgentPanel = useCallback(() => {
    refreshKb();
    setAgentOpen(false);
  }, [refreshKb]);
  const consumeKbOpen = useCallback(() => setAgentKbOpen(undefined), []);
  const onCustomSaved = useCallback(() => {
    setLocalCfg(getLocalCfg(pageId));
  }, [pageId]);

  // Agent 面板「设置」tab 数据（desktop/mobile 双渲染共用一份；useMemo 稳定引用配合 AgentPanel memo）
  const settingsData: AgentSettingsProps = useMemo(
    () => ({
      pageId,
      canManage: !!canManage,
      hasCustom,
      botName: config.botName || "AI",
      ttsOn,
      onToggleTts: toggleTts,
      netMode,
      onSetNetMode: changeNetMode,
      autoKnowledge,
      onToggleAutoKnowledge: toggleAutoKnowledge,
      kbAiReadAll,
      onToggleKbAiReadAll: (v) => {
        setKbAiReadAll(v);
        localStorage.setItem("kimo_kb_ai_read_all", v ? "1" : "0");
        refreshKb();
      },
      onExportAll: exportAllSessions,
      onImport: () => importRef.current?.click(),
      chatFontSize,
      onSetFontSize: (v) => {
        setChatFontSize(v);
        saveChatFontSize(v);
      },
      onCustomSaved,
      allowCustomApi: customApiEnabled,
    }),
    [
      pageId,
      canManage,
      hasCustom,
      config.botName,
      ttsOn,
      toggleTts,
      netMode,
      changeNetMode,
      autoKnowledge,
      toggleAutoKnowledge,
      kbAiReadAll,
      refreshKb,
      exportAllSessions,
      chatFontSize,
      onCustomSaved,
      customApiEnabled,
    ],
  );

  if (!consented) {
    return (
      // 手机适配：h-full 占满父容器 + 外层滚动；子元素 m-auto —— 内容少居中、内容多可从顶滚到底部（同意按钮可滚动到）
      <div className="flex h-full w-full overflow-y-auto bg-gray-50 px-4 py-8 dark:bg-gray-950">
        {/* 入场动画（平滑上滑 + 淡入） */}
        <div className="m-auto w-full max-w-xl animate-[kslideUp_0.35s_ease-out] overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
          {/* 顶部：纯文字欢迎（无彩色图标） */}
          <div className="bg-gradient-to-b from-gray-50 to-transparent px-6 pb-6 pt-8 text-center dark:from-gray-800/40">
            <h3 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              {config.botName || "AI 助手"}
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              开始使用前，请阅读并同意以下须知
            </p>
          </div>

          {/* 须知卡片区（Kimo 风格：圆角卡片 + 左侧灰条标题） */}
          <div className="space-y-2.5 px-5 pb-6 sm:px-7">
            <section className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-gray-800 dark:bg-gray-800/40">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                <span className="h-3 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                数据与隐私
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                <li>
                  对话记录、角色设定、自定义 API
                  均保存在您的本机浏览器，不会上传服务器。
                </li>
                <li>
                  API 密钥仅用于在本机调用模型接口，网站不存储、不读取您的密钥。
                </li>
              </ul>
            </section>
            <section className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-gray-800 dark:bg-gray-800/40">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                <span className="h-3 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                内容声明
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                <li>
                  AI
                  回复由第三方模型生成，仅供参考，请自行判断准确性，重要信息请核实。
                </li>
                <li>受 Token 额度限制，回复长度或频率可能受限。</li>
                <li>
                  请勿输入密码、身份证号等个人敏感信息；请勿生成违法违规内容。
                </li>
                <li>
                  AI 会以 Live2D
                  虚拟形象与你互动，表情与动作在本机实时渲染，不额外上传数据。
                </li>
                <li>
                  联网搜索 /
                  文章生成等工具会在您发起时获取公开网页信息，仅用于本次回答。
                </li>
              </ul>
            </section>
            <section className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-gray-800 dark:bg-gray-800/40">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                <span className="h-3 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />
                联系与反馈
              </p>
              <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                如有问题或建议，欢迎到{" "}
                <a
                  href="https://github.com/ChanYiCYJ/kimo-frontend/issues"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  GitHub Issues
                </a>{" "}
                反馈。
              </p>
            </section>

            <button
              onClick={() => {
                setConsented(true);
                try {
                  localStorage.setItem(
                    STORAGE_PREFIX + "consent_" + pageId,
                    "1",
                  );
                } catch {}
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <svg
                className="h-4 w-4 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              我已阅读并同意 · 开始对话
            </button>
            <Link
              to="/"
              className="block text-center text-xs text-gray-400 transition hover:text-gray-600"
            >
              返回网站首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 仅管理员可用的助手：普通访客无法访问
  if (config.adminOnly && !canManage) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <p className="text-base font-medium text-gray-700 dark:text-gray-300">
            此 AI 助手仅管理员可用
          </p>
          <p className="mt-1 text-sm text-gray-400">
            请联系管理员调整适用范围。
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (!effCfg.endpoint || !effCfg.apiKey || !effCfg.model) {
    return (
      <>
        {/* 未配置引导也要渲染 LocalApiModal，否则「在本机配置模型 API」点了弹窗打不开 */}
        <LocalApiModal
          open={apiModalOpen}
          onClose={() => setApiModalOpen(false)}
          pageId={pageId}
          botName={config.botName || "AI"}
          onSaved={() => setLocalCfg(getLocalCfg(pageId))}
        />
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">
          <p>AI 对话未配置。</p>
          {!canManage && customApiEnabled ? (
            <button
              onClick={() => setApiModalOpen(true)}
              className="mt-4 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900"
            >
              在本机配置模型 API
            </button>
          ) : (
            <p className="mt-2">请在后台「AI 管理」中配置。</p>
          )}
        </div>
      </>
    );
  }

  const iconBtn =
    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800";

  // 沉浸模式展示的 AI 最后一句（带索引，用于匹配工具卡）
  const lastAiIdx = [...messages]
    .reverse()
    .findIndex((m) => m.role === "assistant");
  const lastAi =
    lastAiIdx >= 0 ? messages[messages.length - 1 - lastAiIdx] : undefined;
  // 沉浸卡片上可点击的工具按钮（View/搜索等）：显示当前会话最近的工具指令，
  // 不限于最后一条 AI 消息——方便用户随时点击打开 View/搜索（搜索后按钮常驻可点）
  const immersiveTools = toolCalls
    .filter((tc) => tc.sessionId === activeId)
    .sort((a, b) => (b.msgIdx ?? 0) - (a.msgIdx ?? 0))
    .slice(0, 3);
  const chatBody = (
    <div
      className={
        "flex h-full min-h-0 flex-col " +
        (live2dImmersive ? "bg-transparent" : "bg-white dark:bg-gray-900")
      }
    >
      {/* 顶栏：左侧历史+机器人，右侧Agent+主题（沉浸模式保留，加毛玻璃背景；顶部安全区避让刘海） */}
      <div
        className={
          "flex shrink-0 items-center gap-1.5 border-b px-3 py-2 sm:px-4 " +
          (live2dImmersive
            ? "border-gray-200/80 bg-white/90 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur dark:border-gray-800 dark:bg-gray-900/90"
            : "border-gray-100 dark:border-gray-700")
        }
      >
        {/* 左侧：历史按钮（桌面切换侧边栏收起/展开，移动端打开抽屉） */}
        <button
          onClick={() => {
            if (window.innerWidth >= 1024)
              setSidebarCollapsed((v) => {
                const n = !v;
                try {
                  localStorage.setItem(
                    "kimo_ai_sidebar_collapsed",
                    n ? "1" : "0",
                  );
                } catch {}
                return n;
              });
            else setSidebarOpen(true);
          }}
          className={
            iconBtn +
            (sidebarCollapsed ? " text-gray-600 dark:text-gray-300" : "")
          }
          title="会话列表"
          aria-label="会话列表"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              strokeLinecap="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>

        {center ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {bots && bots.length > 1 ? (
              <div className="relative min-w-0">
                <button
                  ref={botBtnRef}
                  onClick={toggleBotMenu}
                  className="flex max-w-[170px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 active:scale-95 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  <BotAvatar
                    src={config.avatar}
                    name={config.botName || "AI"}
                  />
                  <span className="min-w-0 truncate">
                    {config.botName || "AI"}
                  </span>
                  <svg
                    className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200 ${botMenuOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                </button>
                {botMenuOpen &&
                  botMenuPos &&
                  createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[70]"
                        onClick={() => setBotMenuOpen(false)}
                      />
                      <div
                        className="fixed z-[71] w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl animate-[kpop_0.2s_ease-out] dark:border-gray-700 dark:bg-gray-900"
                        style={{ left: botMenuPos.left, top: botMenuPos.top }}
                      >
                        {bots.map((b) => (
                          <button
                            key={b.id}
                            onClick={() => {
                              onSwitchBot?.(b.id);
                              setBotMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-gray-800 ${b.id === pageId ? "font-medium text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}
                          >
                            <BotAvatar src={b.config.avatar} name={b.name} />
                            <span className="min-w-0 flex-1 truncate">
                              {b.name}
                            </span>
                            {b.id === pageId && (
                              <span className="text-xs text-gray-400">✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>,
                    document.body,
                  )}
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                {config.avatar ? (
                  <img
                    src={config.avatar}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid h-7 w-7 shrink-0 place-content-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                    {(config.botName || "AI").slice(0, 2)}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {config.botName || "AI 助手"}
                    </span>
                    {allPrompts.length > 1 && (
                      <select
                        value={activePromptIdx ?? ""}
                        onChange={(e) =>
                          setActivePromptIdx(
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      >
                        <option value="">默认</option>
                        {allPrompts.map((p, i) => (
                          <option key={i} value={i}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${loading ? "animate-pulse bg-green-400" : "bg-green-500"}`}
                    />
                  </div>
                  <p className="truncate text-[11px] text-gray-400">
                    {loading ? "回复中..." : active?.title || "新对话"}
                  </p>
                </div>
              </div>
            )}
            <div className="flex-1" />
            <button
              onClick={() => {
                if (agentOpen) refreshKb();
                setAgentOpen((v) => {
                  if (!v) {
                    setAgentTab("kb");
                    setAgentEditContent(undefined);
                    const last = messages[messages.length - 1];
                    if (last?.role === "assistant") {
                      const m = last.content.match(
                        /https?:\/\/[^\s<>"{}|\\^`\[\]]+/,
                      );
                      if (m) {
                        setAgentTab("web");
                        setAgentInitUrl(m[0]);
                      }
                    }
                  }
                  return !v;
                });
              }}
              className={`relative ${iconBtn} ${agentOpen ? "text-gray-600 dark:text-gray-300" : ""}`}
              title={agentOpen ? "关闭 Agent" : "Agent 工具箱"}
              aria-label={agentOpen ? "关闭 Agent" : "Agent 工具箱"}
            >
              {agentOpen ? (
                isMobile ? (
                  /* 手机：叉号图标 */
                  <svg
                    className="h-5 w-5 animate-[kpop_0.2s_ease-out]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  /* 电脑：右方向图标（与工具箱图标同尺寸 h-5 w-5） */
                  <svg
                    className="h-5 w-5 animate-[kpop_0.2s_ease-out]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                )
              ) : (
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21"
                  />
                </svg>
              )}
              {/* 移动端小提示：浏览/知识库/编辑器 */}
              {agentHint && (
                <span className="pointer-events-none absolute -bottom-9 right-0 z-30 whitespace-nowrap rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg animate-[kfade_0.3s_ease-out] dark:bg-gray-200 dark:text-gray-900">
                  浏览 · 知识库 · 编辑器
                  <span
                    className="absolute right-3 top-0 -translate-y-1/2 rotate-45 border-l border-t border-gray-900 bg-gray-900 dark:border-gray-200 dark:bg-gray-200"
                    style={{ width: 6, height: 6 }}
                  />
                </span>
              )}
            </button>
            {canManage && (
              <button
                onClick={onManage}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                管理
              </button>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
              title="返回首页"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                />
              </svg>
              <span className="hidden text-sm sm:block">返回</span>
            </Link>
            {config.avatar ? (
              <img
                src={config.avatar}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-7 w-7 shrink-0 place-content-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {(config.botName || "AI").slice(0, 2)}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {config.botName || "AI 助手"}
                </span>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${loading ? "animate-pulse bg-green-400" : "bg-green-500"}`}
                />
              </div>
              <p className="truncate text-[11px] text-gray-400">
                {loading ? "回复中..." : active?.title || "新对话"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 消息区：沉浸模式隐藏（角色全屏背景），正常模式显示消息列表 */}
      {!live2dImmersive && (
        <>
          {/* 消息区（铺满的多重水印暗纹网格，不随消息滚动） */}
          <div className="relative min-h-0 flex-1">
            <div className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden">
              <div className="grid h-full grid-cols-2 content-center gap-x-14 gap-y-20 px-4 opacity-20 sm:grid-cols-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className="rotate-[-16deg] whitespace-nowrap text-[10px] font-medium tracking-[0.2em] text-gray-400/60 dark:text-gray-500/40"
                  >
                    AI 生成 · {effCfg.model || "AI"} ·{" "}
                    {hasCustom ? "自定义" : "站点"}
                  </span>
                ))}
              </div>
            </div>
            <div
              ref={msgListRef}
              onScroll={onScroll}
              className="absolute inset-0 z-10 overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center pt-[12vh] text-center">
                    {config.avatar ? (
                      <img
                        src={config.avatar}
                        alt={config.botName}
                        className="mb-4 h-16 w-16 rounded-full object-cover"
                      />
                    ) : (
                      <span className="mb-4 grid h-16 w-16 place-content-center rounded-full bg-gray-100 text-2xl font-bold text-gray-400 dark:bg-gray-800">
                        AI
                      </span>
                    )}
                    <p className="text-base font-medium text-gray-700 dark:text-gray-300">
                      {config.botName || "AI 助手"}
                    </p>
                    <p className="mt-1 text-sm text-gray-400">
                      有什么可以帮你？
                    </p>
                    <div className="mt-8 flex w-full max-w-md flex-wrap justify-center gap-2">
                      {[
                        "搜索最新科技资讯并生成文章",
                        "把这段内容存入知识库",
                        "介绍一下这个网站",
                        "帮我写一段代码",
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => setInput(s)}
                          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition hover:border-gray-500 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((m, i) => (
                      <div
                        key={i}
                        className={`group flex animate-[kfade_0.3s_ease-out] gap-3 py-4 ${
                          m.role === "user" ? "justify-end" : ""
                        } sm:py-5`}
                      >
                        {m.role === "assistant" &&
                          (config.avatar ? (
                            <img
                              src={config.avatar}
                              alt=""
                              className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-content-center rounded-full bg-gray-200 text-xs font-bold text-gray-500 dark:bg-gray-800">
                              AI
                            </span>
                          ))}
                        <div
                          className={`min-w-0 ${m.role === "user" ? `max-w-[85%] rounded-2xl border border-gray-200 bg-gray-100 px-4 py-2.5 leading-relaxed text-gray-800 sm:max-w-[70%] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${fontSizeCls}` : `flex-1 leading-relaxed text-gray-800 dark:text-gray-100 ${fontSizeCls}`}`}
                        >
                          {m.role === "assistant" ? (
                            <div className="chat-md">
                              <MarkdownContent
                                content={m.content}
                                fallback={
                                  toolCalls.find(
                                    (tc) =>
                                      tc.msgIdx === i &&
                                      tc.sessionId === activeId,
                                  )
                                    ? `（${toolCalls.find((tc) => tc.msgIdx === i && tc.sessionId === activeId)!.type}：${toolCalls.find((tc) => tc.msgIdx === i && tc.sessionId === activeId)!.detail}）`
                                    : ""
                                }
                              />
                            </div>
                          ) : (
                            <>
                              {m.attachments && m.attachments.length > 0 && (
                                <div className="mb-1.5 flex flex-wrap gap-1.5">
                                  {m.attachments.map((a) => (
                                    <span
                                      key={a.id}
                                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                                      title={a.content.slice(0, 200)}
                                    >
                                      <svg
                                        className="h-3.5 w-3.5 shrink-0"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                                        />
                                      </svg>
                                      <span className="truncate">
                                        {a.title}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <span className="whitespace-pre-wrap">
                                {m.content}
                              </span>
                            </>
                          )}
                          {/* 工具调用小卡片：可点击（带箭头 + 按压反馈），不可点击则平淡 */}
                          {toolCalls.filter(
                            (tc) =>
                              tc.msgIdx === i && tc.sessionId === activeId,
                          ).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {toolCalls
                                .filter(
                                  (tc) =>
                                    tc.msgIdx === i &&
                                    tc.sessionId === activeId,
                                )
                                .map((tc, j) => {
                                  const dot: Record<string, string> = {
                                    保存知识库: "bg-emerald-500",
                                    编辑知识库: "bg-emerald-500",
                                    View: "bg-sky-500",
                                    Search: "bg-blue-500",
                                    优化文章: "bg-indigo-500",
                                    网络资料: "bg-amber-500",
                                    编辑文档: "bg-orange-500",
                                    打开知识库: "bg-teal-500",
                                  };
                                  return (
                                    <button
                                      key={j}
                                      onClick={() => {
                                        if (!tc.tab) return;
                                        const q =
                                          tc.query ||
                                          (tc.type === "Search"
                                            ? tc.detail.split(" ")[0]
                                            : undefined);
                                        setAgentTab(tc.tab);
                                        if (tc.tab === "web") {
                                          setAgentInitUrl(q);
                                          setAgentSearchNonce((n) => n + 1);
                                        }
                                        setAgentEditContent(undefined);
                                        setAgentOpen(true);
                                      }}
                                      title={
                                        tc.tab
                                          ? "点击打开 Agent 面板"
                                          : undefined
                                      }
                                      className={`group inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition ${
                                        tc.tab
                                          ? "cursor-pointer border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-600 active:scale-95 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                                          : "cursor-default border-gray-100 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-500"
                                      }`}
                                    >
                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[tc.type] || "bg-gray-400"}`}
                                      />
                                      <span className="shrink-0 font-medium">
                                        {tc.type}
                                      </span>
                                      {tc.pending ? (
                                        <span className="flex shrink-0 items-center gap-1 text-gray-400 dark:text-gray-500">
                                          <svg
                                            className="h-3 w-3 animate-spin"
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
                                              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                            />
                                          </svg>
                                          生成中…
                                        </span>
                                      ) : (
                                        <span className="truncate text-gray-400 dark:text-gray-500">
                                          {tc.detail}
                                        </span>
                                      )}
                                      {tc.tab && (
                                        <svg
                                          className="h-3 w-3 shrink-0 text-gray-300 transition group-hover:text-blue-500 dark:text-gray-600"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M9 5l7 7-7 7"
                                          />
                                        </svg>
                                      )}
                                    </button>
                                  );
                                })}
                            </div>
                          )}

                          {m.role === "assistant" && (
                            <div
                              className={`mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 ${speakingIdx === i ? "opacity-100" : ""}`}
                            >
                              <button
                                onClick={() => {
                                  navigator.clipboard
                                    .writeText(m.content)
                                    .catch(() => {});
                                }}
                                className="rounded-md p-1 text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-300"
                                title="复制回复"
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                  />
                                </svg>
                              </button>
                              <button
                                onClick={() => playTTS(m.content, i)}
                                className={`rounded-md p-1 transition ${speakingIdx === i ? "text-blue-600 dark:text-blue-400" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
                                title="朗读"
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
                                    d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                                  />
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  setAgentTab("web");
                                  setAgentInitUrl(undefined);
                                  const urls = m.content.match(
                                    /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
                                  );
                                  if (urls) setAgentInitUrl(urls[0]);
                                  setAgentEditContent(undefined);
                                  setAgentOpen(true);
                                }}
                                className="rounded-md p-1 text-gray-400 transition hover:text-blue-600 dark:hover:text-blue-400"
                                title="在 Agent 中打开"
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21"
                                  />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex gap-3 py-4 sm:py-5">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-content-center rounded-full bg-gray-200 text-xs font-bold text-gray-500 dark:bg-gray-800">
                          AI
                        </span>
                        <div className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-4 py-3 dark:bg-gray-800">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                          <span
                            className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                            style={{ animationDelay: "0.15s" }}
                          />
                          <span
                            className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                            style={{ animationDelay: "0.3s" }}
                          />
                        </div>
                      </div>
                    )}
                    {limitReached && !hasCustom && customApiEnabled && (
                      <div className="flex justify-center pt-3">
                        <button
                          onClick={() => setApiModalOpen(true)}
                          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-xs text-gray-600 transition hover:border-gray-500 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                        >
                          配置自定义 API 消除限制
                        </button>
                      </div>
                    )}
                  </>
                )}
                <div ref={bottomRef} />
              </div>
            </div>
          </div>
        </>
      )}
      {live2dImmersive && <div className="min-h-0 flex-1" />}

      {/* 输入栏：ChatGPT 风格整合，按钮统一尺寸 */}
      <div
        className={
          "shrink-0 px-3 pt-2 sm:px-6 " +
          (live2dImmersive
            ? "animate-[kslideUp_0.35s_ease-out] " +
              (inputFocused
                ? "pb-3"
                : "pb-[calc(env(safe-area-inset-bottom)+0.75rem)]")
            : "bg-white pb-3 sm:pb-4 dark:bg-gray-900")
        }
      >
        <div className="mx-auto w-full max-w-3xl">
          {/* 沉浸模式：浮空展示 AI 最后一句（Markdown + 工具按钮 + 生成中加载）；新对话时给快捷提示词 */}
          {live2dImmersive && (
            <div className="relative mb-2 animate-[kslideUp_0.3s_ease-out] rounded-2xl border border-gray-200 bg-white/85 px-3.5 py-2.5 text-sm leading-relaxed text-gray-700 backdrop-blur dark:border-gray-700 dark:bg-gray-900/85 dark:text-gray-200">
              {loading && !lastAi ? (
                /* 新对话、生成中：加载按钮 */
                <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                    <span
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: "0.15s" }}
                    />
                    <span
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                      style={{ animationDelay: "0.3s" }}
                    />
                  </span>
                  <span>正在生成…</span>
                </div>
              ) : lastAi ? (
                <div className="min-w-0">
                  {/* AI 回复：Markdown 滑动展示（超长内部滚动，无需全屏展开） */}
                  <div className="chat-md max-h-[40vh] overflow-y-auto pt-1">
                    <MarkdownContent
                      content={lastAi.content}
                      fallback={
                        immersiveTools.length
                          ? `（${immersiveTools[0].type}：${immersiveTools[0].detail}）`
                          : ""
                      }
                    />
                  </div>
                  {/* 工具按钮：View/搜索等，点击打开 Agent 面板；生成中显示加载 */}
                  {immersiveTools.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {immersiveTools.map((tc, j) => {
                        const dot: Record<string, string> = {
                          保存知识库: "bg-emerald-500",
                          编辑知识库: "bg-emerald-500",
                          View: "bg-sky-500",
                          Search: "bg-blue-500",
                          优化文章: "bg-indigo-500",
                          网络资料: "bg-amber-500",
                          编辑文档: "bg-orange-500",
                          打开知识库: "bg-teal-500",
                        };
                        return (
                          <button
                            key={j}
                            onClick={() => {
                              if (!tc.tab) return;
                              const q =
                                tc.query ||
                                (tc.type === "Search"
                                  ? tc.detail.split(" ")[0]
                                  : undefined);
                              setAgentTab(tc.tab);
                              if (tc.tab === "web") {
                                setAgentInitUrl(q);
                                setAgentSearchNonce((n) => n + 1);
                              }
                              setAgentEditContent(undefined);
                              setAgentOpen(true);
                            }}
                            title={tc.tab ? "点击打开 Agent 面板" : undefined}
                            className={`group inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition ${
                              tc.tab
                                ? "cursor-pointer border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-600 active:scale-95 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                                : "cursor-default border-gray-100 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-500"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[tc.type] || "bg-gray-400"}`}
                            />
                            <span className="shrink-0 font-medium">
                              {tc.type}
                            </span>
                            {tc.pending ? (
                              <span className="flex shrink-0 items-center gap-1 text-gray-400 dark:text-gray-500">
                                <svg
                                  className="h-3 w-3 animate-spin"
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
                                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                  />
                                </svg>
                                生成中…
                              </span>
                            ) : (
                              <span className="truncate text-gray-400 dark:text-gray-500">
                                {tc.detail}
                              </span>
                            )}
                            {tc.tab && (
                              <svg
                                className="h-3 w-3 shrink-0 text-gray-300 transition group-hover:text-blue-500 dark:text-gray-600"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* 流式生成中：加载按钮 */}
                  {loading && (
                    <div className="mt-2 flex items-center gap-2 text-gray-400 dark:text-gray-500">
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
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      <span>正在生成…</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-gray-500 dark:text-gray-400">
                    {config.botName || "AI"} 有什么可以帮你？
                  </span>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {[
                      "搜索最新科技资讯并生成文章",
                      "把这段内容存入知识库",
                      "介绍一下这个网站",
                      "帮我写一段代码",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          void send(s);
                        }}
                        className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:border-gray-500 hover:text-gray-900 active:scale-95 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-white"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 可关闭的圆角小卡片（网络模式 search/view / 附加文件 / 搜索中） */}

          {/* KB附件卡片 */}
          {kbAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {kbAttachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                >
                  {a.title.slice(0, 20)}
                  <button
                    onClick={() =>
                      setKbAttachments((prev) =>
                        prev.filter((x) => x.id !== a.id),
                      )
                    }
                    className="text-blue-400 hover:text-blue-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {(attachedFile || searching) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {searching && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
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
                  正在搜索…
                </span>
              )}
              {attachedFile && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  文件：{attachedFile}
                  <button
                    onClick={() => setAttachedFile("")}
                    className="text-gray-400 transition hover:text-gray-600"
                    aria-label="移除文件"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-0.5 rounded-2xl border border-gray-200 bg-white p-1.5 transition hover:border-gray-300 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 dark:border-gray-700 dark:bg-gray-800/70 dark:hover:border-gray-600 dark:focus-within:ring-gray-700/40">
            {/* / 按钮：知识库弹窗（锚定弹窗位置） */}
            <div className="relative">
              <button
                ref={kbAnchorRef}
                onClick={() => {
                  setKbPickerOpen(!kbPickerOpen);
                  setKbPickerSelected([]);
                }}
                className={
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 " +
                  (kbPickerOpen
                    ? "bg-gray-100 text-gray-600 dark:bg-gray-800"
                    : "")
                }
                title="知识库条目"
                aria-label="知识库条目"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M14.5 4l-5 16" />
                </svg>
              </button>
              {kbPickerOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    style={{ bottom: "80px" }}
                    onClick={() => setKbPickerOpen(false)}
                  />
                  <KbPicker
                    selected={kbPickerSelected}
                    onToggle={onKbPickerToggle}
                    onInsert={onKbPickerInsert}
                    mode={netMode}
                    onModeChange={changeNetMode}
                    anchorRef={kbAnchorRef}
                    live2dOn={live2dOn}
                    onToggleLive2d={toggleLive2d}
                  />
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={onUpload}
              className="hidden"
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`向 ${config.botName || "AI"} 发送消息...`}
              disabled={loading}
              rows={1}
              style={{ resize: "none" }}
              className="no-scrollbar max-h-40 min-h-[38px] flex-1 self-center bg-transparent px-1.5 py-2 text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 disabled:opacity-50 sm:text-[15px] dark:text-gray-100"
            />
            <button
              onClick={() => {
                void send();
              }}
              disabled={loading || !input.trim() || cooldown > 0}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            >
              {cooldown > 0 ? (
                <span className="text-xs font-medium">{cooldown}</span>
              ) : (
                <svg
                  className="h-4 w-4 translate-x-px"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-400/70 dark:text-gray-500/70">
            Shift+Enter 换行 · AI 生成内容仅供参考
          </p>
        </div>
      </div>
    </div>
  );

  const sidebar = (
    <div className="flex h-full w-64 flex-col bg-gray-100 dark:bg-gray-950">
      {/* 顶部：新建会话（圆角卡片） */}
      <div className="p-2.5 pb-1.5">
        <button
          onClick={newSession}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200/70 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-800"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          新建会话
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => selectSession(s.id)}
            className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${s.id === activeId ? "border-gray-300/70 bg-gray-200/70 text-gray-900 dark:border-gray-600/70 dark:bg-gray-800 dark:text-gray-100" : "border-gray-200/70 bg-white/60 text-gray-600 hover:border-gray-300 hover:bg-white dark:border-gray-700/70 dark:bg-gray-900/60 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-900"}`}
          >
            {s.id === editingSessionId ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingSessionId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
            )}
            {s.id !== editingSessionId && (
              <button
                onClick={(e) => startRename(e, s)}
                className="hidden shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-700 group-hover:flex max-sm:flex dark:hover:bg-gray-600/60 dark:hover:text-gray-200"
                title="重命名"
                aria-label="重命名"
              >
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
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                  />
                </svg>
              </button>
            )}
            <button
              onClick={(e) => deleteSession(e, s.id)}
              className="hidden shrink-0 rounded-md p-1.5 text-gray-400 transition hover:bg-red-100 hover:text-red-500 group-hover:flex max-sm:flex dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title="删除"
              aria-label="删除"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {/* 底部：内嵌圆角卡片（额度 + 主题 + 站点名） */}
      <div className="shrink-0 p-2.5">
        <div className="rounded-xl border border-gray-200/70 bg-white/70 p-2 dark:border-gray-700/70 dark:bg-gray-900/70">
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            onChange={onImportAll}
            className="hidden"
          />
          {dailyLimit > 0 && (
            <div className="mt-2 space-y-1 px-1">
              <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                <span>额度</span>
                <span>
                  {dailyRemaining}/{dailyLimit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-gray-400 transition-all duration-500 dark:bg-gray-500"
                  style={{
                    width: `${Math.round((dailyRemaining / dailyLimit) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {/* 主题切换：Auto / 亮 / 暗 三态（默认 Auto 跟随系统） */}
          <div className="mt-2 flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
            <button
              onClick={() => setThemeMode("auto")}
              title="自动（跟随系统）"
              aria-label="自动主题"
              className={`flex flex-1 items-center justify-center rounded-md p-1.5 transition ${themeMode === "auto" ? "bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"}`}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  d="M12 3a9 9 0 010 18z"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </button>
            <button
              onClick={() => setThemeMode("light")}
              title="亮色"
              aria-label="亮色主题"
              className={`flex flex-1 items-center justify-center rounded-md p-1.5 transition ${themeMode === "light" ? "bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"}`}
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
                  d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
                />
              </svg>
            </button>
            <button
              onClick={() => setThemeMode("dark")}
              title="暗色"
              aria-label="暗色主题"
              className={`flex flex-1 items-center justify-center rounded-md p-1.5 transition ${themeMode === "dark" ? "bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100" : "text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200"}`}
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
                  d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
                />
              </svg>
            </button>
          </div>
          <p className="mt-2 px-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
            {settings.title || "Kimo"}
          </p>
          <p className="px-1 pb-1 text-[10px] leading-relaxed text-gray-300 dark:text-gray-600">
            AI 生成内容仅供参考
          </p>
        </div>
      </div>
    </div>
  );

  // 桌面端侧边栏（可折叠）
  const desktopSidebar = (
    <div
      className={
        "hidden shrink-0 overflow-hidden border-r border-gray-200 transition-all duration-300 ease-in-out lg:block dark:border-gray-800 " +
        (sidebarCollapsed ? "w-0 border-r-0" : "w-64")
      }
    >
      {!sidebarCollapsed && sidebar}
    </div>
  );

  const mobileSidebar = (
    <div
      aria-hidden={!sidebarOpen}
      className={`fixed inset-0 z-50 transition-opacity duration-300 lg:hidden ${
        sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          sidebarOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      <div
        className={`absolute inset-y-0 left-0 w-64 shadow-2xl transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </div>
    </div>
  );

  const agentSidebar = (
    <>
      {/* 桌面端：右侧可拖拽面板 + 滑入动画 */}
      <div
        ref={agentPanelRef}
        className="hidden shrink-0 overflow-hidden border-l border-gray-200 transition-all duration-300 ease-in-out lg:block dark:border-gray-700"
        style={{
          width: agentOpen ? agentWidth : 0,
          borderLeftWidth: agentOpen ? undefined : 0,
        }}
      >
        <div className="relative flex h-full w-full">
          {/* 拖拽手柄 */}
          <div
            className="absolute left-0 top-0 z-10 h-full w-4 cursor-col-resize hover:bg-gray-300/30 active:bg-gray-400/40 dark:hover:bg-gray-600/30"
            onMouseDown={onResizeDown}
          />
          {agentOpen && (
            <div className="min-w-0 flex-1 animate-[kfade_0.25s_ease-out]">
              <MemoAgentPanel
                onClose={closeAgentPanel}
                initUrl={agentInitUrl}
                initTab={agentTab}
                searchNonce={agentSearchNonce}
                initEditContent={agentEditContent}
                lastAssistantContent={settledAssistant}
                pageId={pageId}
                onKbChanged={refreshKb}
                settings={settingsData}
                kbOpen={agentKbOpen}
                onKbOpenConsumed={consumeKbOpen}
                live2dOn={l2dEnabled}
                onTabChange={setAgentTab}
              />
            </div>
          )}
        </div>
      </div>
      {/* 移动端：底部滑入，无模糊遮罩 */}
      {agentOpen && (
        <div className="fixed inset-0 z-50 lg:hidden pointer-events-none">
          <div
            className="absolute inset-x-0 bottom-0 pointer-events-auto animate-[kslideUp_0.35s_ease-out] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-2xl"
            style={{ top: "52px", maxHeight: "calc(100vh - 52px)" }}
          >
            <MemoAgentPanel
              onClose={closeAgentPanel}
              initUrl={agentInitUrl}
              initTab={agentTab}
              searchNonce={agentSearchNonce}
              initEditContent={agentEditContent}
              lastAssistantContent={settledAssistant}
              pageId={pageId}
              onKbChanged={refreshKb}
              settings={settingsData}
              kbOpen={agentKbOpen}
              onKbOpenConsumed={consumeKbOpen}
              live2dOn={l2dEnabled}
              onTabChange={setAgentTab}
            />
          </div>
        </div>
      )}
    </>
  );

  const layout = (
    <div
      className={
        "flex h-full min-h-0 overflow-hidden " +
        (live2dImmersive ? "" : "bg-white dark:bg-gray-900")
      }
    >
      {/* 手机沉浸：铺满的多重水印暗纹网格（浮在 Live2D 之上、聊天内容之下），恢复“暗纹”显示 */}
      {live2dImmersive && (
        <div className="pointer-events-none fixed inset-0 z-0 select-none overflow-hidden">
          <div className="grid h-full grid-cols-2 content-center gap-x-14 gap-y-20 px-4 opacity-20 sm:grid-cols-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="rotate-[-16deg] whitespace-nowrap text-[10px] font-medium tracking-[0.2em] text-gray-400/60 dark:text-gray-500/40"
              >
                AI 生成 · {effCfg.model || "AI"} ·{" "}
                {hasCustom ? "自定义" : "站点"}
              </span>
            ))}
          </div>
        </div>
      )}
      {desktopSidebar}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
        {chatBody}
      </div>
      {agentSidebar}
      {mobileSidebar}
    </div>
  );

  return (
    <>
      <LocalApiModal
        open={apiModalOpen}
        onClose={() => setApiModalOpen(false)}
        pageId={pageId}
        botName={config.botName || "AI"}
        onSaved={() => setLocalCfg(getLocalCfg(pageId))}
      />
      <ArticleComposerModal
        open={articleOpen}
        onClose={() => setArticleOpen(false)}
      />
      {live2dImmersive && <Live2DBackground />}
      {layout}
    </>
  );
}
