// ===== Live2D Agent — 纯函数配置层（bestdori · Cubism 2）=====
// 数据流：fetchBuildData(modelName) → .Base(BuildData) → buildLive2dSettings →
//         Live2DModel.from(settings)（在 live2dCore 中执行）
// bestdori.com 不返回 CORS 头，浏览器无法跨域直连 → 所有资源走同源反代：
//   /api/live2d/asset/* → bestdori.com/assets/*
//   /api/live2d/api/*   → bestdori.com/api/*
// 本模块全部为纯函数 + localStorage，可直接在 vitest 中单测。

import type { SiteSettings } from "./types";

// ---- 类型 ----

export interface BundleFile {
  bundleName: string;
  fileName: string;
}

export interface BuildData {
  model: BundleFile;
  physics?: BundleFile;
  textures: BundleFile[];
  motions: BundleFile[];
  expressions: BundleFile[];
  transition?: BundleFile;
}

/** 传给 pixi-live2d-display 的 settings 对象（model/physics/纹理/动作/表情全部为同源绝对 URL） */
export interface Live2dSettings {
  url: string;
  model: string;
  physics?: string;
  textures: string[];
  motions: Record<string, { file: string }[]>;
  expressions: { name: string; file: string }[];
}

export interface Live2dModelInfo {
  modelName: string;
  characterId: string;
  costume: string;
}

// ---- 常量 ----

/** bestdori 模型名：{角色ID:03d}_{服装}，如 001_casual（香澄常服）、011_casual（心常服） */
export const DEFAULT_LIVE2D_MODEL = "001_casual";

/** 精选角色（Agent 面板 Live2D tab 的换角色卡片），NNN_casual 均已验证存在 */
export interface Live2dCharacter {
  model: string;
  name: string;
  /** 所属乐队（换角色分组用）；自定义导入模型无此字段 */
  band?: string;
}
export const LIVE2D_CHARACTERS: Live2dCharacter[] = [
  { model: "001_casual", name: "户山 香澄", band: "Poppin'Party" },
  { model: "002_casual", name: "花园 多惠", band: "Poppin'Party" },
  { model: "003_casual", name: "牛込 里美", band: "Poppin'Party" },
  { model: "004_casual", name: "山吹 沙绫", band: "Poppin'Party" },
  { model: "005_casual", name: "市谷 有咲", band: "Poppin'Party" },
  { model: "006_casual", name: "美竹 兰", band: "Afterglow" },
  { model: "007_casual", name: "青叶 摩卡", band: "Afterglow" },
  { model: "008_casual", name: "上原 绯玛丽", band: "Afterglow" },
  { model: "009_casual", name: "宇田川 巴", band: "Afterglow" },
  { model: "010_casual", name: "羽泽 鸫", band: "Afterglow" },
  { model: "011_casual", name: "弦卷 心", band: "Hello, Happy World!" },
  { model: "012_casual", name: "濑田 薰", band: "Hello, Happy World!" },
  { model: "013_casual", name: "北泽 育美", band: "Hello, Happy World!" },
  { model: "014_casual", name: "松原 花音", band: "Hello, Happy World!" },
  { model: "015_casual", name: "米歇尔", band: "Hello, Happy World!" },
  { model: "016_casual", name: "丸山 彩", band: "Pastel*Palettes" },
  { model: "017_casual", name: "冰川 日菜", band: "Pastel*Palettes" },
  { model: "018_casual", name: "白鹭 千圣", band: "Pastel*Palettes" },
  { model: "019_casual", name: "大和 麻弥", band: "Pastel*Palettes" },
  { model: "020_casual", name: "若宫 伊芙", band: "Pastel*Palettes" },
  { model: "021_casual", name: "凑 友希那", band: "Roselia" },
  { model: "022_casual", name: "冰川 纱夜", band: "Roselia" },
  { model: "023_casual", name: "今井 莉莎", band: "Roselia" },
  { model: "024_casual", name: "宇田川 亚子", band: "Roselia" },
  { model: "025_casual", name: "白金 燐子", band: "Roselia" },
];

/** 自定义导入模型（用户输入 bestdori 模型名，如 026_casual / 001_summer 等） */
export interface CustomLive2dModel {
  model: string;
  name: string;
}
export const LIVE2D_CUSTOM_KEY = "kimo_live2d_custom_models";

export function loadCustomModels(): CustomLive2dModel[] {
  try {
    const r = JSON.parse(localStorage.getItem(LIVE2D_CUSTOM_KEY) || "[]");
    return Array.isArray(r)
      ? r.filter(
          (m) => typeof m?.model === "string" && typeof m?.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function saveCustomModels(list: CustomLive2dModel[]): void {
  try {
    localStorage.setItem(LIVE2D_CUSTOM_KEY, JSON.stringify(list));
  } catch {}
}

/** 添加自定义模型（按 model 去重），返回新列表 */
export function addCustomModel(
  model: string,
  name?: string,
): CustomLive2dModel[] {
  const m = (model || "").trim();
  if (!m) return loadCustomModels();
  const item: CustomLive2dModel = {
    model: m,
    name: (name || "").trim() || m,
  };
  const list = [item, ...loadCustomModels().filter((x) => x.model !== m)];
  saveCustomModels(list);
  return list;
}

export function removeCustomModel(model: string): CustomLive2dModel[] {
  const list = loadCustomModels().filter((x) => x.model !== model);
  saveCustomModels(list);
  return list;
}

/** 模型名 → 角色名（未知回退模型名） */
export function characterNameOf(model: string): string {
  return LIVE2D_CHARACTERS.find((c) => c.model === model)?.name || model;
}

/** 枚举接口（_info.json）不可用时的内置兜底模型（NNN_casual 常服，名字未知时显示 角色{id}） */
export const CURATED_LIVE2D_MODELS: string[] = Array.from(
  { length: 30 },
  (_, i) => `${String(i + 1).padStart(3, "0")}_casual`,
);

/** 站点设置 key（后台 Settings） */
export const SETTING_ENABLE = "live2d_enable";
export const SETTING_MODEL = "live2d_model";

/** 用户本地选择 key */
export const LIVE2D_MODEL_KEY = "kimo_live2d_model";
export const LIVE2D_PICKER_CACHE_KEY = "kimo_live2d_picker_cache_v1";

/** auto 哨兵：本地选择为 auto 时每次加载随机选一个角色 */
export const LIVE2D_MODEL_AUTO = "auto";

/** 选择器列表缓存有效期（ms） */
export const PICKER_CACHE_TTL = 24 * 60 * 60 * 1000;

// ---- localStorage 安全封装（与 chatSettings 一致）----

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
    /* 忽略 */
  }
}

// ---- 反代 URL 构造 ----

/** 单个资源文件的同源反代 URL（model/motion 去 .bytes，texture .bytes→.png / 无扩展名补 .png） */
export function assetUrl(
  file: BundleFile,
  kind: "model" | "physics" | "texture" | "motion" | "expression",
): string {
  let fileName = file.fileName;
  if (kind === "model" || kind === "motion") {
    // bestdori 真实 asset 无子目录：motion 的 fileName 带 "motion/" 前缀，必须去掉
    // （否则 URL 指向不存在的 …/motion/xxx.mtn，bestdori 返回主页兜底 → 动作加载失败“没反应”）
    fileName = fileName.replace(/^motion\//, "").replace(/\.bytes$/, "");
  }
  if (kind === "texture") {
    if (fileName.endsWith(".bytes"))
      fileName = fileName.replace(/\.bytes$/, ".png");
    else if (!fileName.includes(".")) fileName = `${fileName}.png`;
  }
  return `/api/live2d/asset/jp/${file.bundleName}_rip/${fileName}`;
}

/** buildData.asset 的同源反代 URL */
export function buildDataUrl(modelName: string): string {
  return `/api/live2d/asset/jp/live2d/chara/${modelName}_rip/buildData.asset`;
}

/** 拉取 buildData.asset 并返回 .Base */
export async function fetchBuildData(modelName: string): Promise<BuildData> {
  const res = await fetch(buildDataUrl(modelName));
  if (!res.ok) throw new Error(`buildData HTTP ${res.status}`);
  const json: unknown = await res.json();
  const base = (json as { Base?: BuildData } | null)?.Base;
  if (!base) throw new Error("buildData 缺少 Base");
  return base;
}

/** BuildData → pixi-live2d-display settings（绝对 URL 指向同源反代） */
export function buildLive2dSettings(
  modelName: string,
  bd: BuildData,
): Live2dSettings {
  const motions: Record<string, { file: string }[]> = {};
  for (const m of bd.motions || []) {
    const key =
      (m.fileName.split("/").pop() || "idle")
        .replace(/\.bytes$/, "")
        .replace(/\.mtn$/, "") || "idle";
    motions[key] = [{ file: assetUrl(m, "motion") }];
  }
  return {
    url: buildDataUrl(modelName),
    model: assetUrl(bd.model, "model"),
    physics: bd.physics ? assetUrl(bd.physics, "physics") : undefined,
    textures: (bd.textures || []).map((t) => assetUrl(t, "texture")),
    motions,
    expressions: (bd.expressions || []).map((e) => ({
      name: e.fileName.replace(/\.exp\.json$/, ""),
      file: assetUrl(e, "expression"),
    })),
  };
}

// ---- 第三方模型导入（支持任意 Cubism2 model.json 网址）----

/** 内嵌的第三方模型来源示例（shizuku 白无垢 · guansss/pixi-live2d-display 开源测试模型，Cubism2） */
export const THIRD_PARTY_DEMO_MODEL =
  "https://raw.githubusercontent.com/guansss/pixi-live2d-display/master/test/assets/shizuku/shizuku.model.json";

/** 是否为第三方 model.json 输入（http(s) 网址，或含路径/ .json） */
export function isThirdPartyModelInput(v: string): boolean {
  const s = (v || "").trim();
  return /^https?:\/\//i.test(s) || /\.json$/i.test(s) || s.includes("/");
}

/** 经 worker 通用代理拉取任意 URL（第三方资源无 CORS 头时必需） */
export function live2dProxyUrl(target: string): string {
  return "/api/live2d/proxy?url=" + encodeURIComponent(target);
}

/**
 * 第三方模型资源用的绝对代理 URL（含 origin）。
 * pixi-live2d-display 会用 settings.url（model.json 的 base）解析资源相对路径，
 * 若返回相对路径会被拼到第三方主机（如 raw.githubusercontent.com）上导致 404 —— 必须绝对。
 */
export function absoluteLive2dProxyUrl(target: string): string {
  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "";
  return origin + "/api/live2d/proxy?url=" + encodeURIComponent(target);
}

/** 拉取第三方 Cubism2 model.json 并构造 pixi-live2d-display settings（相对路径按 model.json 所在目录解析） */
export async function fetchThirdPartyModel(
  modelUrl: string,
): Promise<Live2dSettings> {
  const res = await fetch(live2dProxyUrl(modelUrl));
  if (!res.ok) throw new Error("model.json HTTP " + res.status);
  const json: unknown = await res.json();
  const j = (json || {}) as {
    model?: string;
    textures?: string[];
    physics?: string;
    motions?: Record<string, { file: string }[]>;
    expressions?: { name?: string; file: string }[];
  };
  if (!j.model)
    throw new Error("model.json 缺少 model 字段（需 Cubism2 格式）");
  const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
  const abs = (p: string): string => {
    try {
      return new URL(p, base).href;
    } catch {
      return base + p;
    }
  };
  const motions: Record<string, { file: string }[]> = {};
  for (const [k, arr] of Object.entries(j.motions || {})) {
    motions[k] = (arr || [])
      .filter((m) => m && m.file)
      .map((m) => ({ file: absoluteLive2dProxyUrl(abs(m.file)) }));
  }
  return {
    url: modelUrl,
    model: absoluteLive2dProxyUrl(abs(j.model)),
    physics: j.physics ? absoluteLive2dProxyUrl(abs(j.physics)) : undefined,
    textures: (j.textures || []).map((t) => absoluteLive2dProxyUrl(abs(t))),
    motions,
    expressions: (j.expressions || []).map((e) => ({
      name: e.name || "exp",
      file: absoluteLive2dProxyUrl(abs(e.file)),
    })),
  };
}

// ---- 表情（借鉴 SoulLink_Live2D 预设 + 平滑过渡）----

export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "shy"
  | "thinking"
  | "sleepy"
  | "wink";

export const EMOTIONS: readonly Emotion[] = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "shy",
  "thinking",
  "sleepy",
  "wink",
];

export interface EmotionPreset {
  key: Emotion;
  label: string;
  duration: number;
  /** Cubism2 参数名 → 目标值（setParamFloat） */
  params: Record<string, number>;
}

/** Cubism 2 通用参数预设（对齐 SoulLink PRESET_EXPRESSIONS 的精神，适配 bestdori 模型） */
export const EMOTION_PRESETS: Record<Emotion, EmotionPreset> = {
  neutral: { key: "neutral", label: "平静", duration: 500, params: {} },
  happy: {
    key: "happy",
    label: "开心",
    duration: 600,
    params: {
      ParamEyeLSmile: 0.9,
      ParamEyeRSmile: 0.9,
      ParamMouthForm: 0.8,
      ParamMouthOpenY: 0.2,
      ParamBrowLY: 0.3,
      ParamBrowRY: 0.3,
    },
  },
  sad: {
    key: "sad",
    label: "难过",
    duration: 700,
    params: {
      ParamBrowLY: -0.4,
      ParamBrowRY: -0.4,
      ParamMouthForm: -0.5,
      ParamEyeLOpen: 0.5,
      ParamEyeROpen: 0.5,
    },
  },
  angry: {
    key: "angry",
    label: "生气",
    duration: 600,
    params: {
      ParamBrowLAngle: 0.8,
      ParamBrowRAngle: 0.8,
      ParamBrowLY: 0.5,
      ParamBrowRY: 0.5,
      ParamMouthForm: -0.4,
      ParamEyeLOpen: 0.9,
      ParamEyeROpen: 0.9,
    },
  },
  surprised: {
    key: "surprised",
    label: "惊讶",
    duration: 500,
    params: {
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamMouthOpenY: 1,
      ParamBrowLY: 0.7,
      ParamBrowRY: 0.7,
    },
  },
  shy: {
    key: "shy",
    label: "害羞",
    duration: 700,
    params: {
      ParamEyeLSmile: 0.4,
      ParamEyeRSmile: 0.4,
      ParamMouthForm: 0.3,
      ParamBrowLY: 0.4,
      ParamBrowRY: 0.4,
      ParamEyeLOpen: 0.4,
      ParamEyeROpen: 0.4,
    },
  },
  thinking: {
    key: "thinking",
    label: "思考",
    duration: 800,
    params: {
      ParamEyeROpen: 0.4,
      ParamEyeLSmile: -0.2,
      ParamEyeRSmile: -0.2,
      ParamBrowLY: -0.3,
      ParamBrowRY: 0.5,
    },
  },
  sleepy: {
    key: "sleepy",
    label: "困倦",
    duration: 900,
    params: {
      ParamEyeLOpen: 0.2,
      ParamEyeROpen: 0.2,
      ParamMouthOpenY: 0.1,
      ParamBrowLY: -0.2,
      ParamBrowRY: -0.2,
    },
  },
  wink: {
    key: "wink",
    label: "眨眼",
    duration: 500,
    params: {
      ParamEyeROpen: 0,
      ParamEyeLSmile: 0.5,
      ParamEyeRSmile: 0.5,
      ParamMouthForm: 0.4,
    },
  },
};

/**
 * 情感 → 模型自带动作名候选（bestdori 模型 motions 含 angry01/sad01/surprised01/
 * smile01/shame01/sleep01/wink01/idle01 等）。播放模型自己的动作 = 真正的动作控制，
 * 比微调参数更直观可见。取第一个模型上存在的动作播放。
 */
export const EMOTION_MOTIONS: Record<Emotion, string[]> = {
  neutral: ["idle01", "idle02", "idle"],
  happy: [
    "smile01",
    "smile02",
    "smile03",
    "smile04",
    "oowarai01",
    "jaan01",
    "niyaniya01",
    "sing01",
  ],
  sad: ["sad01", "sad02", "cry01", "cry02", "cry03"],
  angry: ["angry01", "serious01"],
  surprised: ["surprised01", "surprised02", "surprised03", "scared01"],
  shy: ["shame01", "niyaniya01"],
  thinking: ["serious01", "serious02", "eeto01", "nod01"],
  sleepy: ["sleep01", "sleep02"],
  wink: ["wink01", "smile05", "smile06"],
};

/** 本地规则情感检测（关键词 + 表情符号，按命中数取最高；无命中 → neutral） */
const EMOTION_RULES: ReadonlyArray<readonly [Emotion, RegExp]> = [
  [
    "angry",
    /生气|气死|愤怒|可恶|气人|火大|讨厌|混蛋|气炸|烦躁|岂有此理|瞪|哼|怒了|恼火|气鼓鼓|不服|火冒三丈|😡|🤬|😠|👿|💢/,
  ],
  // 平手（得分相同）取先者 → 正向情绪（happy）排在 sad 前，避免"笑出声"与"语气放软"并存时误判为难过
  [
    "happy",
    /哈哈|嘻嘻|嘿嘿|开心|高兴|快乐|喜欢|太好了|耶|好棒|爱你|谢谢|笑|笑起来|笑死|眯眼|俏皮|嘴角|翘起|乐了|美滋滋|得意|眉开眼笑|元气|愉悦|😊|😍|🥰|😘|💕|🥹|😄/,
  ],
  [
    "sad",
    /呜呜|难过|伤心|想哭|哭|难受|心碎|好惨|泪|沮丧|失望|郁闷|心累|崩溃|孤独|委屈|放软|轻声|叹气|低落|柔和|哽咽|破防|emo|绷不住|垂头|黯然|鼻酸|😢|😭|🥺|😔|😞|💔/,
  ],
  [
    "surprised",
    /震惊|竟然|天哪|真的吗|不可能|意外|惊讶|卧槽|哇塞|吓一跳|吓了一跳|吃惊|呆住|惊了|真的假的|难以置信|目瞪口呆|愣住|咦|诶|😱|😨|😲|🤯|🙀/,
  ],
  [
    "shy",
    /害羞|脸红|不好意思|羞涩|羞死|别过脸|低头|别扭|尴尬|难为情|含羞|怯生生|忸怩|支支吾吾|欲言又止|脸一红|🫣/,
  ],
  [
    "thinking",
    /思考|想想|琢磨|纠结|考虑|大概|也许|可能|沉思|若有所思|歪头|喃喃|唔|🤔/,
  ],
  ["sleepy", /困|睡觉|晚安|好累|疲惫|哈欠|乏|犯困|没精打采|打盹|😴|🥱|💤/],
  ["wink", /眨眼|抛媚眼|挤眉弄眼|使眼色|😉|😜|😏/],
];

export function detectEmotion(text: string): Emotion {
  const t = (text || "").toLowerCase();
  let best: Emotion = "neutral";
  let bestScore = 0;
  for (const [em, re] of EMOTION_RULES) {
    const m = t.match(re);
    const score = m ? m.length : 0;
    if (score > bestScore) {
      best = em;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 从 AI 回复推断角色情绪（AI 是 Live2D 角色）。
 * 优先解析括号内的动作/表情描写（如（吓了一跳）（声音放软了些）（别过脸去）），
 * 这些是 AI 角色的表演提示，比正文更准（避免正文里"开心"等安慰话术误判）；无则回退整段。
 */
export function detectReplyEmotion(text: string): Emotion {
  const t = text || "";
  const parens = (t.match(/[（(][^（）()]{1,50}[)）]/g) || []).join(" ");
  if (parens) {
    const fromParens = detectEmotion(parens);
    if (fromParens !== "neutral") return fromParens;
  }
  return detectEmotion(t);
}

// ---- AI 表情标签（AI Chat 控制表情）：回复末尾可附 [表情:开心] / 【表情:别扭】 / [EMOTION:开心] ----

/** 兼容方括号/中文括号，任意名称都捕获（由别名表映射，未知名返回 null） */
const EMOTION_TAG_RE =
  /[\[【]\s*(?:表情|EMOTION)\s*[:：]\s*([^\]】]{1,12}?)\s*[\]】]/i;

/** 标签名称 → 情绪（含别名，AI 可能写 高兴/别扭/尴尬 等） */
const EMOTION_LABEL_ALIASES: Record<string, Emotion> = {
  平静: "neutral",
  开心: "happy",
  高兴: "happy",
  快乐: "happy",
  愉悦: "happy",
  难过: "sad",
  伤心: "sad",
  悲伤: "sad",
  委屈: "sad",
  沮丧: "sad",
  生气: "angry",
  愤怒: "angry",
  惊讶: "surprised",
  震惊: "surprised",
  意外: "surprised",
  害羞: "shy",
  别扭: "shy",
  尴尬: "shy",
  羞涩: "shy",
  思考: "thinking",
  沉思: "thinking",
  困倦: "sleepy",
  困: "sleepy",
  困了: "sleepy",
  眨眼: "wink",
  俏皮: "wink",
};

/** 从 AI 回复中解析表情标签，无则返回 null（AI 控制表情） */
export function parseEmotionTag(text: string): Emotion | null {
  const m = (text || "").match(EMOTION_TAG_RE);
  if (!m) return null;
  return EMOTION_LABEL_ALIASES[m[1].trim()] || null;
}

/** 剥离显示文本中的表情标签（与 stripToolCmds 一起用于消息展示；方/中文括号、任意名称都剥离） */
export function stripEmotionTag(text: string): string {
  return (text || "")
    .replace(/[\[【]\s*(?:表情|EMOTION)\s*[:：]\s*[^\]】]*?[\]】]/gi, "")
    .trim();
}

// ---- 模型选择（bestdori 枚举）----

/** 从 _info.json 提取 live2d.chara 键，过滤 NNN_* 角色服装模型 */
export function parseModelNames(assetsIndex: unknown): string[] {
  const chara =
    (assetsIndex as { live2d?: { chara?: Record<string, unknown> } })?.live2d
      ?.chara || {};
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of Object.keys(chara)) {
    if (!/^\d{3}_[a-z0-9_-]+$/.test(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.sort();
}

export function modelInfo(modelName: string): Live2dModelInfo {
  const m = /^(\d{3})_(.+)$/.exec(modelName);
  return {
    modelName,
    characterId: m ? m[1] : "",
    costume: m ? m[2] : modelName,
  };
}

/** characters/all.2.json → id→名字（优先简体中文，回退首个非空） */
export function parseCharacters(chars: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const obj =
    (chars as Record<string, { characterName?: unknown } | undefined>) || {};
  for (const [id, info] of Object.entries(obj)) {
    const arr = info?.characterName;
    const list = Array.isArray(arr) ? (arr as unknown[]) : [];
    // characterName 数组：[, 日文, 英文, 繁中, 简中, 韩文…] → 优先简中（index 3）
    const zh =
      typeof list[3] === "string" && String(list[3]).trim()
        ? String(list[3]).trim()
        : "";
    const name = zh || list.find((s) => typeof s === "string" && s.trim());
    map.set(id, String(name || id));
  }
  return map;
}

/** 角色分组模型列表（选择器用）：{ characterId, characterName, models[] } */
export interface CharaGroup {
  characterId: string;
  characterName: string;
  models: string[];
}

export function groupModels(
  modelNames: string[],
  charaMap: Map<string, string>,
): CharaGroup[] {
  const groups = new Map<string, CharaGroup>();
  for (const name of modelNames) {
    const { characterId, costume } = modelInfo(name);
    if (!characterId) continue;
    const g = groups.get(characterId) || {
      characterId,
      // chars 接口 key 是数字字符串（1,2…）而模型名是补零（001）→ 同时尝试两种形式
      characterName:
        charaMap.get(characterId) ||
        charaMap.get(String(Number(characterId))) ||
        charaMap.get(characterId.replace(/^0+/, "")) ||
        `角色 ${characterId}`,
      models: [],
    };
    g.models.push(`${characterId}_${costume}`);
    groups.set(characterId, g);
  }
  return [...groups.values()].sort((a, b) =>
    a.characterName.localeCompare(b.characterName, "zh"),
  );
}

// ---- 本地模型选择 + 选择器缓存 ----

export function loadLive2dModel(): string {
  return lsGet(LIVE2D_MODEL_KEY) || "";
}
export function saveLive2dModel(name: string): void {
  lsSet(LIVE2D_MODEL_KEY, name);
}

/** 随机选一个精选角色（auto 模式兜底用） */
export function randomLive2dModel(): string {
  const list = LIVE2D_CHARACTERS;
  return list[Math.floor(Math.random() * list.length)].model;
}

// ---- auto 模式：AI 按记忆/知识库选角（缓存最近一次 AI 选角，避免每次随机）----

/** AI 选角缓存 key */
export const LIVE2D_AUTO_PICK_KEY = "kimo_live2d_auto_pick";
/** AI 选角缓存有效期（ms） */
export const AUTO_PICK_TTL = 60 * 60 * 1000;

export interface Live2dAutoPick {
  model: string;
  ts: number;
}

export function saveAutoPick(model: string): void {
  try {
    lsSet(LIVE2D_AUTO_PICK_KEY, JSON.stringify({ model, ts: Date.now() }));
  } catch {
    /* 忽略 */
  }
}

export function getAutoPick(): Live2dAutoPick | null {
  const raw = lsGet(LIVE2D_AUTO_PICK_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Live2dAutoPick;
    if (
      !p ||
      typeof p.model !== "string" ||
      !p.model ||
      typeof p.ts !== "number" ||
      Date.now() - p.ts > AUTO_PICK_TTL
    )
      return null;
    return p;
  } catch {
    return null;
  }
}

// ---- auto 选角请求（Live2DStage 开启 auto 时通知 AIChat 让 AI 重新选角）----

type AutoPickListener = () => void;
const autoPickListeners = new Set<AutoPickListener>();

/** 订阅「auto 选角请求」事件（AIChat 用） */
export function onAutoPickRequest(fn: AutoPickListener): () => void {
  autoPickListeners.add(fn);
  return () => {
    autoPickListeners.delete(fn);
  };
}

/** 发出「auto 选角请求」（Live2DStage 开启 auto 时调用） */
export function requestAutoPick(): void {
  autoPickListeners.forEach((fn) => fn());
}

/** 解析实际加载的模型名：本地 auto→优先用最近 AI 选角（无则随机）；本地指定→本地；否则站点默认/内置默认 */
export function resolveLive2dModel(settingsModel?: string): string {
  const stored = loadLive2dModel();
  if (stored === LIVE2D_MODEL_AUTO) {
    const pick = getAutoPick();
    if (pick) return pick.model;
    return randomLive2dModel();
  }
  if (stored) return stored;
  return (settingsModel || "").trim() || DEFAULT_LIVE2D_MODEL;
}

export interface Live2dPickerCache {
  ts: number;
  models: string[];
  characters: { id: string; name: string }[];
}

export function loadPickerCache(): Live2dPickerCache | null {
  const raw = lsGet(LIVE2D_PICKER_CACHE_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Live2dPickerCache;
    if (!c || typeof c.ts !== "number" || Date.now() - c.ts > PICKER_CACHE_TTL)
      return null;
    return c;
  } catch {
    return null;
  }
}

export function savePickerCache(c: Live2dPickerCache): void {
  lsSet(LIVE2D_PICKER_CACHE_KEY, JSON.stringify(c));
}

// ---- 站点设置解析 ----

export function resolveLive2dConfig(settings: SiteSettings): {
  enabled: boolean;
  model: string;
} {
  return {
    enabled: settings.live2d_enable !== "0",
    model: (settings.live2d_model || "").trim() || DEFAULT_LIVE2D_MODEL,
  };
}

// ---- bestdori API（经反代）----

export async function fetchAssetsIndex(): Promise<unknown> {
  const res = await fetch(
    `/api/live2d/api/explorer/jp/assets/_info.json?_=${Date.now()}`,
  );
  if (!res.ok) throw new Error(`assets index HTTP ${res.status}`);
  return res.json();
}

export async function fetchCharacters(): Promise<unknown> {
  const res = await fetch(
    `/api/live2d/api/characters/all.2.json?_=${Date.now()}`,
  );
  if (!res.ok) throw new Error(`characters HTTP ${res.status}`);
  return res.json();
}
