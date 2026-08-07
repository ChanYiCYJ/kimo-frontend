import { describe, it, expect, vi, afterEach } from "vitest";
import {
  webSearch,
  readSearchCache,
  writeSearchCache,
  searchBackend,
  detectQueryType,
  detectQueryLang,
  searchAI,
  webSearchToArticle,
} from "../search";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("search · 网络搜索链路", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("优先后端 /api/search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/search")) {
          return jsonResponse([
            {
              title: "后端结果",
              url: "https://a.com",
              description: "后端描述",
            },
          ]);
        }
        return jsonResponse({ query: { pages: {} } });
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("后端结果");
    expect(r).not.toContain("未找到");
  });

  it("后端空时回退 AI 搜索（读取 kimo_ai_bots 配置）", async () => {
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        { endpoint: "https://api.x.com/v1", apiKey: "k", model: "m" },
      ]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("/api/search")) return jsonResponse([]);
        if (u.includes("/chat/completions")) {
          return jsonResponse({
            choices: [
              { message: { content: "- 标题A (https://a.com)\n  描述A" } },
            ],
          });
        }
        return jsonResponse({ query: { pages: {} } });
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("标题A");
    expect(r).not.toContain("未找到");
  });

  it("后端与 AI 空时回退维基（opensearch + 批量简介）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("/api/search")) return jsonResponse([]);
        if (u.includes("action=opensearch")) {
          return jsonResponse([
            "test",
            ["维基条目"],
            ["简短描述"],
            ["https://zh.wikipedia.org/wiki/维基条目"],
          ]);
        }
        if (u.includes("prop=extracts")) {
          return jsonResponse({
            query: {
              pages: { "1": { title: "维基条目", extract: "这是条目简介。" } },
            },
          });
        }
        return jsonResponse([]);
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("维基条目");
    expect(r).toContain("这是条目简介");
    expect(r).not.toContain("未找到");
  });

  it("本地自定义 API（kimo_ai_local_*）也能用于 AI 搜索", async () => {
    localStorage.setItem(
      "kimo_ai_local_3",
      JSON.stringify({
        endpoint: "https://api.y.com/v1",
        apiKey: "k",
        model: "m",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("/api/search")) return jsonResponse([]);
        if (u.includes("/chat/completions")) {
          return jsonResponse({
            choices: [
              {
                message: { content: "- 本地结果 (https://b.com)\n  本地描述" },
              },
            ],
          });
        }
        return jsonResponse({ query: { pages: {} } });
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("本地结果");
  });

  it("全部来源失败时返回未找到提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/search")) return jsonResponse([]);
        return new Response("", { status: 500 });
      }),
    );
    const r = await webSearch("test");
    expect(r).toContain("未找到结果");
  });
});

describe("search · bilibili 站内源短 TTL", () => {
  afterEach(() => {
    localStorage.clear();
  });

  const biliEntry = {
    content: "bilibili 内容",
    article: "",
    sources: [
      {
        title: "B站视频",
        url: "https://www.bilibili.com/video/BV1",
        description: "desc",
        source: "bilibili.com",
        engine: "bilibili",
      },
    ],
    time: 0,
    loading: false,
  };

  it("含 bilibili 来源的缓存超过 30 分钟视为过期", () => {
    // 40 分钟前写入 → bilibili 命中 30min TTL → 过期返回 null
    localStorage.setItem(
      "kimo_search_cache_v1",
      JSON.stringify({
        test: { ...biliEntry, time: Date.now() - 40 * 60 * 1000 },
      }),
    );
    expect(readSearchCache("test")).toBeNull();
  });

  it("含 bilibili 来源的缓存 20 分钟内仍有效", () => {
    localStorage.setItem(
      "kimo_search_cache_v1",
      JSON.stringify({
        test: { ...biliEntry, time: Date.now() - 20 * 60 * 1000 },
      }),
    );
    const r = readSearchCache("test");
    expect(r).not.toBeNull();
    expect(r?.cached).toBe(true);
  });

  it("非 bilibili 来源保持 6h TTL（40 分钟仍有效）", () => {
    const entry = {
      ...biliEntry,
      sources: [
        {
          title: "普通站",
          url: "https://example.com/a",
          description: "desc",
          source: "example.com",
          engine: "backend",
        },
      ],
    };
    localStorage.setItem(
      "kimo_search_cache_v1",
      JSON.stringify({
        test: { ...entry, time: Date.now() - 40 * 60 * 1000 },
      }),
    );
    const r = readSearchCache("test");
    expect(r).not.toBeNull();
    expect(r?.cached).toBe(true);
  });

  it("writeSearchCache 写入后同查询可命中（含 loading 标记）", () => {
    writeSearchCache("query", {
      content: "半成品",
      sources: [
        {
          title: "B站",
          url: "https://www.bilibili.com/video/BV2",
          description: "",
          source: "bilibili.com",
          engine: "bilibili",
        },
      ],
      loading: true,
    });
    const r = readSearchCache("query");
    expect(r?.loading).toBe(true);
  });
});

describe("search · 缓存卡死恢复（loading 永不过期 bug）", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("loading 卡死超过 5 分钟 → readSearchCache 返回 null（允许重新搜索）", () => {
    writeSearchCache("kw", { loading: true });
    // 手动改造成 6 分钟前开始
    const map = JSON.parse(
      localStorage.getItem("kimo_search_cache_v1") || "{}",
    );
    map["kw"] = { ...map["kw"], loadingAt: Date.now() - 6 * 60 * 1000 };
    localStorage.setItem("kimo_search_cache_v1", JSON.stringify(map));
    expect(readSearchCache("kw")).toBeNull();
    expect(localStorage.getItem("kimo_search_cache_v1")).not.toContain('"kw"');
  });

  it("刚进入 loading 的条目仍返回 loading（并发去重）", () => {
    writeSearchCache("kw", { loading: true });
    const r = readSearchCache("kw");
    expect(r?.loading).toBe(true);
  });

  it("writeSearchCache 进入 loading 记录 loadingAt，完成时清除", () => {
    writeSearchCache("kw", { loading: true });
    let map = JSON.parse(localStorage.getItem("kimo_search_cache_v1") || "{}");
    expect(map["kw"].loadingAt).toBeTypeOf("number");
    writeSearchCache("kw", { loading: false, content: "x" });
    map = JSON.parse(localStorage.getItem("kimo_search_cache_v1") || "{}");
    expect(map["kw"].loadingAt).toBeUndefined();
    expect(map["kw"].loading).toBe(false);
  });
});

describe("search · 查询类型/语言检测", () => {
  it("天气查询", () => {
    expect(detectQueryType("北京今天天气").weather).toBe(true);
    expect(detectQueryType("北京今天天气").fresh).toBe(true);
    expect(detectQueryType("上海明天会下雨吗").fresh).toBe(true);
  });
  it("新番查询", () => {
    const t = detectQueryType("2026年7月新番");
    expect(t.anime).toBe(true);
    expect(t.fresh).toBe(true);
  });
  it("新闻查询", () => {
    const t = detectQueryType("今日科技新闻");
    expect(t.news).toBe(true);
    expect(t.fresh).toBe(true);
  });
  it("普通查询非 fresh", () => {
    const t = detectQueryType("React 生命周期");
    expect(t.fresh).toBe(false);
    expect(t.weather).toBe(false);
    expect(t.anime).toBe(false);
  });
  it("语言检测（含多语言 ja/ko）", () => {
    expect(detectQueryLang("北京天气")).toBe("zh");
    expect(detectQueryLang("latest iphone")).toBe("en");
    expect(detectQueryLang("新番 anime 2026")).toBe("zh");
    // 日文假名 → ja
    expect(detectQueryLang("2026年夏アニメ 一覧")).toBe("ja");
    expect(detectQueryLang("アニメ 新作 2026")).toBe("ja");
    // 韩文谚文 → ko
    expect(detectQueryLang("2026년 여름 신작 애니메이션")).toBe("ko");
    expect(detectQueryLang("Roselia 멤버")).toBe("ko");
    // 中英混合仍主要判 zh
    expect(detectQueryLang("2026年7月新番 anime lineup")).toBe("zh");
  });
});

describe("search · searchBackend 按类型/语言/Fast 传参", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("天气查询 → engines=weather + lang=zh", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    await searchBackend("北京今天天气", 4);
    expect(calls[0]).toContain("/api/search");
    expect(calls[0]).toContain("engines=weather");
    expect(calls[0]).toContain("lang=zh");
  });

  it("新番查询 → engines=bangumi", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    await searchBackend("2026年7月新番", 4);
    expect(calls[0]).toContain("engines=bangumi");
  });

  it("英文新闻 → engines 含 googlenews + lang=en", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    await searchBackend("latest AI news", 4);
    expect(calls[0]).toContain("engines=googlenews");
    expect(calls[0]).toContain("lang=en");
  });

  it("Fast 模式 → 精简引擎 + fast=1", async () => {
    localStorage.setItem("kimo_ai_search_speed", "fast");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    await searchBackend("react hooks", 4);
    expect(calls[0]).toContain("fast=1");
    expect(calls[0]).toContain("engines=duckduckgo");
  });

  it("日文查询 → 多语言双搜索（lang=ja + lang=en）", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    await searchBackend("2026年夏アニメ 一覧", 4);
    // 非英文查询并行搜索主要语言 + 英文，覆盖多语源
    expect(calls.length).toBe(2);
    expect(calls.some((c) => c.includes("lang=ja"))).toBe(true);
    expect(calls.some((c) => c.includes("lang=en"))).toBe(true);
  });

  it("英文查询 → 单次搜索（lang=en）", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return jsonResponse([]);
      }),
    );
    await searchBackend("summer anime lineup", 4);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("lang=en");
  });
});

describe("search · 幻觉抑制（来源约束）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("searchAI 系统提示含「不要编造 URL」，空结果返回 []", async () => {
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        { endpoint: "https://api.x.com/v1", apiKey: "k", model: "m" },
      ]),
    );
    let sysText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/chat/completions")) {
          const body = JSON.parse(String(init?.body || "{}")) as {
            messages?: { role: string; content: string }[];
          };
          sysText = body?.messages?.[0]?.content || "";
          return jsonResponse({ choices: [{ message: { content: "[]" } }] });
        }
        return jsonResponse([]);
      }),
    );
    const res = await searchAI("test", 3);
    expect(res).toEqual([]); // AI 无把握时返回空数组，不编造
    expect(sysText).toContain("绝对不要编造");
    expect(sysText).toContain("返回空数组");
  });

  it("webSearchToArticle 系统提示含来源约束 + 抓取失败标注资料有限", async () => {
    localStorage.setItem(
      "kimo_ai_bots",
      JSON.stringify([
        { endpoint: "https://api.x.com/v1", apiKey: "k", model: "m" },
      ]),
    );
    let capturedSys = "";
    let capturedUser = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.startsWith("/api/search")) {
          return jsonResponse([
            {
              title: "真实来源",
              url: "https://real.com/article",
              description: "desc",
              source: "real.com",
              engine: "backend",
            },
          ]);
        }
        if (u.startsWith("/api/fetch")) {
          // 抓取失败：验证「资料有限」标注（直连也会失败）
          return new Response("fail", { status: 502 });
        }
        if (u.includes("/chat/completions")) {
          const body = JSON.parse(String(init?.body || "{}")) as {
            messages?: { role: string; content: string }[];
          };
          capturedSys = body?.messages?.[0]?.content || "";
          capturedUser = body?.messages?.[1]?.content || "";
          return jsonResponse({
            choices: [{ message: { content: "# 标题\n正文" } }],
          });
        }
        return new Response("fail", { status: 500 });
      }),
    );
    const r = await webSearchToArticle("测试主题", 2);
    expect(r.article).toContain("# 标题");
    expect(capturedSys).toContain("来源约束");
    expect(capturedSys).toContain("资料有限，未能核实");
    // 抓取失败时，userMsg 明确标注「内容抓取失败/资料有限」，避免 AI 当成真实正文编造
    expect(capturedUser).toContain("内容抓取失败或为空");
    expect(capturedUser).toContain("资料有限");
    expect(capturedUser).toContain("请勿编造");
  });
});
