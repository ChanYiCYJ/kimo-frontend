// ===== Live2D Agent — 单例控制器（唯一 PIXI 实例）=====
// 职责：
//  - 动态注入 Cubism2 运行时（/lib/live2dcubismcore.min.js + /lib/live2d.min.js）
//  - 动态 import pixi.js + pixi-live2d-display/cubism2（避免把 ~1MB 打进主 bundle）
//  - 持有唯一 PIXI.Application + Live2DModel；canvas 可 re-parent 到不同容器
//  - 表情平滑过渡（easeInOutCubic 插值 setParamFloat）+ 自动复位（借鉴 SoulLink）
//  - 纹理 404 探测 → 透明 PNG 兜底（防破图）
// AgentPanel 桌面 + 移动双实例时，靠「最后 attach 的容器」获得 canvas（只有一个 PIXI app）。

import {
  EMOTION_MOTIONS,
  EMOTION_PRESETS,
  buildLive2dSettings,
  fetchBuildData,
  fetchThirdPartyModel,
  type Emotion,
} from "./live2d";

export type Live2dStatus = "idle" | "loading" | "ready" | "error";

export interface Live2dCoreState {
  status: Live2dStatus;
  error?: string;
  emotion: Emotion;
  modelName: string;
}

const RUNTIME_SCRIPTS = ["/lib/live2dcubismcore.min.js", "/lib/live2d.min.js"];

const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9p7fJ4sAAAAASUVORK5CYII=";

// ---- 模块级单例状态 ----
let app: any = null; // PIXI.Application
let model: any = null; // Live2DModel
let canvas: HTMLCanvasElement | null = null;
let attachedEl: HTMLElement | null = null;
let engineCache: { PIXI: any; Live2DModel: any } | null = null;
let runtimePromise: Promise<void> | null = null;
let state: Live2dCoreState = {
  status: "idle",
  emotion: "neutral",
  modelName: "",
};
const listeners = new Set<() => void>();
let animationId = 0;
let resetTimer: number | null = null;
let ro: ResizeObserver | null = null;
/** 当前模型真实存在的表情参数集合（getParamIndex 探测），null=未探测 */
let availableParams: Set<string> | null = null;
/** 当前模型自带动作名集合（settings.motions 的 key） */
let motionNames: Set<string> | null = null;
/** 当前模型基础（未缩放）尺寸：model.width 会随 scale 变化，直接用它算缩放会反馈漂移 */
let modelBaseW = 1;
let modelBaseH = 1; /** 模型本地边界顶部偏移（loadModel 时缓存一次——拖拽中模型播动作会改变 getLocalBounds，若每帧重算会让 model.y 跳动导致“一闪一闪”） */
let baseTopOffset = 0;
/** 角色垂直居中模式（手机沉浸全屏用）：默认顶部对齐（dock/面板防裁头），沉浸时垂直居中避免顶到导航栏 */
let centerVertically = false;
/** 设置垂直居中模式（手机沉浸背景挂载时开启、卸载时复位），强制重新 fit */
export function setLive2dVerticalCenter(v: boolean): void {
  if (centerVertically === v) return;
  centerVertically = v;
  lastFitW = 0;
  lastFitH = 0;
  scheduleFit();
}
/** 上次 fit 的画布尺寸（尺寸未变时跳过，减少拖拽中每帧无谓 resize/闪烁） */
let lastFitW = 0;
let lastFitH = 0; /** 角色切换淡入动画 id */
let fadeId = 0;
/** 正在淡出（等待销毁）的旧模型——切换角色交叉淡化，避免瞬间消失的突兀空窗 */
let fadingModel: any = null;
/** 眨眼 / 随机小动作（让角色更"活"，不像木偶） */
let blinkTimer: number | null = null;
let ambientTimer: number | null = null;
let blinkId = 0;
/** 上次情绪表达时间（ambient 给情绪让位） */
let lastEmotionAt = 0;
/** 上次 ambient 播的动作（避免连续重复） */
let lastAmbientMotion = "";
/** 强情绪连播第二个动作的定时器（换情绪/卸载时清理） */
let sequenceTimer: number | null = null;

function setState(patch: Partial<Live2dCoreState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function getState(): Live2dCoreState {
  return state;
}
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---- 运行时注入 ----
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-live2d-src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.live2dSrc = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Live2D 运行时加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureRuntime(): Promise<void> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    for (const src of RUNTIME_SCRIPTS) {
      await loadScript(src);
    }
  })();
  return runtimePromise;
}

async function ensureEngine(): Promise<{ PIXI: any; Live2DModel: any }> {
  if (engineCache) return engineCache;
  await ensureRuntime();
  const PIXI: any = await import("pixi.js");
  // pixi-live2d-display/cubism2 依赖 window.PIXI 全局
  (window as any).PIXI = PIXI;
  const mod: any = await import("pixi-live2d-display/cubism2");
  engineCache = { PIXI, Live2DModel: mod.Live2DModel };
  return engineCache;
}

// ---- 工具 ----
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function canLoadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function getCoreModel(): any {
  return model?.internalModel?.coreModel || null;
}

// ---- 尺寸适配（rAF 防抖 + 尺寸钳制，避免拖动面板时渲染异常）----
let fitPending = false;
function scheduleFit(): void {
  if (fitPending) return;
  fitPending = true;
  requestAnimationFrame(() => {
    fitPending = false;
    fitModel();
  });
}

function fitModel(): void {
  if (!app || !model || !attachedEl) return;
  const w = attachedEl.clientWidth;
  const h = attachedEl.clientHeight;
  // 拖动/收起瞬间容器可能为 0 或极小，跳过以免画布/模型异常
  if (!w || !h || w < 24 || h < 24) return;
  // 尺寸未变则跳过（拖拽中避免每帧无谓 resize/闪烁）
  if (w === lastFitW && h === lastFitH) return;
  lastFitW = w;
  lastFitH = h;
  try {
    app.renderer.resize(w, h);
  } catch {}
  if (canvas) {
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  const mw = modelBaseW || 1;
  const mh = modelBaseH || 1;
  let s = Math.min(w / mw, h / mh) * 0.88;
  if (!Number.isFinite(s) || s <= 0) s = 1;
  // 只保留上限钳制（防极小容器比例爆炸）；不要设下限——大纹理模型在窄面板下计算出的
  // 合理缩放会 <0.2，强行抬到 0.2 会让角色超出容器被裁（电脑版"生硬/有极限"根因）
  if (s > 3) s = 3;
  model.scale.set(s, s);
  // 水平居中
  model.x = w / 2;
  if (centerVertically) {
    // 手机沉浸全屏：角色整体垂直居中（避免顶到导航栏/画布顶，人物更居中自然）
    model.y = h / 2 - baseTopOffset * s;
  } else {
    // 默认：让角色可见区顶部留 ~5% 边距（Live2D 角色头部常贴近画布顶，
    // 垂直居中会在小窗如手机 dock 裁头——故 dock/面板用顶部对齐）
    const topMargin = Math.max(4, h * 0.05);
    model.y = topMargin + (mh * s) / 2 - baseTopOffset * s;
  }
  // 安全钳制：角色中心始终保持在画布内（防止拖拽/尺寸异常时角色被“拖到画布外”消失）
  const halfH = (mh * s) / 2;
  if (Number.isFinite(halfH) && halfH > 0) {
    const minCy = halfH * 0.4;
    const maxCy = h - halfH * 0.4;
    if (model.y < minCy) model.y = minCy;
    else if (model.y > maxCy) model.y = maxCy;
  }
}

/** 播放情感对应的模型自带动作（真实动作控制）；返回是否播了动作 */
function playEmotionMotion(emotion: Emotion): boolean {
  if (!model) return false;
  const names = motionNames;
  if (!names) return false;
  const candidates = (EMOTION_MOTIONS[emotion] || []).filter((n) =>
    names.has(n),
  );
  if (!candidates.length || typeof model.motion !== "function") return false;
  // 从可用动作里随机选一个：同一种情绪每次动作不同，避免"只会一个动作"
  const a = candidates[Math.floor(Math.random() * candidates.length)];
  // 强情绪连播第二个不同动作，更生动（neutral 不连播）
  let b: string | null = null;
  if (candidates.length > 1 && emotion !== "neutral") {
    let other = candidates[Math.floor(Math.random() * candidates.length)];
    if (other === a)
      other = candidates[(candidates.indexOf(a) + 1) % candidates.length];
    b = other;
  }
  try {
    model.motion(a).catch(() => {});
    if (b) {
      if (sequenceTimer) clearTimeout(sequenceTimer);
      const target = b;
      sequenceTimer = window.setTimeout(() => {
        sequenceTimer = null;
        try {
          model?.motion(target).catch(() => {});
        } catch {}
      }, 500);
    }
    return true;
  } catch {
    return false;
  }
}

/** 表情（播放动作 + 参数微调 + 自动复位） */
export function setEmotion(emotion: Emotion): void {
  setState({ emotion });
  lastEmotionAt = Date.now();
  if (sequenceTimer) {
    clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
  const core = getCoreModel();
  playEmotionMotion(emotion);
  // 自动复位（thinking 持续到回复结束；wink/neutral 不复位）
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  if (emotion !== "neutral" && emotion !== "wink" && emotion !== "thinking") {
    resetTimer = window.setTimeout(() => {
      resetTimer = null;
      setEmotion("neutral");
    }, 3000);
  }
  if (!core) return; // 参数微调始终执行（配合动作让面部表情更明显，动作+表情叠加更灵动）
  const preset = EMOTION_PRESETS[emotion];
  const entries = Object.entries(preset.params);
  // 只对模型真实存在的参数做表情（防止 setParamFloat 静默失败）
  const params = availableParams;
  const targets = params ? entries.filter(([id]) => params.has(id)) : entries;
  if (targets.length === 0) return;
  const from: Record<string, number> = {};
  for (const [id] of targets) {
    try {
      const v = core.getParamFloat ? core.getParamFloat(id) : 0;
      from[id] = typeof v === "number" && Number.isFinite(v) ? v : 0;
    } catch {
      from[id] = 0;
    }
  }
  const duration = Math.max(120, preset.duration);
  const start = performance.now();
  if (animationId) cancelAnimationFrame(animationId);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const k = easeInOutCubic(t);
    for (const [id, to] of targets) {
      const fromV = from[id] ?? 0;
      try {
        core.setParamFloat(id, fromV + (to - fromV) * k);
      } catch {}
    }
    if (t < 1) {
      animationId = requestAnimationFrame(step);
    } else {
      animationId = 0;
    }
  };
  animationId = requestAnimationFrame(step);
}

export function randomEmotion(): Emotion {
  const list: Emotion[] = [
    "happy",
    "sad",
    "angry",
    "surprised",
    "shy",
    "thinking",
    "sleepy",
    "wink",
  ];
  return list[Math.floor(Math.random() * list.length)];
}

// ---- 模型加载 ----
export async function loadModel(name: string): Promise<void> {
  const clean = (name || "").trim();
  if (!clean) return;
  if (state.status === "loading") return; // 防并发重复
  if (state.status === "ready" && state.modelName === clean) return; // 幂等
  setState({ status: "loading", error: undefined, modelName: clean });
  availableParams = null;
  motionNames = null;
  stopAmbient();
  if (sequenceTimer) {
    clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
  modelBaseW = 1;
  modelBaseH = 1;
  try {
    const { PIXI, Live2DModel } = await ensureEngine();
    // 第三方 model.json 网址 → 走第三方加载；否则 bestdori 模型名
    const settings = /^https?:\/\//i.test(clean)
      ? await fetchThirdPartyModel(clean)
      : buildLive2dSettings(clean, await fetchBuildData(clean));

    // 纹理 404 探测 → 透明 PNG 兜底（防破图）
    const checks = await Promise.all(
      (settings.textures || []).map((u) => canLoadImage(u)),
    );
    let firstValid = TRANSPARENT_PNG_DATA_URL;
    const idx = checks.findIndex(Boolean);
    if (idx >= 0) firstValid = settings.textures[idx];
    settings.textures = (settings.textures || []).map((u, i) =>
      checks[i] ? u : firstValid,
    );

    if (!app) {
      canvas = document.createElement("canvas");
      // 用当前容器尺寸初始化，避免 PIXI 默认 800×600 撑爆窄容器（配合容器 min-w-0/overflow-hidden）
      const cw = attachedEl ? Math.max(1, attachedEl.clientWidth) : 1;
      const ch = attachedEl ? Math.max(1, attachedEl.clientHeight) : 1;
      app = new PIXI.Application({
        view: canvas,
        transparent: true,
        antialias: true,
        autoStart: true,
        width: cw,
        height: ch,
        resolution: Math.max(1, window.devicePixelRatio || 1),
        autoDensity: true,
      });
      app.stage.sortableChildren = true;
      if (attachedEl) attachedEl.appendChild(canvas);
    }

    // 旧模型淡出（不“啪”地消失），新模型就绪后再淡入 → 交叉淡化，无突兀空窗
    fadeOutOldModel();
    const m = await Live2DModel.from(settings);
    model = m;
    // 记录基础（未缩放）尺寸：model.width 会随 scale 变化，用它算缩放会产生反馈漂移（拖拽占比出错根因）
    modelBaseW = m.internalModel?.width || m.width || 1;
    modelBaseH = m.internalModel?.height || m.height || 1;
    try {
      m.autoInteract = false;
      m.interactive = false;
    } catch {}
    m.anchor.set(0.5, 0.5);
    // 缓存模型本地边界顶部偏移（拖拽中动作变形不再导致 model.y 跳动闪烁）
    try {
      const b = m.getLocalBounds ? m.getLocalBounds() : null;
      if (b && Number.isFinite(b.top)) baseTopOffset = b.top || 0;
    } catch {
      baseTopOffset = 0;
    }
    lastFitW = 0; // 强制下次 fit 执行（新模型按新尺寸适配）
    lastFitH = 0;
    // 先置透明再加入舞台：避免 addChild 到 fadeModelIn 首帧之间 PIXI 渲染一帧不透明角色（加载完成后闪一下）
    try {
      m.alpha = 0;
    } catch {}
    app.stage.addChild(m);
    // 角色切换/首次加载淡入（不生硬）
    fadeModelIn(m);

    // 禁用自动空闲动作：否则空闲动画每帧覆盖表情参数，表情看不出变化
    try {
      const mm = m?.internalModel?.motionManager;
      if (mm) {
        mm.stopAllMotions?.();
        if (mm.groups) mm.groups.idle = undefined;
      }
    } catch {}
    // 探测模型真实存在的表情参数（Cubism2 getParamIndex），表情只作用于存在的参数
    try {
      const core = m?.internalModel?.coreModel;
      if (core && typeof core.getParamIndex === "function") {
        const set = new Set<string>();
        for (const p of Object.values(EMOTION_PRESETS)) {
          for (const id of Object.keys(p.params)) {
            try {
              if (core.getParamIndex(id) >= 0) set.add(id);
            } catch {}
          }
        }
        availableParams = set;
      }
    } catch {}

    // 记录模型自带动作名（用于情感→动作播放的真实控制）
    motionNames = new Set(Object.keys(settings.motions));

    scheduleFit();
    setState({ status: "ready", error: undefined, modelName: clean });
    startAmbient();
    if (state.emotion !== "neutral") setEmotion(state.emotion);
  } catch (e) {
    setState({
      status: "error",
      error: e instanceof Error ? e.message : "模型加载失败",
    });
  }
}

// ---- 让角色更"活"：眨眼 + 随机小动作（情绪表达中自动让位）----
const AMBIENT_MOTIONS = [
  "idle01",
  "idle02",
  "nod01",
  "nod02",
  "eeto01",
  "jaan01",
  "wink01",
  "niyaniya01",
  "smile01",
  "sing01",
  "bye01",
  "shame01",
];

function startAmbient(): void {
  if (blinkTimer) clearTimeout(blinkTimer);
  if (ambientTimer) clearTimeout(ambientTimer);
  const scheduleBlink = () => {
    blinkTimer = window.setTimeout(
      () => {
        blinkTimer = null;
        blink();
        scheduleBlink();
      },
      2000 + Math.random() * 4000,
    );
  };
  const scheduleMove = () => {
    ambientTimer = window.setTimeout(
      () => {
        ambientTimer = null;
        playAmbientMotion();
        scheduleMove();
      },
      3000 + Math.random() * 4000, // 3~7s 一个随机小动作，更活泼灵动
    );
  };
  scheduleBlink();
  scheduleMove();
}

function stopAmbient(): void {
  if (blinkTimer) clearTimeout(blinkTimer);
  if (ambientTimer) clearTimeout(ambientTimer);
  blinkTimer = null;
  ambientTimer = null;
  if (blinkId) cancelAnimationFrame(blinkId);
  blinkId = 0;
}

/** 快速眨眼（ParamEyeLOpen/ParamEyeROpen 1→0→1），模型有眼睛参数才做 */
function blink(): void {
  if (!attachedEl) return; // 不在视野内不眨眼
  const core = getCoreModel();
  if (!core || !availableParams) return;
  const hasL = availableParams.has("ParamEyeLOpen");
  const hasR = availableParams.has("ParamEyeROpen");
  if (!hasL && !hasR) return;
  const getV = (id: string): number => {
    try {
      const v = core.getParamFloat ? core.getParamFloat(id) : 1;
      return typeof v === "number" && Number.isFinite(v) ? v : 1;
    } catch {
      return 1;
    }
  };
  const fromL = hasL ? getV("ParamEyeLOpen") : 1;
  const fromR = hasR ? getV("ParamEyeROpen") : 1;
  const dur = 180;
  const start = performance.now();
  if (blinkId) cancelAnimationFrame(blinkId);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    const v = t < 0.5 ? 1 - 2 * t : (t - 0.5) * 2; // 1→0→1
    if (hasL) {
      try {
        core.setParamFloat("ParamEyeLOpen", fromL * v);
      } catch {}
    }
    if (hasR) {
      try {
        core.setParamFloat("ParamEyeROpen", fromR * v);
      } catch {}
    }
    if (t < 1) blinkId = requestAnimationFrame(step);
    else blinkId = 0;
  };
  blinkId = requestAnimationFrame(step);
}

/** 情绪空闲时随机播一个小动作（让角色不像木偶） */
function playAmbientMotion(): void {
  if (!attachedEl || !model) return;
  const names = motionNames;
  if (!names) return;
  if (state.emotion !== "neutral") return; // 情绪表达中不打扰
  if (Date.now() - lastEmotionAt < 2500) return; // 情绪刚复位，给点安静
  const pool = AMBIENT_MOTIONS.filter((n) => names.has(n));
  if (!pool.length) return;
  // 避免连续两次同一个动作（看起来只会一个动作）
  let name = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && name === lastAmbientMotion) {
    name = pool[(pool.indexOf(name) + 1) % pool.length];
  }
  lastAmbientMotion = name;
  try {
    model.motion(name).catch(() => {});
  } catch {}
}

/** 旧模型平滑淡出后销毁（切换角色/重载不突兀）；新模型淡入时两者交叉淡化 */
function fadeOutOldModel(): void {
  if (fadingModel) {
    try {
      app?.stage?.removeChild(fadingModel);
      fadingModel.destroy({ texture: false, baseTexture: false });
    } catch {}
    fadingModel = null;
  }
  if (!model) return;
  const oldM = model;
  model = null; // 先摘引用，避免淡出期间被误用/二次销毁
  fadingModel = oldM;
  const start = performance.now();
  const DURATION = 240;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    try {
      oldM.alpha = Math.max(0, 1 - t);
    } catch {}
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      try {
        app?.stage?.removeChild(oldM);
        oldM.destroy({ texture: false, baseTexture: false });
      } catch {}
      if (fadingModel === oldM) fadingModel = null;
    }
  };
  requestAnimationFrame(step);
}

/** 角色切换/首次加载淡入（alpha 0→1，不生硬） */
function fadeModelIn(m: any): void {
  if (fadeId) cancelAnimationFrame(fadeId);
  const start = performance.now();
  const DURATION = 340;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    const k = 1 - Math.pow(1 - t, 3); // easeOutCubic
    try {
      m.alpha = k;
    } catch {}
    if (t < 1) fadeId = requestAnimationFrame(step);
    else fadeId = 0;
  };
  fadeId = requestAnimationFrame(step);
}

// ---- 挂载 / 卸载 ----
export function attach(container: HTMLElement): void {
  attachedEl = container;
  if (canvas) {
    try {
      container.appendChild(canvas);
    } catch {}
  }
  scheduleFit();
  if (!ro && typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => scheduleFit());
    ro.observe(container);
  }
  startAmbient();
}

export function detach(container: HTMLElement): void {
  if (attachedEl === container) attachedEl = null;
  if (canvas && canvas.parentElement === container) {
    try {
      container.removeChild(canvas);
    } catch {}
  }
  stopAmbient();
}

export function dispose(): void {
  if (ro) {
    try {
      ro.disconnect();
    } catch {}
    ro = null;
  }
  stopAmbient();
  if (animationId) cancelAnimationFrame(animationId);
  if (fadeId) cancelAnimationFrame(fadeId);
  if (sequenceTimer) {
    clearTimeout(sequenceTimer);
    sequenceTimer = null;
  }
  if (resetTimer) clearTimeout(resetTimer);
  if (fadingModel) {
    try {
      app?.stage?.removeChild(fadingModel);
      fadingModel.destroy();
    } catch {}
    fadingModel = null;
  }
  if (model) {
    try {
      model.destroy();
    } catch {}
    model = null;
  }
  if (app) {
    try {
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    } catch {}
    app = null;
  }
  if (canvas) {
    canvas = null;
  }
  attachedEl = null;
  setState({ status: "idle", emotion: "neutral", modelName: "" });
}
