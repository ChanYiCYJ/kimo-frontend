import { describe, it, expect, beforeEach } from "vitest";
import {
  DATA_CATEGORIES,
  DATA_EXPORT_TYPE,
  collectCategoryData,
  exportData,
  importData,
} from "../dataMgr";

beforeEach(() => {
  localStorage.clear();
});

describe("dataMgr · 类别定义", () => {
  it("包含 5 类数据", () => {
    const ids = DATA_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(["kb", "sessions", "web", "aiModel", "live2d"]);
  });
  it("每类都有标签与存储前缀", () => {
    for (const c of DATA_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.prefixes.length).toBeGreaterThan(0);
    }
  });
});

describe("dataMgr · collectCategoryData", () => {
  it("按前缀收集对应键值", () => {
    localStorage.setItem("kimo_kb_entries", '[{"id":"a"}]');
    localStorage.setItem("kimo_chat_sessions_3", "[]");
    localStorage.setItem("kimo_search_cache_v1", "{}");
    localStorage.setItem("kimo_ai_local_3", '{"endpoint":"x"}');
    localStorage.setItem("kimo_live2d_on", "1");
    localStorage.setItem("kimo_ai_net_mode", "auto"); // 不属 kb
    expect(collectCategoryData("kb")).toEqual({
      kimo_kb_entries: '[{"id":"a"}]',
    });
    expect(collectCategoryData("sessions")).toEqual({
      kimo_chat_sessions_3: "[]",
      kimo_ai_net_mode: "auto",
    });
    expect(collectCategoryData("web")).toEqual({
      kimo_search_cache_v1: "{}",
    });
    expect(collectCategoryData("aiModel")).toEqual({
      kimo_ai_local_3: '{"endpoint":"x"}',
    });
    expect(collectCategoryData("live2d")).toEqual({ kimo_live2d_on: "1" });
  });
  it("无关键不被收集", () => {
    localStorage.setItem("kimo_theme", "dark");
    localStorage.setItem("kimo_token", "abc");
    expect(collectCategoryData("kb")).toEqual({});
    expect(collectCategoryData("live2d")).toEqual({});
  });
});

describe("dataMgr · exportData", () => {
  it("导出选中类别为 JSON（含类型标记与数据）", () => {
    localStorage.setItem("kimo_kb_entries", "[]");
    localStorage.setItem("kimo_live2d_model", "001_casual");
    const json = exportData(["kb", "live2d"]);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe(DATA_EXPORT_TYPE);
    expect(parsed.categories.kb).toEqual({ kimo_kb_entries: "[]" });
    expect(parsed.categories.live2d).toEqual({
      kimo_live2d_model: "001_casual",
    });
    // 未选中类别不导出
    expect(parsed.categories.sessions).toBeUndefined();
  });
  it("空数据类别不写入 categories", () => {
    const json = exportData(["kb"]);
    const parsed = JSON.parse(json);
    expect(parsed.categories).toEqual({});
  });
});

describe("dataMgr · importData", () => {
  it("把导出的数据写回 localStorage", () => {
    localStorage.setItem("kimo_kb_entries", "old");
    localStorage.setItem("kimo_live2d_model", "001_casual");
    const json = exportData(["kb", "live2d"]);
    localStorage.clear();
    const r = importData(json);
    expect(r.imported).toContain("kb");
    expect(r.imported).toContain("live2d");
    expect(r.errors).toEqual([]);
    expect(localStorage.getItem("kimo_kb_entries")).toBe("old");
    expect(localStorage.getItem("kimo_live2d_model")).toBe("001_casual");
  });
  it("非 JSON 报格式错误", () => {
    const r = importData("not json{{");
    expect(r.imported).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("非 Kimo 备份文件报格式错误", () => {
    const r = importData(JSON.stringify({ foo: 1 }));
    expect(r.imported).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("忽略未知类别", () => {
    const r = importData(
      JSON.stringify({
        app: "kimo",
        type: DATA_EXPORT_TYPE,
        version: 1,
        categories: { unknown: { x: "1" }, kb: { kimo_kb_entries: "[]" } },
      }),
    );
    expect(r.imported).toEqual(["kb"]);
    expect(localStorage.getItem("kimo_kb_entries")).toBe("[]");
  });
});
