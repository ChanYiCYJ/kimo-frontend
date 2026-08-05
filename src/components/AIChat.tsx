import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AIChatConfig, Page } from "../lib/types";
import { useSite } from "../lib/site";
import { useTheme } from "../lib/theme";
import { webSearch, fetchWebpage } from "../lib/search";
import { getKbSelections, getKbNotes, assembleKnowledge } from "../lib/kb";
import { getLocalCfg } from "../lib/localCfg";
import { LocalApiModal } from "./LocalApiModal";
import { UsageDocModal } from "./UsageDocModal";
import { ArticleComposerModal } from "./ArticleComposerModal";
import { UserSettingsPanel } from "./UserSettingsPanel";
import { AgentPanel } from "./AgentPanel";
import { KbPicker } from "./KbPicker";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
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

async function streamChat(
  cfg: AIChatConfig,
  msgs: Message[],
  onChunk: (t: string) => void,
  signal: AbortSignal,
  summary = "",
  knowledge = "",
  memory = "",
  web = "",
) {
  const sys =
    (knowledge
      ? `【重要】你必须优先基于以下用户知识库回答。如果知识库有相关信息，请以此为权威来源：\n${knowledge}\n\n---\n\n`
      : "") +
    (cfg.systemPrompt || "") +
    (memory
      ? `\n\n以下是过往对话中学习到的用户偏好与经验，请据此优化你的回答：\n${memory}`
      : "") +
    (summary ? `\n\n对话上下文摘要：\n${summary}` : "") +
    (web
      ? `\n\n以下是来自网络的最新搜索结果，请基于它们回答（并在适当时注明来源）：\n${web}`
      : "") +
    `\n\n工具：需要浏览网页时回复 [BROWSE:url]；需要搜索时回复 [SEARCH:关键词]；需要编辑文档时回复 [EDIT:内容]。`;
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
        const t = j.choices?.[0]?.delta?.content;
        if (t) {
          full += t;
          onChunk(full);
        }
      } catch {}
    }
  }
  return full;
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
  const { theme, toggle: toggleTheme } = useTheme();
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
  const [localCfg, setLocalCfg] = useState(() => getLocalCfg(pageId));
  const [apiModalOpen, setApiModalOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [articleOpen, setArticleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [kbPickerSelected, setKbPickerSelected] = useState<string[]>([]);
  const [agentInitUrl, setAgentInitUrl] = useState<string | undefined>();
  const [agentWidth, setAgentWidth] = useState(() => {
    if (typeof window === "undefined") return 384;
    return Math.min(520, Math.max(320, Math.round(window.innerWidth * 0.3)));
  });
  const [attachedFile, setAttachedFile] = useState("");
  const [searching, setSearching] = useState(false);
  const [kbText, setKbText] = useState("");
  const [chatFontSize, setChatFontSize] = useState<"sm" | "base" | "lg">(() => {
    try {
      return (localStorage.getItem("kimo_ai_fontsize") || "base") as
        | "sm"
        | "base"
        | "lg";
    } catch {
      return "base";
    }
  });
  const fontSizeCls =
    chatFontSize === "sm"
      ? "text-sm"
      : chatFontSize === "lg"
        ? "text-lg"
        : "text-[15px]";
  const [webSearchOn, setWebSearchOn] = useState(() => {
    try {
      return localStorage.getItem("kimo_ai_websearch") === "1";
    } catch {
      return false;
    }
  });
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [toolCalls, setToolCalls] = useState<
    { msgIdx: number; type: string; detail: string }[]
  >([]);
  const clearMemory = useCallback(() => {
    setMemory("");
    try {
      localStorage.removeItem(STORAGE_PREFIX + "memory_" + pageId);
    } catch {}
  }, [pageId]);
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
  const [memory, setMemory] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PREFIX + "memory_" + pageId) || "";
    } catch {
      return "";
    }
  });
  // 自动朗读：优先用户浏览器偏好（kimo_ai_tts），默认关；用户关闭则进入页面即为关
  const [ttsOn, setTtsOn] = useState(() => {
    try {
      const p = localStorage.getItem("kimo_ai_tts");
      if (p) return p === "1";
    } catch {
      /* 忽略 */
    }
    return !!config.autoTTS;
  });
  const toggleTts = useCallback(() => {
    setTtsOn((prev) => {
      const n = !prev;
      try {
        localStorage.setItem("kimo_ai_tts", n ? "1" : "0");
      } catch {}
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
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const active = sessions.find((s) => s.id === activeId) || sessions[0];
  const messages = active?.messages || [];

  // Agent 面板宽度拖拽
  const onResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startW: agentWidth };
      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const d = resizeRef.current.startX - ev.clientX;
        setAgentWidth(
          Math.min(
            Math.round(window.innerWidth * 0.8),
            Math.max(300, resizeRef.current.startW + d),
          ),
        );
      };
      const onUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [agentWidth],
  );

  // 有效配置：本地自定义 API/提示词 优先于机器人默认配置（非管理员各自本地设置）
  const effCfg: AIChatConfig = {
    ...config,
    endpoint: localCfg.endpoint || config.endpoint,
    apiKey: localCfg.apiKey || config.apiKey,
    model: localCfg.model || config.model,
    systemPrompt: localCfg.prompt || config.systemPrompt,
  };
  const hasCustom = !!(localCfg.endpoint || localCfg.apiKey || localCfg.model);
  const [activePromptIdx, setActivePromptIdx] = useState<number | null>(null);
  const allPrompts = (effCfg.prompts || config.prompts || []).filter(
    (p: { systemPrompt: string }) => p.systemPrompt.trim(),
  );

  const dailyLimit = effCfg.dailyLimit || config.dailyLimit || 0;
  const dailyRemaining =
    dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : -1;

  const persistSessions = useCallback(
    (next: Session[]) => {
      try {
        localStorage.setItem(SESSION_STORAGE(pageId), JSON.stringify(next));
      } catch {}
    },
    [pageId],
  );

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

  const toggleWebSearch = useCallback(() => {
    setWebSearchOn((prev) => {
      const n = !prev;
      try {
        localStorage.setItem("kimo_ai_websearch", n ? "1" : "0");
      } catch {}
      return n;
    });
  }, []);

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
      const insight = `用户问：${q.slice(0, 50)} → AI 答：${a.slice(0, 80)}${a.length > 80 ? "…" : ""}`;
      const lines = memory.split("\n").filter(Boolean);
      lines.push(`- ${insight}`);
      if (lines.length > 12) lines.shift();
      const next = lines.join("\n");
      setMemory(next);
      try {
        localStorage.setItem(STORAGE_PREFIX + "memory_" + pageId, next);
      } catch {}
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

  const send = async () => {
    const t = input.trim();
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
    const user: Message = { role: "user" as const, content: t };
    const allMsgs = [...messages, user];
    let summary = "";
    const recent = allMsgs.length > 6 ? allMsgs.slice(-6) : allMsgs;
    if (allMsgs.length > 6)
      summary = allMsgs
        .slice(0, allMsgs.length - 6)
        .map(
          (m, i) =>
            `${m.role === "user" ? "问" : "答"}${i + 1}: ${m.content.slice(0, 60)}`,
        )
        .join("; ");
    updateActive((prev) => [...prev, user]);
    setInput("");
    setLoading(true);
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
    try {
      // 每次发送时实时读取知识库（不等异步 refreshKb）
      const kbKnowledge = (() => {
        try {
          const notes = getKbNotes();
          const valid = notes.filter(
            (n: { title?: string; content?: string }) => n.title || n.content,
          );
          if (valid.length)
            return (
              "【知识库条目】\n" +
              valid
                .map(
                  (n: { title?: string; content?: string }) =>
                    `- ${n.title}：${n.content}`,
                )
                .join("\n")
            );
        } catch {}
        return "";
      })();
      reply = await streamChat(
        effCfg,
        recent,
        upsertAssistant,
        ctrl.signal,
        summary,
        kbKnowledge || kbText,
        memory,
        web,
      );
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      reply = `错误：${e instanceof Error ? e.message : "请求失败"}`;
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setLoading(false);
    }
    upsertAssistant(reply);

    // AI→Agent 工具调用：解析 [BROWSE:url] / [EDIT:content] / [SEARCH:query]
    const browseCmd = reply.match(/\[BROWSE:\s*(https?:\/\/[^\s\]]+)\s*\]/);
    const editCmd = reply.match(/\[EDIT:\s*([\s\S]*?)\s*\]/);
    const searchCmd = reply.match(/\[SEARCH:\s*([^\]]+)\s*\]/);
    const msgIdx = messages.length;
    if (browseCmd) {
      setAgentInitUrl(browseCmd[1]);
      setAgentOpen(true);
      setToolCalls((prev) => [
        ...prev,
        { msgIdx, type: "浏览网页", detail: browseCmd[1].slice(0, 60) },
      ]);
    } else if (searchCmd) {
      setAgentInitUrl(searchCmd[1].trim());
      setAgentOpen(true);
      setToolCalls((prev) => [
        ...prev,
        { msgIdx, type: "网络搜索", detail: searchCmd[1].trim().slice(0, 60) },
      ]);
    } else if (editCmd) {
      setAgentInitUrl(undefined);
      setAgentOpen(true);
      setToolCalls((prev) => [
        ...prev,
        { msgIdx, type: "编辑文档", detail: editCmd[1].trim().slice(0, 60) },
      ]);
    }
    if (web && web.trim()) {
      setToolCalls((prev) => [
        ...prev,
        { msgIdx, type: "网络资料", detail: web.slice(0, 120) },
      ]);
    }

    if (!reply.startsWith("错误")) learn(t, reply);
    if (ttsOn)
      setTimeout(
        () => speak(reply.replace(/[*_`#~>\[\]\(\)]/g, "").slice(0, 600)),
        500,
      );
  };

  // 导出全部会话（JSON，可再导入）
  const exportAllSessions = () => {
    const data = {
      app: "kimo-ai",
      version: 1,
      bot: config.botName,
      exportedAt: new Date().toISOString(),
      sessions,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kimo-ai-${(config.botName || "chat").replace(/[\s\\/]/g, "-")}-sessions.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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

  if (!consented) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4">
        <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            {config.avatar ? (
              <img
                src={config.avatar}
                alt={config.botName}
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-11 w-11 place-content-center rounded-full bg-gray-100 text-sm font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                {(config.botName || "AI").slice(0, 2)}
              </span>
            )}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {config.botName || "AI 助手"}
              </h3>
              <p className="text-xs text-gray-400">
                开始使用前，请阅读并同意以下须知
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            <section>
              <p className="font-medium text-gray-800 dark:text-gray-300">
                🔒 数据与隐私
              </p>
              <ul className="ml-4 mt-1 list-disc space-y-1">
                <li>
                  对话记录、角色设定、自定义 API
                  均保存在您的本机浏览器，不会上传服务器。
                </li>
                <li>
                  API 密钥仅用于在本机调用模型接口，网站不存储、不读取您的密钥。
                </li>
              </ul>
            </section>
            <section>
              <p className="font-medium text-gray-800 dark:text-gray-300">
                ⚠️ 内容声明
              </p>
              <ul className="ml-4 mt-1 list-disc space-y-1">
                <li>
                  AI
                  回复由第三方模型生成，仅供参考，请自行判断准确性，重要信息请核实。
                </li>
                <li>受 Token 额度限制，回复长度或频率可能受限。</li>
                <li>
                  请勿输入密码、身份证号等个人敏感信息；请勿生成违法违规内容。
                </li>
              </ul>
            </section>
            <section>
              <p className="font-medium text-gray-800 dark:text-gray-300">
                📧 联系与反馈
              </p>
              <p className="mt-1">
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
          </div>
          <button
            onClick={() => {
              setConsented(true);
              try {
                localStorage.setItem(STORAGE_PREFIX + "consent_" + pageId, "1");
              } catch {}
            }}
            className="mt-6 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            我已阅读并同意 · 开始对话
          </button>
          <Link
            to="/"
            className="mt-2 block text-center text-xs text-gray-400 transition hover:text-gray-600"
          >
            返回网站首页
          </Link>
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

  const chatBody = (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
      {/* 顶栏：左侧历史+机器人，右侧Agent+主题 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-100 px-3 py-2 dark:border-gray-700 sm:px-4">
        {/* 左侧：历史按钮 */}
        <button
          onClick={() => setSidebarOpen(true)}
          className={iconBtn}
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
                  onClick={() => setBotMenuOpen((v) => !v)}
                  className="flex max-w-[170px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  {config.avatar ? (
                    <img
                      src={config.avatar}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid h-5 w-5 shrink-0 place-content-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                      {(config.botName || "AI").slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0 truncate">
                    {config.botName || "AI"}
                  </span>
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
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
                {botMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setBotMenuOpen(false)}
                    />
                    <div className="absolute left-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                      <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-gray-400">
                        切换 AI 助手
                      </p>
                      {bots.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => {
                            onSwitchBot?.(b.id);
                            setBotMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-gray-50 dark:hover:bg-gray-800 ${b.id === pageId ? "font-medium text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}
                        >
                          {b.config.avatar ? (
                            <img
                              src={b.config.avatar}
                              alt=""
                              className="h-5 w-5 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span className="grid h-5 w-5 shrink-0 place-content-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 dark:bg-gray-800">
                              {b.name.slice(0, 2)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {b.name}
                          </span>
                          {b.id === pageId && (
                            <span className="text-xs text-gray-400">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
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
                setAgentOpen((v) => {
                  if (!v) {
                    const last = messages[messages.length - 1];
                    if (last?.role === "assistant") {
                      const m = last.content.match(
                        /https?:\/\/[^\s<>"{}|\\^`\[\]]+/,
                      );
                      if (m) setAgentInitUrl(m[0]);
                    }
                  }
                  return !v;
                });
              }}
              className={`${iconBtn} ${agentOpen ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" : ""}`}
              title="Agent 工具箱"
              aria-label="Agent 工具箱"
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
                  strokeLinejoin="round"
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21"
                />
              </svg>
            </button>
            {canManage && (
              <button
                onClick={onManage}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                管理
              </button>
            )}
            <button
              onClick={toggleTheme}
              className={iconBtn}
              title="切换主题"
              aria-label="切换主题"
            >
              {theme === "light" ? (
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
                    d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
                  />
                </svg>
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
                    d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
                  />
                </svg>
              )}
            </button>
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
                <p className="mt-1 text-sm text-gray-400">有什么可以帮你？</p>
                <div className="mt-8 flex w-full max-w-md flex-wrap justify-center gap-2">
                  {[
                    "介绍一下这个网站",
                    "帮我写一段代码",
                    "总结我的文章",
                    "给我一些建议",
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      )}
                      {/* 工具调用卡片 */}
                      {toolCalls.filter((tc) => tc.msgIdx === i).length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {toolCalls
                            .filter((tc) => tc.msgIdx === i)
                            .map((tc, j) => (
                              <div
                                key={j}
                                className="rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20"
                              >
                                <div className="flex items-center gap-1.5 text-xs">
                                  <svg
                                    className="h-3.5 w-3.5 text-blue-500"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 16v-4m0-4h.01" />
                                  </svg>
                                  <span className="font-medium text-blue-600 dark:text-blue-400">
                                    {tc.type}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                                  {tc.detail}
                                </p>
                              </div>
                            ))}
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
                              setAgentInitUrl(undefined);
                              const urls = m.content.match(
                                /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
                              );
                              if (urls) setAgentInitUrl(urls[0]);
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

      {/* 输入栏：ChatGPT 风格整合，按钮统一尺寸 */}
      <div className="shrink-0 bg-white px-3 pb-3 pt-2 dark:bg-gray-900 sm:px-6 sm:pb-4">
        <div className="mx-auto w-full max-w-3xl">
          {/* 可关闭的圆角小卡片（网络搜索 / 附加文件 / 搜索中） */}
          {(webSearchOn || attachedFile || searching) && (
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
                  正在网络搜索…
                </span>
              )}
              {webSearchOn && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  网络搜索
                  <button
                    onClick={toggleWebSearch}
                    className="text-gray-400 transition hover:text-gray-600"
                    aria-label="关闭网络搜索"
                  >
                    ×
                  </button>
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
          <div className="flex items-center gap-0.5 rounded-[26px] border border-gray-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition focus-within:border-gray-400 focus-within:shadow-[0_0_0_3px_rgba(156,163,175,0.15)] dark:border-gray-600 dark:bg-gray-800">
            {/* + 按钮：知识库弹窗 */}
            <div className="relative">
              <button onClick={() => { setKbPickerOpen(!kbPickerOpen); setKbPickerSelected([]); }}
                className={"grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 " + (kbPickerOpen ? "bg-gray-100 text-gray-600 dark:bg-gray-800" : "")}
                title="知识库条目" aria-label="知识库条目">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
              </button>
              {kbPickerOpen && (<>
                <div className="fixed inset-0 z-40" onClick={() => setKbPickerOpen(false)} />
                <KbPicker selected={kbPickerSelected} onToggle={(id: string) => setKbPickerSelected((p: string[]) => p.includes(id) ? p.filter((x: string) => x !== id) : [...p, id])}
                  onInsert={() => { try { const notes = JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]") as {id:string;content:string}[]; const texts = notes.filter((n: {id:string}) => kbPickerSelected.includes(n.id)).map((n: {content:string}) => n.content).join("\n\n"); if (texts) setInput((p: string) => (p ? p + "\n\n" : "") + texts); } catch (e) { console.error(e); } setKbPickerOpen(false); }}
                  onClose={() => setKbPickerOpen(false)} onOpenAgent={() => setAgentOpen(true)} />
              </>)}
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
              onClick={send}
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
    <div className="flex h-full w-64 flex-col bg-gray-50 dark:bg-gray-950">
      <div className="p-3">
        <button
          onClick={newSession}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
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
      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => selectSession(s.id)}
            className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition ${s.id === activeId ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100" : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900"}`}
          >
            <svg
              className="h-4 w-4 shrink-0 opacity-60"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
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
                className="hidden shrink-0 p-1 text-gray-400 transition hover:text-gray-700 group-hover:block max-sm:block dark:hover:text-gray-200"
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
              className="hidden shrink-0 p-1 text-gray-400 transition hover:text-red-500 group-hover:block max-sm:block"
              title="删除"
              aria-label="删除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {/* 底部：用户设置（导出导入 / 模型 / 文档 / GitHub 整合进设置面板） */}
      <div className="shrink-0 border-t border-gray-200 p-2 dark:border-gray-800">
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          onChange={onImportAll}
          className="hidden"
        />
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
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
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          用户设置
        </button>
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
        <p className="mt-2 px-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
          {settings.title || "Kimo"}
        </p>
        <p className="px-1 pb-1 text-[10px] leading-relaxed text-gray-300 dark:text-gray-600">
          AI 生成内容仅供参考
        </p>
      </div>
    </div>
  );

  // 桌面端侧边栏（始终显示）
  const desktopSidebar = (
    <div className="hidden shrink-0 overflow-hidden border-r border-gray-200 lg:block dark:border-gray-800">
      {sidebar}
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

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  const agentSidebar = (
    <>
      {/* 桌面端：右侧可拖拽面板 + 滑入动画 */}
      <div
        className="hidden shrink-0 overflow-hidden border-l border-gray-200 transition-all duration-300 ease-in-out lg:block dark:border-gray-700"
        style={{
          width: agentOpen ? agentWidth : 0,
          borderLeftWidth: agentOpen ? undefined : 0,
        }}
      >
        <div className="relative flex h-full" style={{ width: agentWidth }}>
          {/* 拖拽手柄 */}
          <div
            className="absolute left-0 top-0 z-10 h-full w-4 cursor-col-resize hover:bg-gray-300/30 active:bg-gray-400/40 dark:hover:bg-gray-600/30"
            onMouseDown={onResizeDown}
          />
          {agentOpen && (
            <div className="flex-1 animate-[kfade_0.25s_ease-out]">
              <AgentPanel
                onClose={() => {
                  refreshKb();
                  setAgentOpen(false);
                }}
                onInsertMessage={(t: string) => {
                  setInput((prev: string) => (prev ? prev + "\n\n" + t : t));
                  setAgentOpen(false);
                }}
                initUrl={agentInitUrl}
                lastAssistantContent={lastAssistant?.content}
                pageId={pageId}
                memory={memory}
                onMemoryChange={(m) => {
                  setMemory(m);
                  try {
                    localStorage.setItem(
                      STORAGE_PREFIX + "memory_" + pageId,
                      m,
                    );
                  } catch {}
                }}
                onKbChanged={refreshKb}
              />
            </div>
          )}
        </div>
      </div>
      {/* 移动端：全屏 overlay（不覆盖顶栏） */}
      {agentOpen && (
        <div className="fixed inset-0 top-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => {
              refreshKb();
              setAgentOpen(false);
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0 animate-[kslideUp_0.35s_ease-out]"
            style={{ top: "52px", maxHeight: "85vh" }}
          >
            <AgentPanel
              onClose={() => {
                refreshKb();
                setAgentOpen(false);
              }}
              onInsertMessage={(t: string) => {
                setInput((prev: string) => (prev ? prev + "\n\n" + t : t));
                setAgentOpen(false);
              }}
              initUrl={agentInitUrl}
              lastAssistantContent={lastAssistant?.content}
              pageId={pageId}
              memory={memory}
              onMemoryChange={(m) => {
                setMemory(m);
                try {
                  localStorage.setItem(STORAGE_PREFIX + "memory_" + pageId, m);
                } catch {}
              }}
              onKbChanged={refreshKb}
            />
          </div>
        </div>
      )}
    </>
  );

  const layout = (
    <div className="flex h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900">
      {desktopSidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chatBody}</div>
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
      <UsageDocModal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        hasCustom={hasCustom}
        canManage={!!canManage}
      />
      <ArticleComposerModal
        open={articleOpen}
        onClose={() => setArticleOpen(false)}
      />
      <UserSettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        pageId={pageId}
        canManage={!!canManage}
        hasCustom={hasCustom}
        botName={config.botName || "AI"}
        ttsOn={ttsOn}
        onToggleTts={toggleTts}
        webSearchOn={webSearchOn}
        onToggleWebSearch={toggleWebSearch}
        onExportAll={exportAllSessions}
        onImport={() => importRef.current?.click()}
        onOpenDoc={() => {
          setSettingsOpen(false);
          setDocOpen(true);
        }}
        onClearMemory={clearMemory}
        chatFontSize={chatFontSize}
        onSetFontSize={(v) => {
          setChatFontSize(v as any);
          try {
            localStorage.setItem("kimo_ai_fontsize", v);
          } catch {}
        }}
        onCustomSaved={() => setLocalCfg(getLocalCfg(pageId))}
        allowCustomApi={customApiEnabled}
      />
      {layout}
    </>
  );
}
