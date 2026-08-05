import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearch } from "../search";

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
