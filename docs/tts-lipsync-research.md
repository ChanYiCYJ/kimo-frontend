# TTS ↔ Live2D 对嘴型：测试方案 + 开源项目调研 + 速度优化

> 调查日期：2026-08-08 ｜ 项目：kimo-frontend（Lumia AI）
> 结论速览：本项目是 **Cubism2**（bestdori 模型 + pixi-live2d-display/cubism2），
> 社区主流的 `live2d-motionsync` 库只支持 **Cubism4 + motionsync3** → **不可直接复用**。
> 在 Cubism2 约束下，Web Audio RMS 波形驱动 `ParamMouthOpenY` 是社区正解（开源同类项目同款方案），
> 本轮**保持现有 RMS 方案**，吸收 AudioBuffer 解码思路优化播放/口型起点，并沉淀自动化测试。

---

## 一、现有实现（已具备的能力）

| 能力         | 位置                                                                                    | 说明                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 真实波形口型 | `src/lib/live2dCore.ts` `speakAudio`（L1255）                                           | `AnalyserNode.getByteTimeDomainData` → RMS → `rmsToMouth()` → 平滑（attack 0.7 / release 0.22 / 说话保持 ≥0.16）→ `setParamFloat` |
| 参数命名兼容 | `MOUTH_PARAMS` = `["ParamMouthOpenY","PARAM_MOUTH_OPEN_Y"]`                             | 邦邦模型真正驱动嘴的是大写命名参数（±1e6 占位参数是坑）                                                                           |
| 口型不被覆盖 | `stopAmbient()` + PIXI.Ticker 后置注册                                                  | ambient motion 每帧会覆盖嘴参数，说话时暂停、结束恢复                                                                             |
| 播放链路     | `AIChat.playTTS`（L2170）→ `resolveTtsAudioUrl`（chatSettings L256）→ `speakAudio(url)` | 每次现算 URL，`<audio>` + `createMediaElementSource` 流式播放                                                                     |
| 后端         | `/api/v1/tts?text={text}&voice=…`（edge-tts 免费，FastAPI）                             | 同源 worker 反代，无 CORS                                                                                                         |

已知短板：①TTS **无缓存**（同文本每次重新合成）②`<audio>`+MediaElementSource **无法预解码**、播放起点不可控 ③口型只能等音频到达后实时跟随（无 viseme 预判）④长回复被 `slice(0,600)` 截断。

---

## 二、开源项目调研

### 2.1 同类 RMS 方案（与当前实现同款 → 佐证正确性）

- **`zhao896632126/Live2d-TTS-Audio-LipSync`**（13★）
  - 思路：**Web Audio API 播放音频实时获取声音分贝值 → 0~1 → 实时调整 `ParamMouthOpenY`（30 次/秒）**
  - 与当前实现几乎完全一致 → 当前方案在 Cubism2 下是社区标准做法，无需推翻。
  - 参考链接：guansss/pixi-live2d-display#78（Web Audio 驱动口型的官方 issue 讨论）。

### 2.2 MotionSync 库（Cubism4 专属，仅参考）

- **`liyao1520/live2d-motionSync`**（102★，MIT）— npm `live2d-motionsync`
  - 封装官方 `CubismMotionSync`；`play(src: string | AudioBuffer)`，**支持 AudioBuffer**（最新版"仅支持 AudioBuffer 解决异步问题"）。
  - ⚠️ **前置条件：仅支持 Cubism 4 模型 + 模型需支持 motionsync3** → 本项目 Cubism2 不可用。
  - **可借鉴点**：AudioBuffer 播放思路（先 decode → `AudioBufferSourceNode` 播放 → 口型第一帧即可同步）。
- **`Maski0/Live2D-lipSync-Pixijs`**（8★）
  - 技术栈 = **PixiJS 6.5 + React + TS + pixi-live2d-display + live2d-motionsync**（与本项目几乎一致），演示单/双模型 Motion Sync。
  - 同样仅 Cubism4 模型（kei_vowels_pro 等 motionsync 模型）。
- **`Ashish-Patnaik/HanaVerse`**（63★）
  - Ollama + Live2D + TTS 聊天 UI；用官方 motionsync3 文件，**仅 Cubism4**。

### 2.3 教训（viseme / 第三方 lip-sync 引擎）

- **`Voine/ChatWaifu_Mobile`**（1.4k★）
  - 接入过 meta-lipSync（Oculus 音频口型），作者明确反馈：**"时长同步/映射等等问题，太过麻烦，目前只是播一个循环动画"**。
  - → 对**实时 TTS** 做 viseme（音素级）口型映射在工程上投入产出比很低，RMS 能量驱动是务实选择。

### 2.4 流式 / 本地 TTS（调用速度优化参考）

- **`k2-fsa/sherpa-onnx`**（14k★，Apache-2.0）
  - 本地离线流式 TTS（VITS / Kokoro / Piper）+ ASR/VAD，支持 WASM / NodeJS / 12 语言绑定。
  - 与当前"edge-tts 后端合成"架构不同；若未来做**完全本地化/流式播放**可参考（当前不引入）。

### 2.5 项目内已引用

- `SoulLink_Live2D`（表情/动作参考，v3 起已用）、`guansss/pixi-live2d-display`（渲染引擎）、`Bestdori`（角色模型）、Live2D Cubism 官方运行时。

### 2.6 调研结论

1. Cubism2 下 **RMS 波形驱动是正解**，现有实现方向正确、参数命名兼容已补齐（决定性修复见 repo memory）。
2. **不升级 Cubism4 / 不引入 motionSync 库**（模型全 bestdori Cubism2，升级风险高、收益低）。
3. 吸收 **AudioBuffer 解码播放**思路（对齐 `@liyao1520` 的 `play(AudioBuffer)`），解决 `<audio>` 播放起点不可控 + 支持 TTS 缓存秒播。
4. 不采用 viseme / 第三方 lip-sync 引擎（ChatWaifu 教训）。

---

## 三、速度优化（本轮落地）

1. **TTS 缓存层**（新增 `src/lib/ttsCache.ts`）
   - `cleanTtsText()`：统一朗读文本清洗（与 playTTS 一致，去标签/Markdown/空白、限长）。
   - `ttsCacheKey()`：文本 + 音色 + URL → 稳定 key（djb2 hash，不存明文文本）。
   - `getTtsAudio()`：命中 IndexedDB → 返回 `ArrayBuffer`（秒播）；未命中 → fetch → 写缓存 → 返回；可注入 storage/fetch 供单测。
   - 内存 Map（blob/ArrayBuffer 会话缓存）+ IndexedDB 持久化（跨会话），LRU 上限 ~50 条。
2. **预合成**（AIChat）：AI 回复流式完成后、TTS 开启时后台 `getTtsAudio` 提前合成写缓存 → 用户点「朗读」即秒播（二次命中 0 网络请求）。
3. **`speakAudioBuffer()`**（live2dCore 新增）：`decodeAudioData` → `AudioBufferSourceNode` → 复用 RMS 口型循环；播放起点精确、口型第一帧同步；`speakAudio(url)` 保留兼容第三方 URL。
4. 防串音：AIChat 用 `ttsPlayRef` token，新朗读/停止使 in-flight 合成作废。

---

## 四、嘴型测试方案（自动化）

### T1 纯函数单测（vitest）

- `rmsToMouth`：静音→0.06、增益单调、封顶满张 1.0（已存在，补边界）。
- 新增 `smoothMouth(prev, rms)` 纯函数（attack/release/hold）：有声快速张嘴、静音缓闭合、说话保持 ≥0.16。
- `ttsCache`：key 稳定/区分音色、命中不请求、未命中请求+写缓存、fetch 失败降级、storage 失败降级、LRU 淘汰。

### T2 浏览器探针（Playwright，验证对嘴型）

- patch `Live2DModelWebGL.prototype.setParamFloat` 记录 `ParamMouthOpenY/PARAM_MOUTH_OPEN_Y` 时间序列。
- `window.__probe` 包装 `AudioContext` 记录 RMS 序列。
- **cross-correlation**：RMS 序列 vs 嘴型参数序列 → 输出**延迟 ms + 相关系数**（对嘴型量化指标，>0.5 视作良好跟随）。
- 合成测试音（正弦/静音交替）验证 attack/release 响应速度。

### T3 端到端（线上实测）

- 真实 edge-tts 播放 → 嘴型幅度/节奏；二次朗读命中缓存（Network 0 请求）。

---

## 五、相关文件

- `src/lib/live2d.ts` — `rmsToMouth`（L611）、新增 `smoothMouth`
- `src/lib/live2dCore.ts` — `speakAudio`（L1255）、新增 `speakAudioBuffer`
- `src/lib/chatSettings.ts` — `resolveTtsAudioUrl`/`buildTtsAudioUrl`/`applyTtsVoice`（L147-266）
- `src/lib/ttsCache.ts` — 新增缓存层
- `src/components/AIChat.tsx` — `playTTS`（L2170）、`testTts`（L1592）、流式完成（L2645）
- 测试：`src/lib/__tests__/ttsCache.test.ts`、`src/lib/__tests__/live2d.test.ts`
