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
  fetchThirdPartyModelSafe,
  parseActionCommands,
  pickTapReaction,
  resolveHitRegion,
  rmsToMouth,
  LOOK_TARGETS,
  type Emotion,
  type LookDirection,
} from "./live2d";
// 低性能设备检测：用于降分辨率/限帧率/流式期间暂停渲染等降级策略
import { isLowPerfDevice } from "./perf";

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
/** 低性能设备（进程内缓存）：创建 PIXI 时决定分辨率/抗锯齿/帧率降级 */
let lowPerf = false;
/** 主线程繁忙（AI 流式生成）时的渲染暂停标记 */
let busy = false;
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
/**
 * 动作优先级（pixi-live2d-display MotionPriority：IDLE=1 / NORMAL=2 / FORCE=3）。
 * 情绪与 AI 动作指令用 FORCE（永不被 ambient 打断）；ambient 随机小动作用 NORMAL
 * （让位给情绪）——避免"点一下角色，眨眼小动作把情绪动作顶掉"的抢播。
 */
const MOTION_PRIORITY_NORMAL = 2;
const MOTION_PRIORITY_FORCE = 3;

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
  // pixi-live2d-display 依赖 window.PIXI 全局
  (window as any).PIXI = PIXI;
  // 注意：默认入口（index，含 cubism2+cubism4）当前在线上渲染为空白（双运行时注册被
  // 树摇/注册时序影响），bestdori 全部为 Cubism2 .moc，故固定用 cubism2 子路径（稳定渲染）。
  // Cubism3/4 加载链路（buildLive2dSettingsFromModel3/fetchThirdPartyModelSafe）已就绪，
  // 待 index bundle 渲染问题解决后可切回：import("pixi-live2d-display")
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
  const mw0 = modelBaseW || 1;
  const mh0 = modelBaseH || 1;
  let mw = mw0;
  let mh = mh0;
  // 基础（未缩放）尺寸异常时（如模型刚就绪 internalModel 尺寸未暴露 → 回落为 1），
  // 用当前显示尺寸反推真实基础尺寸，避免缩放算出微小模型导致"空白"。
  if (mw < 10 || mh < 10) {
    try {
      const sx = model.scale?.x || 1;
      const sy = model.scale?.y || 1;
      if (model.width && model.width > 10 && sx > 0) mw = model.width / sx;
      if (model.height && model.height > 10 && sy > 0) mh = model.height / sy;
      if (mw > 10 && mh > 10) {
        modelBaseW = mw;
        modelBaseH = mh;
      }
    } catch {}
  }
  let s = Math.min(w / mw, h / mh) * 0.88;
  if (!Number.isFinite(s) || s <= 0) s = 1;
  // 只保留上限钳制（防极小容器比例爆炸）；不要设下限——大纹理模型在窄面板下计算出的
  // 合理缩放会 <0.2，强行抬到 0.2 会让角色超出容器被裁（电脑版"生硬/有极限"根因）
  if (s > 3) s = 3;
  model.scale.set(s, s);
  // 水平居中
  model.x = w / 2;
  if (centerVertically) {
    // 手机沉浸全屏：角色主体略偏上居中——底部空间留给浮空对话卡片，
    // 长回复限高滚动时不再遮挡角色脸部/上半身（底部腿部可被卡片覆盖）
    model.y = h * 0.42 - baseTopOffset * s;
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
    // FORCE：情绪动作永不被 ambient（NORMAL）打断
    model.motion(a, 0, MOTION_PRIORITY_FORCE).catch(() => {});
    if (b) {
      if (sequenceTimer) clearTimeout(sequenceTimer);
      const target = b;
      sequenceTimer = window.setTimeout(() => {
        sequenceTimer = null;
        try {
          model?.motion(target, 0, MOTION_PRIORITY_FORCE).catch(() => {});
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
    // 第三方 model.json/model3.json 网址 → 走第三方加载；否则 bestdori 模型名
    const settings = /^https?:\/\//i.test(clean)
      ? await fetchThirdPartyModelSafe(clean)
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
      // 低性能设备降级：分辨率固定 1x（不跟随 devicePixelRatio）+ 关闭抗锯齿，显著降低 GPU/CPU 负载
      lowPerf = isLowPerfDevice();
      app = new PIXI.Application({
        view: canvas,
        transparent: true,
        antialias: !lowPerf,
        autoStart: true,
        width: cw,
        height: ch,
        resolution: lowPerf
          ? 1
          : Math.min(
              Math.max(1, window.devicePixelRatio || 1),
              // 沉浸全屏（centerVertically）钳制 ≤1.5 减 GPU 负载；其余 ≤2x（Retina 足够）
              centerVertically ? 1.5 : 2,
            ),
        autoDensity: true,
      });
      app.stage.sortableChildren = true;
      // 低性能设备限制渲染帧率（30fps 对角色展示足够，减半 GPU 负载）
      if (lowPerf && app.ticker && typeof app.ticker.maxFPS === "number") {
        app.ticker.maxFPS = 30;
      }
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
    // 切换角色/重载时重置用户拖拽旋转（新模型姿态从 0 开始）
    userRot = 0;
    try {
      m.rotation = 0;
    } catch {}
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
    // 后台预取常用动作文件（降低首次播放动作的网络延迟；低性能设备跳过）
    prefetchMotions(settings, motionNames);
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
    // NORMAL：ambient 小动作让位给情绪（FORCE）与 AI 指令（FORCE）
    model.motion(name, 0, MOTION_PRIORITY_NORMAL).catch(() => {});
  } catch {}
}

/**
 * 预取常用动作文件（后台预热浏览器缓存，降低首次播放动作的网络延迟）。
 * 只预取「情绪/环境会用到的」动作；低性能设备跳过（省流量与带宽）。
 */
function prefetchMotions(settings: any, names: Set<string> | null): void {
  try {
    if (!settings?.motions || lowPerf) return;
    const want = new Set<string>();
    for (const arr of Object.values(EMOTION_MOTIONS)) {
      for (const n of arr) want.add(n);
    }
    for (const n of AMBIENT_MOTIONS) want.add(n);
    const urls: string[] = [];
    for (const n of want) {
      if (!names || names.has(n)) {
        const f = settings.motions[n]?.[0]?.file;
        if (f && /^https?:\/\//i.test(f)) urls.push(f);
      }
    }
    // 并发 2 条，逐条 fetch 预热 HTTP 缓存（no-cors 只入缓存不影响功能；失败静默）
    let i = 0;
    const next = () => {
      if (i >= urls.length) return;
      const u = urls[i++];
      try {
        fetch(u, { mode: "no-cors" })
          .catch(() => {})
          .finally(next);
      } catch {
        next();
      }
    };
    for (let k = 0; k < 2 && k < urls.length; k++) next();
  } catch {
    /* 预取失败不影响模型 */
  }
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

// ---- 渲染循环集中控制：页面不可见 / 无容器 / 主线程忙时停 ticker（性能优化）----
// 原先 PIXI ticker 常驻全帧率渲染（切后台/收起面板仍在跑），这里统一收敛：
// ticker 仅在「有 attach 容器 + 页面可见 + 未 busy」时运行。
let documentVisible = true;
let visibilityBound = false;

function syncTicker(): void {
  if (!app?.ticker) return;
  const run = !!attachedEl && documentVisible && !busy;
  try {
    if (run) app.ticker.start();
    else app.ticker.stop();
  } catch {}
}

/** 绑定页面可见性监听（一次即可）：切后台停渲染/动画，回前台恢复 */
function bindVisibility(): void {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    documentVisible = document.visibilityState !== "hidden";
    if (documentVisible) {
      if (attachedEl) {
        startAmbient();
        startGaze();
      }
    } else {
      stopAmbient();
      stopGaze();
    }
    syncTicker();
  });
}

// ---- 点击/触摸交互：命中反应 + 拖拽旋转（参考 pixi-live2d-display hit-testing 与 live2d-widget drag）----
// 不依赖 pixi 的 autoInteract（其 auto-focus 会驱动眼睛注视，与既有 blink/gaze 冲突），
// 改为在 attach 容器上自绑 pointer 事件：
//   - 点按（位移 < 阈值）= tap → 按角色包围盒上下分头/身 → 播反应动作 + 表情
//   - 拖动（位移 ≥ 阈值）= drag → model.rotation 跟随（±MAX_USER_ROT），松开缓动回正
// 桌面鼠标与手机触摸都走 PointerEvent（两端都启用，符合用户确认）。

const TAP_DRAG_THRESHOLD_PX = 8;
/** 拖拽旋转上限（弧度，±25°），避免转得离谱 */
const MAX_USER_ROT = (25 * Math.PI) / 180;
let userRot = 0;
let userRotAnimId = 0;
let pointerActive = false;
let pointerMoved = false;
let pointerStartX = 0;
let pointerStartY = 0;
let lastHitAt = 0;
/** 交互防抖：两次命中反应的最小间隔（ms），防连点刷屏 */
const HIT_DEBOUNCE_MS = 1200;

function onPointerDown(e: PointerEvent): void {
  if (!attachedEl || !model) return;
  pointerActive = true;
  pointerMoved = false;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  if (userRotAnimId) cancelAnimationFrame(userRotAnimId);
  userRotAnimId = 0;
}

function onPointerMove(e: PointerEvent): void {
  if (!pointerActive || !model) return;
  const dx = e.clientX - pointerStartX;
  const dy = e.clientY - pointerStartY;
  const dist = Math.hypot(dx, dy);
  if (!pointerMoved) {
    if (dist < TAP_DRAG_THRESHOLD_PX) return;
    pointerMoved = true; // 超过阈值 → 判定为拖拽（不再算 tap）
  }
  userRot = Math.max(-MAX_USER_ROT, Math.min(MAX_USER_ROT, dx * 0.008));
  try {
    model.rotation = userRot;
  } catch {}
}

function onPointerUp(e: PointerEvent): void {
  if (!pointerActive) return;
  pointerActive = false;
  const wasTap = !pointerMoved;
  pointerMoved = false;
  if (wasTap) {
    handleTap(e.clientX, e.clientY);
  }
  easeRotBack();
}

/** 点按命中：按角色包围盒分头/身 → 反应动作 + 表情（防连点） */
function handleTap(clientX: number, clientY: number): void {
  if (!attachedEl || !model) return;
  const now = performance.now();
  if (now - lastHitAt < HIT_DEBOUNCE_MS) return;
  lastHitAt = now;
  const r = attachedEl.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // 逻辑坐标 == CSS 像素（autoDensity）；model.x/y 即画布内中心
  const px = clientX - r.left;
  const py = clientY - r.top;
  const s = model.scale?.x ?? 1;
  const region = resolveHitRegion(
    px,
    py,
    model.x,
    model.y,
    modelBaseW * s,
    modelBaseH * s,
  );
  if (!region) return;
  const reaction = pickTapReaction(region);
  // setEmotion 会播放对应情绪动作（EMOTION_MOTIONS）——与 TAP_REACTIONS 动作一致，
  // 直接复用避免重复播动作；参数表情叠加由 setEmotion 内部完成。
  setEmotion(reaction.emotion);
}

/** 松开后把旋转缓动回正（spring 感，控制权还给动作播放） */
function easeRotBack(): void {
  if (userRotAnimId) cancelAnimationFrame(userRotAnimId);
  const from = userRot;
  if (Math.abs(from) < 0.001) return;
  const start = performance.now();
  const DURATION = 500;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    const k = 1 - Math.pow(1 - t, 3); // easeOutCubic
    userRot = from * (1 - k);
    try {
      if (model) model.rotation = userRot;
    } catch {}
    if (t < 1) userRotAnimId = requestAnimationFrame(step);
    else userRotAnimId = 0;
  };
  userRotAnimId = requestAnimationFrame(step);
}

function setupInteraction(): void {
  if (!attachedEl) return;
  attachedEl.addEventListener("pointerdown", onPointerDown);
  attachedEl.addEventListener("pointermove", onPointerMove);
  attachedEl.addEventListener("pointerup", onPointerUp);
  attachedEl.addEventListener("pointercancel", onPointerUp);
}

function teardownInteraction(): void {
  if (!attachedEl) return;
  attachedEl.removeEventListener("pointerdown", onPointerDown);
  attachedEl.removeEventListener("pointermove", onPointerMove);
  attachedEl.removeEventListener("pointerup", onPointerUp);
  attachedEl.removeEventListener("pointercancel", onPointerUp);
  pointerActive = false;
  if (userRotAnimId) cancelAnimationFrame(userRotAnimId);
  userRotAnimId = 0;
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
  bindVisibility();
  setupInteraction();
  startAmbient();
  startGaze();
  syncTicker(); // 有容器 + 可见 + 未 busy → 恢复渲染
}

export function detach(container: HTMLElement): void {
  if (attachedEl === container) attachedEl = null;
  if (canvas && canvas.parentElement === container) {
    try {
      container.removeChild(canvas);
    } catch {}
  }
  stopAmbient();
  stopGaze();
  teardownInteraction();
  syncTicker(); // 无 attach 容器 → 停 PIXI 渲染，避免白耗 GPU
}

/**
 * 主线程繁忙降级（低性能设备在 AI 流式生成期间调用）：
 * 暂停 PIXI 渲染循环与 ambient 小动作，把主线程让给 React 重渲染；结束后恢复。
 * 非低性能设备帧率/分辨率足够，一般不调用，调用也无害。
 */
export function setLive2dBusy(v: boolean): void {
  if (busy === v) return;
  busy = v;
  if (!app) return;
  if (v) {
    stopAmbient();
  } else if (documentVisible && attachedEl) {
    startAmbient();
  }
  syncTicker();
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
  stopSpeaking();
  stopGaze();
  teardownInteraction();
  // 清理音频口型资源（AudioContext/Audio 元素）
  audioEl = null;
  audioAnalyser = null;
  audioEndedCb = null;
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch {}
    audioCtx = null;
  }
  if (cmdAnimId) cancelAnimationFrame(cmdAnimId);
  cmdAnimId = 0;
  if (lookAnimId) cancelAnimationFrame(lookAnimId);
  lookAnimId = 0;
  attachedEl = null;
  setState({ status: "idle", emotion: "neutral", modelName: "" });
}

// ---- AI 动作指令执行（[PARAM:…] / [MOTION:…] / [EXPRESSION:…]）----
// 解析由 live2d.ts 的 parseActionCommands 完成；这里只负责执行：
//   参数 → 平滑插值（独立 cmdAnimId，与表情动画互不打断）
//   动作 → 播模型自带动作（存在才播）
//   表情预设 → 切换（模型有才切）

let cmdAnimId = 0;
/** [LOOK:] 头部视线动画 id（结束时回正） */
let lookAnimId = 0;

function paramExists(core: any, id: string): boolean {
  try {
    return (
      typeof core.getParamIndex === "function" && core.getParamIndex(id) >= 0
    );
  } catch {
    return false;
  }
}

/** 执行 AI 回复里的动作指令（参数/动作/表情预设），无指令则什么都不做 */
export function applyActionCommands(text: string): void {
  const cmds = parseActionCommands(text);
  if (!cmds.params.length && !cmds.motion && !cmds.expression && !cmds.look)
    return;
  // 动作：只播模型真实存在的动作（FORCE 优先级，不被 ambient 打断）
  if (cmds.motion && motionNames?.has(cmds.motion) && model?.motion) {
    try {
      model.motion(cmds.motion, 0, MOTION_PRIORITY_FORCE).catch(() => {});
    } catch {}
  }
  // 表情预设：pixi-live2d-display 的 model.expression(name)
  if (cmds.expression && typeof model?.expression === "function") {
    try {
      model.expression(cmds.expression).catch(() => {});
    } catch {}
  }
  // 视线：驱动 ParamAngleX/Y 短时转头/点头（不打断动作；结束后回正）
  if (cmds.look) {
    applyLook(cmds.look);
  }
  // 参数：平滑插值到目标值（只作用于真实存在的参数）
  const core = getCoreModel();
  if (!core || !cmds.params.length) return;
  const targets = cmds.params.filter((p) => paramExists(core, p.id));
  if (!targets.length) return;
  const from: Record<string, number> = {};
  for (const p of targets) {
    try {
      const v = core.getParamFloat ? core.getParamFloat(p.id) : 0;
      from[p.id] = typeof v === "number" && Number.isFinite(v) ? v : 0;
    } catch {
      from[p.id] = 0;
    }
  }
  const duration = 420;
  const start = performance.now();
  if (cmdAnimId) cancelAnimationFrame(cmdAnimId);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const k = easeInOutCubic(t);
    for (const p of targets) {
      const f = from[p.id] ?? 0;
      try {
        core.setParamFloat(p.id, f + (p.value - f) * k);
      } catch {}
    }
    if (t < 1) cmdAnimId = requestAnimationFrame(step);
    else cmdAnimId = 0;
  };
  cmdAnimId = requestAnimationFrame(step);
}

/** 视线指令执行：ParamAngleX/Y 平滑转到位 → 保持 ~900ms → 缓动回正（不打断动作/表情） */
function applyLook(dir: LookDirection): void {
  const core = getCoreModel();
  if (!core) return;
  const hasX = paramExists(core, "ParamAngleX");
  const hasY = paramExists(core, "ParamAngleY");
  if (!hasX && !hasY) return;
  const target = LOOK_TARGETS[dir] || LOOK_TARGETS.center;
  if (lookAnimId) cancelAnimationFrame(lookAnimId);
  const EASE = 260;
  const HOLD = 900;
  const BACK = 360;
  const read = (id: string): number => {
    try {
      const v = core.getParamFloat ? core.getParamFloat(id) : 0;
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  };
  const fromX = hasX ? read("ParamAngleX") : 0;
  const fromY = hasY ? read("ParamAngleY") : 0;
  const start = performance.now();
  const step = (now: number) => {
    const el = now - start;
    // 阶段一：ease 到目标；阶段二：保持；阶段三：回正
    let x = fromX;
    let y = fromY;
    if (el < EASE) {
      const k = easeInOutCubic(el / EASE);
      x = fromX + (target.x - fromX) * k;
      y = fromY + (target.y - fromY) * k;
    } else if (el < EASE + HOLD) {
      x = target.x;
      y = target.y;
    } else if (el < EASE + HOLD + BACK) {
      const k = easeInOutCubic((el - EASE - HOLD) / BACK);
      x = target.x * (1 - k);
      y = target.y * (1 - k);
    } else {
      lookAnimId = 0;
      x = 0;
      y = 0;
    }
    if (hasX) {
      try {
        core.setParamFloat("ParamAngleX", x);
      } catch {}
    }
    if (hasY) {
      try {
        core.setParamFloat("ParamAngleY", y);
      } catch {}
    }
    if (lookAnimId !== 0) lookAnimId = requestAnimationFrame(step);
  };
  lookAnimId = requestAnimationFrame(step);
}

// ---- 口型同步（文本/时长驱动 ParamMouthOpenY，TTS 播放时嘴部跟着动）----
// 浏览器内置 speechSynthesis 无音频流可分析，故用「时长估算 + 随机音节节奏」驱动：
//   每 ~180ms 切换一个嘴张目标（0~0.55 随机），平滑逼近 → 有自然说话感。
// 未来接入真实 TTS URL 音频时，可在 speakAudio(url) 里用 Web Audio API 的 RMS 驱动。

let lipSyncId = 0;
let lipSyncUntil = 0;
const MOUTH_PARAM = "ParamMouthOpenY";

/** 估算中文文本说话时长（ms）：每字 ~220ms + 基础 600ms，上限 30s */
export function estimateSpeakDuration(text: string): number {
  const len = (text || "").length;
  if (len <= 0) return 1200;
  return Math.max(1200, Math.min(30000, len * 220 + 600));
}

/** 开始口型同步（TTS/朗读开始时调用）；durationMs 缺省按文本估算 */
export function speakText(text: string, durationMs?: number): void {
  stopSpeaking();
  const core = getCoreModel();
  if (!core || !paramExists(core, MOUTH_PARAM)) return;
  const dur =
    durationMs && durationMs > 0
      ? durationMs
      : estimateSpeakDuration(text || "");
  lipSyncUntil = performance.now() + dur;
  let cur = 0;
  let target = 0;
  let lastPick = performance.now();
  const step = (now: number) => {
    if (now >= lipSyncUntil) {
      lipSyncId = 0;
      try {
        core.setParamFloat(MOUTH_PARAM, 0);
      } catch {}
      return;
    }
    // 每 ~180ms 换一个新嘴张目标（模拟音节节奏），平滑逼近 → 自然说话感
    if (now - lastPick > 180) {
      lastPick = now;
      target = Math.random() * 0.55;
    }
    cur += (target - cur) * 0.35;
    try {
      core.setParamFloat(MOUTH_PARAM, cur);
    } catch {}
    lipSyncId = requestAnimationFrame(step);
  };
  lipSyncId = requestAnimationFrame(step);
}

/** 停止口型同步并复位嘴部 */
export function stopSpeaking(): void {
  if (lipSyncId) cancelAnimationFrame(lipSyncId);
  lipSyncId = 0;
  lipSyncUntil = 0;
  stopAudioLipSync();
  const core = getCoreModel();
  if (core) {
    try {
      core.setParamFloat(MOUTH_PARAM, 0);
    } catch {}
  }
}

// ---- 真实音频口型同步（Web Audio AnalyserNode 波形 RMS 驱动，参考官方 MotionSync 思路 + l2d 的 RMS 方案）----
// 与 speakText（文本时长估算）不同：这里拿「可播放的音频 URL」用波形实时驱动 ParamMouthOpenY，
// 嘴部随真实声音节奏开合，比固定节奏更自然。无音频源时 AIChat 仍走 speechSynthesis + speakText 回退。

let audioCtx: AudioContext | null = null;
let audioEl: HTMLAudioElement | null = null;
let audioAnalyser: AnalyserNode | null = null;
let lipSyncAudioId = 0;
let audioEndedCb: (() => void) | null = null;

function stopAudioLipSync(): void {
  if (lipSyncAudioId) cancelAnimationFrame(lipSyncAudioId);
  lipSyncAudioId = 0;
  if (audioEl) {
    try {
      audioEl.onended = null;
      audioEl.pause();
    } catch {}
  }
  // 保留 audioCtx 供下次复用；仅断开分析器引用
  audioAnalyser = null;
  audioEndedCb = null;
}

/**
 * 播放音频并用真实波形驱动口型（Web Audio AnalyserNode RMS → ParamMouthOpenY）。
 * @param url 音频 URL（同源 / 经 worker 代理均可）
 * @param opts.volume 音量 0~1（默认 1）
 * @param opts.onEnd 播放结束回调（AIChat 用来收尾/清状态）
 * @returns 是否成功进入真实音频口型（模型无口型参数时仍播放声音但返回 false）
 */
export function speakAudio(
  url: string,
  opts?: { volume?: number; onEnd?: () => void },
): boolean {
  stopSpeaking();
  if (!url) return false;
  try {
    if (!audioCtx) {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return false;
      audioCtx = new AC();
    }
    audioEl = new Audio();
    audioEl.src = url;
    audioEl.volume = Math.max(0, Math.min(1, opts?.volume ?? 1));
    // 每个 audio 元素只能 createMediaElementSource 一次（本次新建元素 → 新建 source+analyser）
    // 注意：一旦走 MediaElementSource，该元素音频只从 Web Audio 图输出 → 必须 connect(destination)
    const source = audioCtx.createMediaElementSource(audioEl);
    audioAnalyser = audioCtx.createAnalyser();
    audioAnalyser.fftSize = 512;
    source.connect(audioAnalyser);
    audioAnalyser.connect(audioCtx.destination);
    audioEndedCb = opts?.onEnd || null;
    audioEl.onended = () => {
      stopSpeaking();
      const cb = audioEndedCb;
      audioEndedCb = null;
      cb?.();
    };
    // 口型参数存在才跑波形循环；不存在则纯播放声音
    const core = getCoreModel();
    const hasMouth = !!core && paramExists(core, MOUTH_PARAM);
    const data = new Uint8Array(audioAnalyser?.fftSize || 512);
    const step = () => {
      if (!audioEl || audioEl.paused || audioEl.ended || !audioAnalyser) {
        lipSyncAudioId = 0;
        return;
      }
      audioAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      if (hasMouth) {
        const rms = Math.sqrt(sum / data.length);
        try {
          core.setParamFloat(MOUTH_PARAM, rmsToMouth(rms));
        } catch {}
      }
      lipSyncAudioId = requestAnimationFrame(step);
    };
    lipSyncAudioId = requestAnimationFrame(step);
    audioEl.play().catch(() => {});
    return hasMouth;
  } catch {
    return false;
  }
}

// ---- 鼠标凝视（桌面：角色头部/身体跟随鼠标，更"活"）----
// 只驱动 ParamAngleX/ParamAngleY（头/身体角度），不碰眼睛（避免与眨眼/表情冲突）。
// 低性能设备跳过；attach 时绑定容器 mousemove，detach/dispose 解除。

let gazeEl: HTMLElement | null = null;
let gazeId = 0;
let gazeTarget = { x: 0, y: 0 };
let gazeCur = { x: 0, y: 0 };
let gazeLastMove = 0;
/** 鼠标静止超过该时长后停止凝视驱动（回正角度，避免持续覆盖动作播放的角度参数） */
const GAZE_IDLE_MS = 2000;

function onGazeMove(e: MouseEvent): void {
  const el = attachedEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
  gazeTarget = {
    x: Math.max(-1, Math.min(1, nx)),
    y: Math.max(-1, Math.min(1, ny)),
  };
  gazeLastMove = performance.now();
  // 静止期间循环已停 → 鼠标再动时重启
  if (!gazeId) gazeId = requestAnimationFrame(gazeStep);
}

function gazeStep(): void {
  if (performance.now() - gazeLastMove > GAZE_IDLE_MS) {
    // 静止超时：停止循环并回正（把控制权还给动作播放）
    gazeId = 0;
    gazeCur = { x: 0, y: 0 };
    const core = getCoreModel();
    if (core) {
      if (paramExists(core, "ParamAngleX")) {
        try {
          core.setParamFloat("ParamAngleX", 0);
        } catch {}
      }
      if (paramExists(core, "ParamAngleY")) {
        try {
          core.setParamFloat("ParamAngleY", 0);
        } catch {}
      }
    }
    return;
  }
  gazeId = requestAnimationFrame(gazeStep);
  const core = getCoreModel();
  if (!core) return;
  gazeCur.x += (gazeTarget.x - gazeCur.x) * 0.08;
  gazeCur.y += (gazeTarget.y - gazeCur.y) * 0.08;
  if (paramExists(core, "ParamAngleX")) {
    try {
      core.setParamFloat("ParamAngleX", gazeCur.x * 18);
    } catch {}
  }
  if (paramExists(core, "ParamAngleY")) {
    try {
      core.setParamFloat("ParamAngleY", gazeCur.y * 14);
    } catch {}
  }
}

function startGaze(): void {
  if (lowPerf) return;
  if (!attachedEl || gazeEl === attachedEl) return;
  stopGaze();
  gazeEl = attachedEl;
  gazeEl.addEventListener("mousemove", onGazeMove);
  gazeCur = { x: 0, y: 0 };
  gazeTarget = { x: 0, y: 0 };
  gazeLastMove = performance.now();
  gazeId = requestAnimationFrame(gazeStep);
}

function stopGaze(): void {
  if (gazeId) cancelAnimationFrame(gazeId);
  gazeId = 0;
  if (gazeEl) {
    try {
      gazeEl.removeEventListener("mousemove", onGazeMove);
    } catch {}
    gazeEl = null;
  }
  gazeTarget = { x: 0, y: 0 };
  gazeCur = { x: 0, y: 0 };
}
