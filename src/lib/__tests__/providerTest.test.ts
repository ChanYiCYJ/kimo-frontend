import { describe, it, expect } from "vitest";
import {
  testModelConnection,
  formatLatency,
  type TestTarget,
} from "../providerTest";

/** 构造可控的 fetch 桩（返回指定 Response） */
function makeFetch(
  res: Response | (() => Response),
  opts?: { throwOnCall?: boolean },
): typeof fetch {
  return (async () => {
    if (opts?.throwOnCall) throw new TypeError("Failed to fetch");
    return typeof res === "function" ? res() : res;
  }) as unknown as typeof fetch;
}

function okResponse(over?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      id: "test",
      choices: [{ message: { role: "assistant", content: "pong" } }],
      ...over,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const deepseekCfg: TestTarget = {
  endpoint: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
};

describe("providerTest · 参数校验", () => {
  it("缺少接口地址", async () => {
    const r = await testModelConnection(
      { endpoint: "", apiKey: "k", model: "m" },
      makeFetch(okResponse()),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("接口地址");
  });
  it("缺少 API Key", async () => {
    const r = await testModelConnection(
      { endpoint: "https://x.com/v1", apiKey: "", model: "m" },
      makeFetch(okResponse()),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("API Key");
  });
  it("缺少模型", async () => {
    const r = await testModelConnection(
      { endpoint: "https://x.com/v1", apiKey: "k", model: "  " },
      makeFetch(okResponse()),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("模型");
  });
});

describe("providerTest · 连接成功", () => {
  it("有效配置返回 ok 且识别服务商/耗时", async () => {
    const r = await testModelConnection(deepseekCfg, makeFetch(okResponse()));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("连接成功");
    expect(r.provider).toBe("deepseek");
    expect(r.model).toBe("deepseek-chat");
    expect(r.latencyMs).toBeTypeOf("number");
  });
  it("Kimi 接口识别为 kimi", async () => {
    const r = await testModelConnection(
      {
        endpoint: "https://api.moonshot.cn/v1",
        apiKey: "sk-kimi",
        model: "kimi-latest",
      },
      makeFetch(okResponse()),
    );
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("kimi");
  });
  it("接口地址尾斜杠被正确拼接", async () => {
    let calledUrl = "";
    const fetchImpl = (async (url: string) => {
      calledUrl = String(url);
      return okResponse();
    }) as unknown as typeof fetch;
    await testModelConnection(
      { ...deepseekCfg, endpoint: "https://api.deepseek.com/v1/" },
      fetchImpl,
    );
    expect(calledUrl).toBe("https://api.deepseek.com/v1/chat/completions");
  });
  it("200 但响应缺少 choices 视为异常", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(200, { id: "x", object: "error" })),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("响应格式异常");
  });
  it("200 但返回非 JSON 视为异常", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(
        new Response("<html>gateway</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("响应格式异常");
  });
});

describe("providerTest · 各类 HTTP 错误", () => {
  it("401 认证失败", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(401, { error: { message: "invalid key" } })),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("认证失败");
  });
  it("403 认证失败", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(403, {})),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("认证失败");
  });
  it("404 接口/模型不存在", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(404, {})),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("404");
  });
  it("429 频率/额度不足", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(429, {})),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("429");
  });
  it("400 请求被拒绝（含错误详情）", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(400, { error: { message: "model not found" } })),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("400");
    expect(r.message).toContain("model not found");
  });
  it("5xx 服务端错误", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(jsonResponse(502, {})),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("服务端错误");
  });
});

describe("providerTest · 网络异常", () => {
  it("fetch 抛出时返回网络错误", async () => {
    const r = await testModelConnection(
      deepseekCfg,
      makeFetch(okResponse(), { throwOnCall: true }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("网络错误");
  });
});

describe("providerTest · formatLatency", () => {
  it("毫秒与秒格式化", () => {
    expect(formatLatency(320)).toBe("320ms");
    expect(formatLatency(1500)).toBe("1.5s");
  });
  it("空值返回空串", () => {
    expect(formatLatency(undefined)).toBe("");
    expect(formatLatency(null as unknown as number)).toBe("");
  });
});
