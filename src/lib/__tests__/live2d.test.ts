import { describe, it, expect, beforeEach } from "vitest";
import {
  assetUrl,
  buildDataUrl,
  buildLive2dSettings,
  characterNameOf,
  detectEmotion,
  detectReplyEmotion,
  groupModels,
  loadLive2dModel,
  modelInfo,
  parseCharacters,
  parseEmotionTag,
  parseModelNames,
  resolveLive2dConfig,
  saveLive2dModel,
  stripEmotionTag,
  DEFAULT_LIVE2D_MODEL,
  EMOTION_MOTIONS,
  EMOTIONS,
  LIVE2D_CHARACTERS,
  LIVE2D_MODEL_AUTO,
  addCustomModel,
  getAutoPick,
  absoluteLive2dProxyUrl,
  isThirdPartyModelInput,
  live2dProxyUrl,
  loadCustomModels,
  THIRD_PARTY_DEMO_MODEL,
  randomLive2dModel,
  removeCustomModel,
  resolveLive2dModel,
  saveAutoPick,
  type BuildData,
} from "../live2d";

beforeEach(() => {
  localStorage.clear();
});

const sampleBuildData: BuildData = {
  model: { bundleName: "live2d/chara/001_casual", fileName: "model.moc.bytes" },
  physics: { bundleName: "live2d/chara/001_casual", fileName: "physics.json" },
  textures: [
    { bundleName: "live2d/chara/001_casual", fileName: "texture_00.bytes" },
    { bundleName: "live2d/chara/001_casual", fileName: "texture_01" },
    { bundleName: "live2d/chara/001_casual", fileName: "texture_02.png" },
  ],
  motions: [
    { bundleName: "live2d/chara/001_casual", fileName: "motion/idle.mtn" },
    {
      bundleName: "live2d/chara/001_general",
      fileName: "motion/tap_body.mtn.bytes",
    },
  ],
  expressions: [
    { bundleName: "live2d/chara/001_casual", fileName: "exp01.exp.json" },
  ],
};

describe("live2d · 反代 URL 构造", () => {
  it("model 去掉 .bytes 后缀", () => {
    expect(
      assetUrl(
        { bundleName: "live2d/chara/001_casual", fileName: "model.moc.bytes" },
        "model",
      ),
    ).toBe("/api/live2d/asset/jp/live2d/chara/001_casual_rip/model.moc");
  });

  it("motion 去掉 motion/ 前缀与 .bytes（bestdori 真实 asset 无子目录）", () => {
    expect(
      assetUrl(
        {
          bundleName: "live2d/chara/001_general",
          fileName: "motion/smile01.mtn.bytes",
        },
        "motion",
      ),
    ).toBe("/api/live2d/asset/jp/live2d/chara/001_general_rip/smile01.mtn");
  });

  it("texture .bytes → .png、无扩展名补 .png、保留 .png", () => {
    const base = "live2d/chara/001_casual";
    expect(assetUrl({ bundleName: base, fileName: "t.bytes" }, "texture")).toBe(
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/t.png",
    );
    expect(assetUrl({ bundleName: base, fileName: "t2" }, "texture")).toBe(
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/t2.png",
    );
    expect(assetUrl({ bundleName: base, fileName: "t3.png" }, "texture")).toBe(
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/t3.png",
    );
  });

  it("expression 保留扩展名", () => {
    expect(
      assetUrl(
        { bundleName: "live2d/chara/001_casual", fileName: "exp.exp.json" },
        "expression",
      ),
    ).toBe("/api/live2d/asset/jp/live2d/chara/001_casual_rip/exp.exp.json");
  });

  it("buildDataUrl 指向反代入口", () => {
    expect(buildDataUrl("001_casual")).toBe(
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/buildData.asset",
    );
  });
});

describe("live2d · buildLive2dSettings", () => {
  it("把 BuildData 转成同源绝对 URL settings", () => {
    const s = buildLive2dSettings("001_casual", sampleBuildData);
    expect(s.url).toBe(buildDataUrl("001_casual"));
    expect(s.model).toContain("model.moc");
    expect(s.physics).toContain("physics.json");
    expect(s.textures).toEqual([
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/texture_00.png",
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/texture_01.png",
      "/api/live2d/asset/jp/live2d/chara/001_casual_rip/texture_02.png",
    ]);
  });

  it("motions 以文件名（去扩展）为 key", () => {
    const s = buildLive2dSettings("001_casual", sampleBuildData);
    expect(Object.keys(s.motions)).toEqual(["idle", "tap_body"]);
    // bestdori 真实 asset 无 motion/ 子目录（修复：去掉前缀）
    expect(s.motions.idle?.[0]?.file).toContain("001_casual_rip/idle.mtn");
    expect(s.motions.tap_body?.[0]?.file).toContain(
      "001_general_rip/tap_body.mtn",
    );
  });

  it("expressions 以去掉 .exp.json 的名为 name", () => {
    const s = buildLive2dSettings("001_casual", sampleBuildData);
    expect(s.expressions[0]).toEqual({
      name: "exp01",
      file: "/api/live2d/asset/jp/live2d/chara/001_casual_rip/exp01.exp.json",
    });
  });
});

describe("live2d · detectEmotion 本地规则", () => {
  it("开心", () => expect(detectEmotion("哈哈哈 太开心了")).toBe("happy"));
  it("难过", () => expect(detectEmotion("呜呜 好难过")).toBe("sad"));
  it("生气", () => expect(detectEmotion("气死我了 😡")).toBe("angry"));
  it("惊讶", () => expect(detectEmotion("真的吗？太震惊了")).toBe("surprised"));
  it("害羞", () => expect(detectEmotion("好害羞呀 脸红")).toBe("shy"));
  it("别扭/尴尬 → 害羞", () => {
    expect(detectEmotion("好别扭啊 不知道说什么")).toBe("shy");
    expect(detectEmotion("有点尴尬")).toBe("shy");
  });
  it("困倦", () => expect(detectEmotion("晚安 睡觉了")).toBe("sleepy"));
  it("眨眼", () => expect(detectEmotion("😉")).toBe("wink"));
  it("思考", () =>
    expect(detectEmotion("让我想想 大概是这样")).toBe("thinking"));
  it("普通内容 → neutral", () =>
    expect(detectEmotion("今天天气不错")).toBe("neutral"));
});

describe("live2d · detectReplyEmotion（AI 角色回复情绪，括号表演提示优先）", () => {
  it("括号动作描写优先：吓了一跳 → 惊讶", () => {
    expect(detectReplyEmotion("（突然被吓了一跳，眨眨眼）真的吗？")).toBe(
      "surprised",
    );
  });
  it("括号表演提示优先：声音放软 → 难过（正文开心不误判）", () => {
    expect(
      detectReplyEmotion("（停了停，声音放软了些）不用勉强自己开心起来"),
    ).toBe("sad");
  });
  it("括号：别过脸去 → 害羞", () => {
    expect(
      detectReplyEmotion("（说完别过脸去，声音小了一点）……开玩笑的啦"),
    ).toBe("shy");
  });
  it("无括号时回退整段检测", () => {
    expect(detectReplyEmotion("哈哈 太开心了！")).toBe("happy");
  });
  it("括号表演提示：嘴角翘起 → 开心（正文提到快哭不误判）", () => {
    expect(
      detectReplyEmotion(
        "（偷偷瞄了你一眼，嘴角不自觉地翘起来）看到你现在这么开心，比刚才那副快哭的表情好多了。",
      ),
    ).toBe("happy");
  });
  it("多括号并存且平手：笑出声(happy) 优先于 语气放软(sad)", () => {
    expect(
      detectReplyEmotion(
        "（看你手舞足蹈的样子，忍不住笑出声）（歪了歪头，语气放软）今天真开心！",
      ),
    ).toBe("happy");
  });
});

describe("live2d · 情感动作映射 + 角色名", () => {
  it("每个情绪都有动作候选（真实控制）", () => {
    for (const e of EMOTIONS) {
      expect(EMOTION_MOTIONS[e].length).toBeGreaterThan(0);
    }
  });
  it("常见情绪映射到 bestdori 自带动作名", () => {
    expect(EMOTION_MOTIONS.happy).toContain("smile01");
    expect(EMOTION_MOTIONS.angry).toContain("angry01");
    expect(EMOTION_MOTIONS.sad).toContain("sad01");
    expect(EMOTION_MOTIONS.neutral).toContain("idle01");
  });
  it("characterNameOf 已知角色返回名字，未知回退模型名", () => {
    expect(characterNameOf("001_casual")).toBe("户山 香澄");
    expect(characterNameOf("021_casual")).toBe("凑 友希那");
    expect(characterNameOf("999_weird")).toBe("999_weird");
  });
});

describe("live2d · auto 随机角色", () => {
  it("randomLive2dModel 总是返回精选角色列表里的模型", () => {
    for (let i = 0; i < 50; i++) {
      const m = randomLive2dModel();
      expect(LIVE2D_CHARACTERS.some((c) => c.model === m)).toBe(true);
    }
  });
  it("resolveLive2dModel: 本地 auto → 随机精选角色", () => {
    saveLive2dModel(LIVE2D_MODEL_AUTO);
    const m = resolveLive2dModel("011_casual");
    expect(LIVE2D_CHARACTERS.some((c) => c.model === m)).toBe(true);
  });
  it("resolveLive2dModel: 本地指定优先于站点默认", () => {
    saveLive2dModel("011_casual");
    expect(resolveLive2dModel("001_casual")).toBe("011_casual");
  });
  it("resolveLive2dModel: 无本地 → 站点默认 → 内置默认", () => {
    expect(resolveLive2dModel("015_casual")).toBe("015_casual");
    expect(resolveLive2dModel("")).toBe(DEFAULT_LIVE2D_MODEL);
  });
  it("auto 模式优先用最近 AI 选角缓存", () => {
    saveLive2dModel(LIVE2D_MODEL_AUTO);
    saveAutoPick("021_casual");
    expect(getAutoPick()?.model).toBe("021_casual");
    expect(resolveLive2dModel("001_casual")).toBe("021_casual");
  });
  it("auto 模式无缓存时回退随机精选角色", () => {
    saveLive2dModel(LIVE2D_MODEL_AUTO);
    const m = resolveLive2dModel("001_casual");
    expect(LIVE2D_CHARACTERS.some((c) => c.model === m)).toBe(true);
  });
});

describe("live2d · AI 表情标签（AI Chat 控制表情）", () => {
  it("解析 [表情:开心] 标签", () => {
    expect(parseEmotionTag("好的呢～[表情:开心]")).toBe("happy");
    expect(parseEmotionTag("不行！[表情:生气]")).toBe("angry");
  });
  it("解析 [EMOTION:难过] 标签（英文别名）", () => {
    expect(parseEmotionTag("嗯…[EMOTION:难过]")).toBe("sad");
  });
  it("无标签 → null", () => {
    expect(parseEmotionTag("好的，我来帮你")).toBeNull();
  });
  it("剥离标签保留正文", () => {
    expect(stripEmotionTag("好的呢～[表情:开心]")).toBe("好的呢～");
    expect(stripEmotionTag("不行！[EMOTION:生气]")).toBe("不行！");
    expect(stripEmotionTag("没有标签的正文")).toBe("没有标签的正文");
  });
  it("非法名称标签不解析但会被剥离", () => {
    expect(parseEmotionTag("[表情:狂喜]")).toBeNull();
    expect(stripEmotionTag("正文[表情:狂喜]")).toBe("正文");
  });
  it("中文括号标签：解析别名（别扭→害羞）并剥离", () => {
    expect(parseEmotionTag("好的【表情:别扭】")).toBe("shy");
    expect(parseEmotionTag("哈哈【表情:高兴】")).toBe("happy");
    expect(stripEmotionTag("好的【表情:别扭】")).toBe("好的");
    expect(stripEmotionTag("正文【EMOTION:开心】结尾")).toBe("正文结尾");
  });
});

describe("live2d · 模型名解析", () => {
  it("parseModelNames 只取 NNN_* 角色服装，排除 live_event_/bili_/general", () => {
    const idx = {
      live2d: {
        chara: {
          "001_casual": {},
          "011_casual": {},
          live_event_123: {},
          bili_9_abc: {},
          general: {},
          "bad-name": {},
        },
      },
    };
    expect(parseModelNames(idx)).toEqual(["001_casual", "011_casual"]);
  });

  it("modelInfo 拆分 characterId / costume", () => {
    expect(modelInfo("011_casual")).toEqual({
      modelName: "011_casual",
      characterId: "011",
      costume: "casual",
    });
    expect(modelInfo("custom").characterId).toBe("");
  });

  it("parseCharacters 取多语言名字第一个非空", () => {
    const chars = {
      "1": { characterName: ["", "Kasumi", "香澄"] },
      "11": { characterName: ["こころ", "Kokoro"] },
    };
    const map = parseCharacters(chars);
    expect(map.get("1")).toBe("Kasumi");
    expect(map.get("11")).toBe("こころ");
  });

  it("parseCharacters 优先简体中文（index 3）", () => {
    const chars = {
      "1": {
        characterName: ["戸山 香澄", "Kasumi Toyama", "戶山 香澄", "户山 香澄"],
      },
    };
    expect(parseCharacters(chars).get("1")).toBe("户山 香澄");
  });

  it("groupModels 按角色分组并带名字", () => {
    const groups = groupModels(
      ["001_casual", "001_blooming", "011_casual"],
      new Map([
        ["001", "香澄"],
        ["011", "心"],
      ]),
    );
    expect(groups).toHaveLength(2);
    const kasumi = groups.find((g) => g.characterId === "001");
    expect(kasumi?.characterName).toBe("香澄");
    expect(kasumi?.models).toEqual(["001_casual", "001_blooming"]);
  });

  it("groupModels 兼容 chars 接口非补零 key（1/11）", () => {
    const groups = groupModels(
      ["001_casual", "011_casual"],
      new Map([
        ["1", "户山 香澄"],
        ["11", "弦卷心"],
      ]),
    );
    const kasumi = groups.find((g) => g.characterId === "001");
    expect(kasumi?.characterName).toBe("户山 香澄");
    const kokoro = groups.find((g) => g.characterId === "011");
    expect(kokoro?.characterName).toBe("弦卷心");
  });

  it("groupModels 未知角色回退 角色{id}", () => {
    const groups = groupModels(["999_casual"], new Map());
    expect(groups[0].characterName).toBe("角色 999");
  });
});

describe("live2d · 本地选择 + 站点配置", () => {
  it("save/load 模型名", () => {
    expect(loadLive2dModel()).toBe("");
    saveLive2dModel("011_casual");
    expect(loadLive2dModel()).toBe("011_casual");
  });

  it("resolveLive2dConfig：enabled 解析 + 默认模型回退", () => {
    expect(resolveLive2dConfig({})).toEqual({
      enabled: true,
      model: DEFAULT_LIVE2D_MODEL,
    });
    expect(
      resolveLive2dConfig({ live2d_enable: "0", live2d_model: "011_casual" }),
    ).toEqual({ enabled: false, model: "011_casual" });
    expect(
      resolveLive2dConfig({ live2d_enable: "0", live2d_model: "  " }),
    ).toEqual({ enabled: false, model: DEFAULT_LIVE2D_MODEL });
  });
});

describe("live2d · 第三方模型导入", () => {
  it("isThirdPartyModelInput 识别网址/路径/.json，模型名不算", () => {
    expect(isThirdPartyModelInput("https://example.com/model/model.json")).toBe(
      true,
    );
    expect(isThirdPartyModelInput("https://a.com/moc/model.json")).toBe(true);
    expect(isThirdPartyModelInput("026_casual")).toBe(false);
    expect(isThirdPartyModelInput("001_summer")).toBe(false);
  });

  it("THIRD_PARTY_DEMO_MODEL 内嵌第三方示例来源（可识别为第三方输入）", () => {
    expect(THIRD_PARTY_DEMO_MODEL).toContain("http");
    expect(THIRD_PARTY_DEMO_MODEL.endsWith(".model.json")).toBe(true);
    expect(isThirdPartyModelInput(THIRD_PARTY_DEMO_MODEL)).toBe(true);
  });

  it("live2dProxyUrl 构造通用代理 URL", () => {
    expect(live2dProxyUrl("https://example.com/model/model.json")).toBe(
      "/api/live2d/proxy?url=" +
        encodeURIComponent("https://example.com/model/model.json"),
    );
  });

  it("absoluteLive2dProxyUrl 含 origin（防 pixi 基于 model.json base 拼错主机）", () => {
    const u = absoluteLive2dProxyUrl("https://example.com/a.png");
    expect(u).toContain("/api/live2d/proxy?url=");
    expect(u).toContain(encodeURIComponent("https://example.com/a.png"));
    expect(u.startsWith("http://") || u.startsWith("https://")).toBe(true);
  });
});

describe("live2d · 角色分组 + 自定义模型导入", () => {
  it("精选角色按乐队分组（5 队，每队 5 人）", () => {
    const bands = new Set(LIVE2D_CHARACTERS.map((c) => c.band));
    expect(bands.size).toBe(5);
    expect(bands.has("Poppin'Party")).toBe(true);
    expect(bands.has("Roselia")).toBe(true);
    for (const b of bands) {
      expect(LIVE2D_CHARACTERS.filter((c) => c.band === b).length).toBe(5);
    }
  });

  it("add/load/remove 自定义模型（去重 + 持久化）", () => {
    expect(loadCustomModels()).toEqual([]);
    const a = addCustomModel("026_casual");
    expect(a).toEqual([{ model: "026_casual", name: "026_casual" }]);
    // 去重：同名模型只保留一份（且保留新名字）
    const b = addCustomModel("026_casual", "自定义角色");
    expect(b.length).toBe(1);
    expect(b[0].name).toBe("自定义角色");
    expect(loadCustomModels()).toEqual([
      { model: "026_casual", name: "自定义角色" },
    ]);
    // 空值不写入
    addCustomModel("   ");
    expect(loadCustomModels().length).toBe(1);
    // 删除
    const c = removeCustomModel("026_casual");
    expect(c).toEqual([]);
    expect(loadCustomModels()).toEqual([]);
  });
});
