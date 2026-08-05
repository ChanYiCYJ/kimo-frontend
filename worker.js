// ===== Kimo 前端 — Cloudflare Workers 适配脚本 =====
// 职责：
//  1. /api/v1/* 与 /static/* 反代到真实后端（API_BACKEND）
//  2. /api/search 代理搜索请求 → DuckDuckGo Lite（解决浏览器 CORS）
//  3. /api/fetch  代理网页抓取请求 → 目标 URL（解决浏览器 CORS）
//  4. 其余请求交给 Cloudflare Assets 托管 dist 静态资源
//
// 环境变量：
//  - API_BACKEND  后端地址，不带尾部斜杠，例如 https://api.yogofor.top
//
// 本地预览：npx wrangler dev
// 部署：    npm run deploy:cf   （或 npx wrangler deploy）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const backend = (env.API_BACKEND || "").trim().replace(/\/+$/, "");

    // ── 1) 搜索代理：/api/search → 优先转发海外后端（DDG/Bing），失败本地 Wikipedia 兜底 ──
    if (pathname === "/api/search") {
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "8", 10);
      const engines =
        url.searchParams.get("engines") || "bing,duckduckgo,wikipedia";
      if (!query) return new Response("Missing q parameter", { status: 400 });
      const json = (data, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });

      // 1) 转发到海外后端（api.yogofor.top 可访问 DDG/Bing）
      if (backend) {
        try {
          const target =
            backend +
            "/api/v1/search?q=" +
            encodeURIComponent(query) +
            "&limit=" +
            limit +
            "&engines=" +
            encodeURIComponent(engines);
          const res = await fetch(target, {
            headers: { Accept: "application/json" },
            redirect: "follow",
          });
          if (res.ok) {
            const d = await res.json().catch(() => null);
            const data = d?.data ?? d;
            if (Array.isArray(data) && data.length) return json(data);
          }
        } catch {}
      }

      // 2) 本地兜底：Wikipedia opensearch（Worker 部分地区可访问）
      try {
        const apiUrl =
          "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=" +
          limit +
          "&namespace=0&search=" +
          encodeURIComponent(query);
        const res = await fetch(apiUrl, {
          headers: { "User-Agent": "KimoBot/1.0 (research)" },
          redirect: "follow",
        });
        if (res.ok) {
          const d = await res.json();
          const titles = (d[1] || []).filter(Boolean);
          const descs = d[2] || [];
          const urls = d[3] || [];
          const out = [];
          for (let i = 0; i < titles.length && out.length < limit; i++) {
            out.push({
              title: titles[i],
              url: urls[i] || "",
              description: (descs[i] || "").replace(/\s+/g, " ").trim(),
              source: "wikipedia.org",
              engine: "wikipedia",
            });
          }
          if (out.length) return json(out);
        }
      } catch {}

      return json([]);
    }

    // ── 2) 网页抓取代理：/api/fetch → 目标 URL ──
    if (pathname === "/api/fetch") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl)
        return new Response("Missing url parameter", { status: 400 });
      if (!/^https?:\/\//i.test(targetUrl))
        return new Response("Invalid URL", { status: 400 });
      const maxChars = parseInt(
        url.searchParams.get("maxChars") || "30000",
        10,
      );
      try {
        const res = await fetch(targetUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; KimoBot/1.0)" },
          redirect: "follow",
        });
        if (!res.ok)
          return new Response("Fetch failed: " + res.status, { status: 502 });
        const ct = res.headers.get("content-type") || "text/plain";
        const raw = await res.text();
        const finalUrl = res.url || targetUrl;

        // 提取标题和文本
        let title = "";
        let text = raw;
        if (ct.includes("text/html") || raw.includes("<html")) {
          const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          title = titleMatch ? titleMatch[1].trim() : "";
          // 简单 HTML → 文本
          text = raw
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ")
            .trim();
        }
        const truncated = text.length > maxChars;
        const content = truncated ? text.slice(0, maxChars) : text;

        return new Response(
          JSON.stringify({
            url: targetUrl,
            finalUrl,
            contentType: ct,
            title,
            retrievalMethod: "proxy",
            truncated,
            content,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // ── 3) API / 静态资源反代到后端 ──
    if (pathname.startsWith("/api/") || pathname.startsWith("/static/")) {
      if (!backend) {
        return new Response("API_BACKEND not configured", { status: 502 });
      }
      const target = backend + pathname + url.search;
      const headers = new Headers(request.headers);
      headers.set("Host", new URL(backend).host);
      return fetch(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "follow",
      });
    }

    // ── 4) 静态资源 / SPA 回退 ──
    return env.ASSETS.fetch(request);
  },
};
