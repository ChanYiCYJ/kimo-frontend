import { describe, it, expect, beforeEach } from "vitest";
import {
  loadChatFontSize,
  saveChatFontSize,
  loadWebSearchOn,
  saveWebSearchOn,
  loadTtsPref,
  saveTtsPref,
  loadMemory,
  saveMemory,
  clearMemory,
  hasLocalApi,
  mergeEffCfg,
  loadCustomModelOn,
  saveCustomModelOn,
} from "../chatSettings";
import type { AIChatConfig } from "../types";
import type { LocalAIConfig } from "../localCfg";

beforeEach(() => {
  localStorage.clear();
});

const baseConfig: AIChatConfig = {
  endpoint: "https://api.example.com/v1",
  apiKey: "site-key",
  model: "gpt-4o",
  botName: "Test Bot",
  systemPrompt: "默认人设",
};

describe("chatSettings · 对话字体", () => {
  it("默认返回 base", () => {
    expect(loadChatFontSize()).toBe("base");
  });
  it("非法值回退 base", () => {
    localStorage.setItem("kimo_ai_fontsize", "xl");
    expect(loadChatFontSize()).toBe("base");
  });
  it("保存后可读取", () => {
    saveChatFontSize("lg");
    expect(loadChatFontSize()).toBe("lg");
  });
});

describe("chatSettings · 网络搜索", () => {
  it("默认关闭", () => {
    expect(loadWebSearchOn()).toBe(false);
  });
  it("开启后持久化", () => {
    saveWebSearchOn(true);
    expect(loadWebSearchOn()).toBe(true);
    expect(localStorage.getItem("kimo_ai_websearch")).toBe("1");
  });
  it("关闭后持久化", () => {
    saveWebSearchOn(true);
    saveWebSearchOn(false);
    expect(loadWebSearchOn()).toBe(false);
  });
});

describe("chatSettings · 自动朗读", () => {
  it("未设置时跟随 config.autoTTS", () => {
    expect(loadTtsPref(false)).toEqual({ set: false, on: false });
    expect(loadTtsPref(true)).toEqual({ set: false, on: true });
  });
  it("用户显式设置后优先于 config.autoTTS", () => {
    saveTtsPref(false);
    expect(loadTtsPref(true)).toEqual({ set: true, on: false });
    saveTtsPref(true);
    expect(loadTtsPref(false)).toEqual({ set: true, on: true });
  });
});

describe("chatSettings · 本机记忆（按 pageId 隔离）", () => {
  it("默认空串", () => {
    expect(loadMemory(1)).toBe("");
  });
  it("保存/读取", () => {
    saveMemory(2, "用户偏好：喜欢简洁回答");
    expect(loadMemory(2)).toBe("用户偏好：喜欢简洁回答");
    // 不影响其他 pageId
    expect(loadMemory(1)).toBe("");
  });
  it("清除", () => {
    saveMemory(2, "x");
    clearMemory(2);
    expect(loadMemory(2)).toBe("");
  });
});

describe("chatSettings · 自定义模型开关", () => {
  it("默认关闭（未设置）", () => {
    expect(loadCustomModelOn()).toBe(false);
  });
  it("开启/关闭持久化", () => {
    saveCustomModelOn(true);
    expect(loadCustomModelOn()).toBe(true);
    expect(localStorage.getItem("kimo_ai_custom_model")).toBe("1");
    saveCustomModelOn(false);
    expect(loadCustomModelOn()).toBe(false);
  });
});

describe("chatSettings · hasLocalApi", () => {
  it("全空为 false", () => {
    expect(hasLocalApi({ endpoint: "", apiKey: "", model: "" })).toBe(false);
  });
  it("任一字段非空为 true", () => {
    expect(hasLocalApi({ endpoint: "https://x", apiKey: "", model: "" })).toBe(
      true,
    );
  });
});

describe("chatSettings · mergeEffCfg", () => {
  it("无本地配置时使用机器人默认", () => {
    const local: LocalAIConfig = { endpoint: "", apiKey: "", model: "" };
    const eff = mergeEffCfg(baseConfig, local);
    expect(eff.endpoint).toBe(baseConfig.endpoint);
    expect(eff.apiKey).toBe(baseConfig.apiKey);
    expect(eff.model).toBe(baseConfig.model);
    expect(eff.systemPrompt).toBe("默认人设");
  });
  it("本地配置覆盖 endpoint/apiKey/model", () => {
    const local: LocalAIConfig = {
      endpoint: "https://local.example.com",
      apiKey: "local-key",
      model: "deepseek",
    };
    const eff = mergeEffCfg(baseConfig, local);
    expect(eff.endpoint).toBe("https://local.example.com");
    expect(eff.apiKey).toBe("local-key");
    expect(eff.model).toBe("deepseek");
  });
  it("本地 prompt 覆盖 systemPrompt", () => {
    const local: LocalAIConfig = {
      endpoint: "",
      apiKey: "",
      model: "",
      prompt: "本机人设",
    };
    expect(mergeEffCfg(baseConfig, local).systemPrompt).toBe("本机人设");
  });
  it("未选人设时 systemPrompt 为默认", () => {
    const local: LocalAIConfig = { endpoint: "", apiKey: "", model: "" };
    const cfg: AIChatConfig = {
      ...baseConfig,
      prompts: [
        { name: "A", systemPrompt: "人设A" },
        { name: "B", systemPrompt: "人设B" },
      ],
    };
    expect(mergeEffCfg(cfg, local, null).systemPrompt).toBe("默认人设");
  });
  it("选中人设时 systemPrompt 被覆盖（本地 prompt 仍优先）", () => {
    const local: LocalAIConfig = { endpoint: "", apiKey: "", model: "" };
    const cfg: AIChatConfig = {
      ...baseConfig,
      prompts: [
        { name: "A", systemPrompt: "人设A" },
        { name: "B", systemPrompt: "人设B" },
      ],
    };
    expect(mergeEffCfg(cfg, local, 1).systemPrompt).toBe("人设B");
    const local2: LocalAIConfig = {
      endpoint: "",
      apiKey: "",
      model: "",
      prompt: "本机人设",
    };
    expect(mergeEffCfg(cfg, local2, 1).systemPrompt).toBe("本机人设");
  });
  it("越界人设索引安全回退默认", () => {
    const local: LocalAIConfig = { endpoint: "", apiKey: "", model: "" };
    const cfg: AIChatConfig = {
      ...baseConfig,
      prompts: [{ name: "A", systemPrompt: "人设A" }],
    };
    expect(mergeEffCfg(cfg, local, 5).systemPrompt).toBe("默认人设");
  });
});
