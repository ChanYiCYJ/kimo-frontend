/**
 * searchPlanner.ts 单测
 * 覆盖：分段拆词 / 关键词增强 / 相关性过滤 / 纠错 / 分段搜索编排 / 定式缓存
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  splitSubQueries,
  enrichKeywords,
  filterRelevant,
  correctQuery,
  searchSegmented,
  applyFeedbackToSearch,
  getPatternScore,
} from "../searchPlanner";

function animeType() {
  return { fresh: true, weather: false, anime: true, news: false };
}

function newsType() {
  return { fresh: true, weather: false, anime: false, news: true };
}

function generalType() {
  return { fresh: false, weather: false, anime: false, news: false };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ======================== splitSubQueries ========================

describe("searchPlanner · splitSubQueries 查询分段", () => {
  it("中文「和」拆分", () => {
    const r = splitSubQueries(
      "React 和 Vue 对比",
      "zh",
      generalType(),
      "standard",
    );
    expect(r.length).toBe(2);
    expect(r[0]).toContain("React");
    expect(r[1]).toContain("Vue");
  });

  it("中文顿号拆分", () => {
    const r = splitSubQueries(
      "苹果、华为、小米",
      "zh",
      generalType(),
      "standard",
    );
    expect(r.length).toBe(3);
  });

  it("「还有」拆分", () => {
    const r = splitSubQueries(
      "Python 还有 Rust 区别",
      "zh",
      generalType(),
      "fast",
    );
    expect(r.length).toBe(2);
    expect(r[0]).toContain("Python");
    expect(r[1]).toContain("Rust");
  });

  it("单主题不拆分", () => {
    const r = splitSubQueries(
      "今天天气怎么样",
      "zh",
      generalType(),
      "standard",
    );
    expect(r).toEqual(["今天天气怎么样"]);
  });

  it("anime 类型分离主标题和季节后缀", () => {
    const r = splitSubQueries(
      "夏日重现 2026年夏アニメ 推荐",
      "ja",
      animeType(),
      "standard",
    );
    expect(r.length).toBe(2);
    expect(r[0]).toBe("夏日重现");
    expect(r[1]).toContain("夏日重现");
    expect(r[1]).toContain("2026年夏アニメ");
  });

  it("fast 上限 2", () => {
    const r = splitSubQueries("A、B、C 和 D", "zh", generalType(), "fast");
    expect(r.length).toBeLessThanOrEqual(2);
  });

  it("空查询返回空", () => {
    expect(splitSubQueries("  ", "zh", generalType(), "standard")).toEqual([]);
  });
});

// ======================== enrichKeywords ========================

describe("searchPlanner · enrichKeywords 关键词增强", () => {
  it("中文查询追加已有英文词", () => {
    const r = enrichKeywords("React 19 新特性", "zh", generalType());
    expect(r).toContain("React 19 新特性");
    expect(r).toContain("React");
  });

  it("日文查询追加拉丁词", () => {
    const r = enrichKeywords("2026夏アニメ anime", "ja", animeType());
    expect(r).toContain("anime");
  });

  it("anime 追加日文关键词块", () => {
    const r = enrichKeywords("千恋万花", "zh", animeType());
    expect(r).toContain("千恋万花");
  });

  it("英文查询不追加", () => {
    const r = enrichKeywords("What is React", "en", generalType());
    expect(r).toBe("What is React");
  });
});

// ======================== filterRelevant ========================

describe("searchPlanner · filterRelevant 相关性过滤", () => {
  it("anime 类型过滤不相关条目", () => {
    const results = [
      {
        title: "夏日重现",
        url: "https://bgm.tv/a",
        description: "",
        source: "bgm.tv",
        engine: "bangumi",
      },
      {
        title: "茶啊二中",
        url: "https://bgm.tv/b",
        description: "",
        source: "bgm.tv",
        engine: "bangumi",
      },
    ];
    const r = filterRelevant(results, "夏日重现", animeType());
    expect(r.length).toBe(1);
    expect(r[0].title).toBe("夏日重现");
  });

  it("列表类查询放行所有", () => {
    const results = [
      {
        title: "夏日重现",
        url: "https://bgm.tv/a",
        description: "",
        source: "bgm.tv",
        engine: "bangumi",
      },
      {
        title: "茶啊二中",
        url: "https://bgm.tv/b",
        description: "",
        source: "bgm.tv",
        engine: "bangumi",
      },
    ];
    const r = filterRelevant(results, "2026年7月新番推荐", animeType());
    expect(r.length).toBe(2);
  });

  it("非 anime 不过滤", () => {
    const results = [
      {
        title: "无关条目",
        url: "https://x.com/a",
        description: "",
        source: "x.com",
        engine: "bing",
      },
    ];
    const r = filterRelevant(results, "React 19", generalType());
    expect(r.length).toBe(1);
  });
});

// ======================== correctQuery ========================

describe("searchPlanner · correctQuery 纠错", () => {
  it("去季节词", () => {
    const r = correctQuery("夏日重现 2026年夏アニメ 推荐", "ja");
    expect(r[0]).toBe("夏日重现");
  });

  it("日文 → 追加 anime", () => {
    const r = correctQuery("夏の夕暮れ", "ja");
    expect(r.some((c) => c.includes("anime"))).toBe(true);
  });

  it("中文 → 追加 search", () => {
    const r = correctQuery("量子计算最新进展", "zh");
    expect(r.some((c) => c.includes("search"))).toBe(true);
  });
});

// ======================== applyFeedbackToSearch & getPatternScore ========================

describe("searchPlanner · 搜索定式缓存", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("初始得分为 0", () => {
    expect(getPatternScore(animeType(), "ja")).toBe(0);
  });

  it("👍 后得分为正", () => {
    applyFeedbackToSearch(animeType(), "ja", 1);
    expect(getPatternScore(animeType(), "ja")).toBe(1);
  });

  it("👎 后得分为负", () => {
    applyFeedbackToSearch(animeType(), "ja", -1);
    expect(getPatternScore(animeType(), "ja")).toBe(-2);
  });

  it("不同类型独立", () => {
    applyFeedbackToSearch(animeType(), "ja", 1);
    expect(getPatternScore(newsType(), "en")).toBe(0);
  });
});

// ======================== searchSegmented ========================

describe("searchPlanner · searchSegmented 编排", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("空查询直接返回", async () => {
    const r = await searchSegmented("  ");
    expect(r.results).toEqual([]);
    expect(r.subQueries).toEqual([]);
  });

  it("基本分段并发搜索", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    const r = await searchSegmented("React 和 Vue 对比", { speed: "standard" });
    // 至少 2 个子查询
    expect(r.subQueries.length).toBeGreaterThanOrEqual(2);
    // 每子查询调了 searchBackend → /api/search
    const searchCalls = calls.filter((c) => c.includes("/api/search"));
    expect(searchCalls.length).toBeGreaterThanOrEqual(r.subQueries.length);
  });

  it("空结果走纠错 + AI 兜底", async () => {
    // searchAI 需要 AI 配置
    localStorage.setItem(
      "kimo_ai_bot_config",
      JSON.stringify({
        endpoint: "https://api.test.com/v1",
        apiKey: "sk-test",
        model: "test-model",
      }),
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("/api/search")) return jsonResponse([]);
        // AI 兜底
        if (String(url).includes("/chat/completions")) {
          return jsonResponse({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      title: "AI 兜底结果",
                      url: "https://example.com",
                      description: "由 AI 生成的兜底结果",
                    },
                  ]),
                },
              },
            ],
          });
        }
        return jsonResponse({});
      }),
    );
    const r = await searchSegmented("罕见词查询 xyzabc", { speed: "fast" });
    // 应有纠错阶段（AI 兜底算纠正）
    expect(r.corrected).toBe(true);
    // 有兜底结果
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].title).toBe("AI 兜底结果");
  });

  it("onProgress 各阶段都有回调", async () => {
    const stages: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    await searchSegmented("test", {
      onProgress: (p) => stages.push(p.stage),
    });
    expect(stages).toContain("thinking");
    expect(stages).toContain("planning");
    expect(stages).toContain("merging");
    expect(stages).toContain("done");
  });
});
