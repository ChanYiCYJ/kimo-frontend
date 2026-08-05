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

    // ── 1) 搜索代理：/api/search → 纯前端多引擎（bing/duckduckgo/brave/wikipedia）──
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
      const want = (e) =>
        engines
          .split(",")
          .map((s) => s.trim())
          .includes(e);
      const out = [];
      const seen = new Set();
      const push = (r) => {
        if (r && r.title && r.url && !seen.has(r.url)) {
          seen.add(r.url);
          out.push(r);
        }
      };

      // Bing（标准 b_algo + 降级页宽松解析）
      if (want("bing")) {
        try {
          const res = await fetch(
            "https://www.bing.com/search?q=" +
              encodeURIComponent(query) +
              "&count=" +
              Math.min(20, limit) +
              "&mkt=zh-CN",
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
              },
              redirect: "follow",
            },
          );
          if (res.ok) {
            const html = await res.text();
            // 标准 b_algo 块
            const blocks =
              html.match(/<li class="b_algo[^"]*"[\s\S]*?<\/li>/g) || [];
            for (const block of blocks) {
              if (out.length >= limit) break;
              const hrefM = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"/);
              const titleM = block.match(
                /<h2[^>]*>\s*<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/,
              );
              const snipM = block.match(
                /<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/,
              );
              if (hrefM && titleM) {
                let source = "";
                try {
                  source = new URL(hrefM[1]).hostname;
                } catch {}
                push({
                  title: titleM[1].replace(/<[^>]+>/g, "").trim(),
                  url: hrefM[1],
                  description: (snipM ? snipM[1] : "")
                    .replace(/<[^>]+>/g, "")
                    .trim(),
                  source,
                  engine: "bing",
                });
              }
            }
            // 降级页：无 b_algo 时宽松匹配 h2>a 结果链接
            if (out.length === 0) {
              const altBlocks =
                html.match(
                  /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/g,
                ) || [];
              for (const block of altBlocks) {
                if (out.length >= limit) break;
                const m = block.match(
                  /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/,
                );
                if (m) {
                  let source = "";
                  try {
                    source = new URL(m[1]).hostname;
                  } catch {}
                  push({
                    title: m[2].replace(/<[^>]+>/g, "").trim(),
                    url: m[1],
                    description: "",
                    source,
                    engine: "bing",
                  });
                }
              }
            }
          }
        } catch {}
      }

      // DuckDuckGo HTML（202 验证页则跳过）
      if (want("duckduckgo")) {
        try {
          const res = await fetch(
            "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              redirect: "follow",
            },
          );
          if (res.ok) {
            const html = await res.text();
            const links = [
              ...html.matchAll(
                /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
              ),
            ];
            const snips = [
              ...html.matchAll(
                /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,
              ),
            ];
            for (let i = 0; i < links.length && out.length < limit; i++) {
              const raw = links[i][1] || "";
              let target = raw;
              const um = raw.match(/[?&]uddg=([^&]+)/);
              if (um) target = decodeURIComponent(um[1]);
              else if (raw.startsWith("http")) target = raw;
              let source = "";
              try {
                source = new URL(target).hostname;
              } catch {}
              push({
                title: (links[i][2] || "").replace(/<[^>]+>/g, "").trim(),
                url: target,
                description: (snips[i]?.[1] || "")
                  .replace(/<[^>]+>/g, "")
                  .trim(),
                source,
                engine: "duckduckgo",
              });
            }
          }
        } catch {}
      }

      // Brave（抓 HTML 结果）
      if (want("brave") && out.length < limit) {
        try {
          const res = await fetch(
            "https://search.brave.com/search?q=" +
              encodeURIComponent(query) +
              "&source=web",
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              redirect: "follow",
            },
          );
          if (res.ok) {
            const html = await res.text();
            const blocks =
              html.match(
                /<div[^>]*class="[^"]*snippet[^"]*"[^>]*>[\s\S]*?<\/div>/g,
              ) || [];
            for (const block of blocks) {
              if (out.length >= limit) break;
              const hrefM = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
              const titleM = block.match(
                /<a[^>]*href="https?:\/\/[^"]+"[^>]*>\s*<[^>]*>([\s\S]*?)<\/[^>]+>\s*<\/a>/,
              );
              if (hrefM && titleM) {
                let source = "";
                try {
                  source = new URL(hrefM[1]).hostname;
                } catch {}
                push({
                  title: titleM[1]
                    .replace(/<[^>]+>/g, "")
                    .trim()
                    .slice(0, 120),
                  url: hrefM[1],
                  description: "",
                  source,
                  engine: "brave",
                });
              }
            }
          }
        } catch {}
      }

      // Wikipedia opensearch（稳定兜底）
      if (want("wikipedia") && out.length < limit) {
        try {
          const apiUrl =
            "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=" +
            (limit - out.length) +
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
            for (let i = 0; i < titles.length && out.length < limit; i++) {
              push({
                title: titles[i],
                url: urls[i] || "",
                description: (descs[i] || "").replace(/\s+/g, " ").trim(),
                source: "wikipedia.org",
                engine: "wikipedia",
              });
            }
          }
        } catch {}
      }

      return json(out);
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

        // 提取标题/封面/文本
        let title = "";
        let ogImage = "";
        let images = [];
        let text = raw;
        if (ct.includes("text/html") || raw.includes("<html")) {
          const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          title = titleMatch ? titleMatch[1].trim() : "";
          // og:image 封面（供 AI 文章插图）
          const ogMatch =
            raw.match(
              /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
            ) ||
            raw.match(
              /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
            );
          ogImage = ogMatch ? ogMatch[1].trim() : "";
          // 正文图片：收集 og:image 之外的 <img> src（供 AI 文章多图）
          const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
          let im;
          while ((im = imgRe.exec(raw)) && images.length < 6) {
            const src = im[1].trim();
            if (!src || src.startsWith("data:")) continue;
            if (src.startsWith("//")) images.push("https:" + src);
            else if (/^https?:\/\//i.test(src)) images.push(src);
            else if (src.startsWith("/")) {
              try {
                images.push(new URL(src, finalUrl).href);
              } catch {}
            }
          }
          if (ogImage) images.unshift(ogImage);
          images = [...new Set(images)].slice(0, 6);
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
            ogImage,
            images,
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
