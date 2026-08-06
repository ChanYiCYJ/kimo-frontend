// ===== Kimo 前端 — Cloudflare Workers 适配脚本 =====
// 职责：
//  1. /api/v1/* 与 /static/* 反代到真实后端（API_BACKEND）
//  2. /api/search 代理搜索请求 → DuckDuckGo Lite（解决浏览器 CORS）
//  3. /api/fetch  代理网页抓取请求 → 目标 URL（解决浏览器 CORS）
//  4. /api/image/search 图片搜索（Wikimedia / DuckDuckGo / Pixiv / Danbooru / Safebooru）
//  5. /api/image/raw    图片代理（Pixiv i.pximg.net 需要 Referer）
//  5.5 /api/live2d/asset|api  Live2D 资源反代 → bestdori.com（其无 CORS 头，需同源代理）
//  6. 其余请求交给 Cloudflare Assets 托管 dist 静态资源
//
// 环境变量：
//  - API_BACKEND           后端地址，不带尾部斜杠，例如 https://api.yogofor.top
//  - PIXIV_REFRESH_TOKEN   Pixiv OAuth refresh token（可选；配置后二次元图片优先走 Pixiv）
//
// 本地预览：npx wrangler dev
// 部署：    npm run deploy:cf   （或 npx wrangler deploy）

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 带超时的 fetch（搜索引擎抓取统一限时，避免某个引擎拖慢整体搜索） */
async function fetchT(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ==================== /api/search 多引擎（并行抓取） ====================

/** 引擎：Bing（cn.bing 优先，www.bing 常给 bot 验证页则换域名） */
async function searchBing(query, limit) {
  const out = [];
  const hosts = [
    "https://cn.bing.com/search",
    "https://www.bing.com/search",
    "https://www4.bing.com/search",
  ];
  for (const base of hosts) {
    if (out.length >= limit) break;
    try {
      const res = await fetchT(
        base +
          "?q=" +
          encodeURIComponent(query) +
          "&count=" +
          Math.min(20, limit) +
          "&mkt=zh-CN&setlang=zh-CN",
        {
          headers: {
            "User-Agent": UA,
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            Accept: "text/html,application/xhtml+xml",
          },
          redirect: "follow",
        },
        5000,
      );
      if (!res.ok) continue;
      const html = await res.text();
      const blocks = html.match(/<li class="b_algo[^"]*"[\s\S]*?<\/li>/g) || [];
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
          out.push({
            title: titleM[1].replace(/<[^>]+>/g, "").trim(),
            url: hrefM[1],
            description: (snipM ? snipM[1] : "").replace(/<[^>]+>/g, "").trim(),
            engine: "bing",
          });
        }
      }
      if (out.length) break;
    } catch {}
  }
  return out;
}

/** 引擎：DuckDuckGo（html + lite 多端点，202 验证页自动跳过） */
async function searchDuckDuckGo(query, limit) {
  const hosts = [
    "https://duckduckgo.com/html/?q=",
    "https://html.duckduckgo.com/html/?q=",
    "https://lite.duckduckgo.com/lite/?q=",
  ];
  for (const base of hosts) {
    try {
      const res = await fetchT(
        base + encodeURIComponent(query),
        {
          headers: { "User-Agent": UA, Accept: "text/html" },
          redirect: "follow",
        },
        6000,
      );
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes("result__a") && !html.includes("result-link"))
        continue;
      const links = [
        ...html.matchAll(
          /<a[^>]*class="result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
        ),
      ];
      const snips = [
        ...html.matchAll(
          /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,
        ),
      ];
      const out = [];
      for (let i = 0; i < links.length && out.length < limit; i++) {
        const raw = links[i][1] || "";
        let target = raw;
        const um = raw.match(/[?&]uddg=([^&]+)/);
        if (um) target = decodeURIComponent(um[1]);
        else if (raw.startsWith("http")) target = raw;
        out.push({
          title: (links[i][2] || "").replace(/<[^>]+>/g, "").trim(),
          url: target,
          description: (snips[i]?.[1] || "").replace(/<[^>]+>/g, "").trim(),
          engine: "duckduckgo",
        });
      }
      if (out.length) return out;
    } catch {}
  }
  return [];
}

/** 引擎：Brave（抓 HTML 结果） */
async function searchBrave(query, limit) {
  const out = [];
  try {
    const res = await fetchT(
      "https://search.brave.com/search?q=" +
        encodeURIComponent(query) +
        "&source=web",
      { headers: { "User-Agent": UA }, redirect: "follow" },
      6000,
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
          out.push({
            title: titleM[1]
              .replace(/<[^>]+>/g, "")
              .trim()
              .slice(0, 120),
            url: hrefM[1],
            description: "",
            engine: "brave",
          });
        }
      }
    }
  } catch {}
  return out;
}

/** 引擎：Google News RSS（来源域名多样，弥补单站兜底） */
async function searchGoogleNews(query, limit) {
  const out = [];
  try {
    const res = await fetchT(
      "https://news.google.com/rss/search?q=" +
        encodeURIComponent(query) +
        "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
      { headers: { "User-Agent": UA }, redirect: "follow" },
      6000,
    );
    if (res.ok) {
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items) {
        if (out.length >= limit) break;
        const titleM = item.match(/<title>([\s\S]*?)<\/title>/);
        const linkM = item.match(/<link>([\s\S]*?)<\/link>/);
        const srcM = item.match(/<source url="([^"]+)"[^>]*>/);
        const title = titleM
          ? titleM[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()
          : "";
        // 优先用真实来源站 URL，news.google.com 重定向仅兜底
        const link =
          (srcM ? srcM[1].trim() : "") || (linkM ? linkM[1].trim() : "");
        if (title && link) {
          out.push({
            title: title.slice(0, 120),
            url: link,
            description: "",
            engine: "googlenews",
          });
        }
      }
    }
  } catch {}
  return out;
}

/** 引擎：Mojeek（简单 HTML，无验证码） */
async function searchMojeek(query, limit) {
  const out = [];
  try {
    const res = await fetchT(
      "https://www.mojeek.com/search?q=" + encodeURIComponent(query),
      {
        headers: { "User-Agent": UA, Accept: "text/html" },
        redirect: "follow",
      },
      6000,
    );
    if (res.ok) {
      const html = await res.text();
      const blocks =
        html.match(
          /<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/g,
        ) || [];
      for (const block of blocks) {
        if (out.length >= limit) break;
        const m = block.match(
          /<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
        );
        if (m) {
          out.push({
            title: m[2]
              .replace(/<[^>]+>/g, "")
              .trim()
              .slice(0, 120),
            url: m[1],
            description: "",
            engine: "mojeek",
          });
        }
      }
    }
  } catch {}
  return out;
}

/** 引擎：Qwant API（JSON） */
async function searchQwant(query, limit) {
  const out = [];
  try {
    const res = await fetchT(
      "https://api.qwant.com/v3/search/web?q=" +
        encodeURIComponent(query) +
        "&count=" +
        Math.min(10, limit) +
        "&locale=zh_CN&safesearch=1",
      {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
      },
      6000,
    );
    if (res.ok) {
      const d = await res.json().catch(() => null);
      const items = d?.data?.result?.items || [];
      for (const it of items) {
        if (out.length >= limit) break;
        const url = it?.url || "";
        const title = it?.title || "";
        if (title && url) {
          out.push({
            title: String(title).slice(0, 120),
            url,
            description: String(it?.desc || "").slice(0, 300),
            engine: "qwant",
          });
        }
      }
    }
  } catch {}
  return out;
}

/** 引擎：Wikipedia opensearch（zh 优先 → en 兜底） */
async function searchWikipedia(query, limit) {
  const out = [];
  for (const lang of ["zh", "en"]) {
    if (out.length >= limit) break;
    try {
      const apiUrl =
        "https://" +
        lang +
        ".wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=" +
        (limit - out.length) +
        "&namespace=0&search=" +
        encodeURIComponent(query);
      const res = await fetchT(
        apiUrl,
        {
          headers: { "User-Agent": "KimoBot/1.0 (research)" },
          redirect: "follow",
        },
        5000,
      );
      if (res.ok) {
        const d = await res.json();
        const titles = (d[1] || []).filter(Boolean);
        const descs = d[2] || [];
        const urls = d[3] || [];
        for (let i = 0; i < titles.length && out.length < limit; i++) {
          out.push({
            title: titles[i],
            url: urls[i] || "",
            description: (descs[i] || "").replace(/\s+/g, " ").trim(),
            engine: "wikipedia",
          });
        }
      }
    } catch {}
  }
  return out;
}

/** 引擎：Baidu 网页搜索（中文话题主力；重定向链接统一归为 baidu.com） */
async function searchBaidu(query, limit) {
  const out = [];
  try {
    const res = await fetchT(
      "https://www.baidu.com/s?wd=" +
        encodeURIComponent(query) +
        "&rn=" +
        Math.min(20, limit),
      {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "zh-CN,zh;q=0.9",
          Accept: "text/html",
        },
        redirect: "follow",
      },
      6000,
    );
    if (!res.ok) return out;
    const html = await res.text();
    if (html.includes("百度安全验证") || html.includes("wappass")) return out;
    // 结果标题链接
    const links = [
      ...html.matchAll(
        /<h3[^>]*class="[^"]*c-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      ),
    ];
    // 摘要
    const abstracts = [
      ...html.matchAll(
        /<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
      ),
    ];
    for (let i = 0; i < links.length && out.length < limit; i++) {
      const href = links[i][1] || "";
      const title = (links[i][2] || "").replace(/<[^>]+>/g, "").trim();
      if (href && title) {
        out.push({
          title: title.slice(0, 120),
          url: href,
          description: (abstracts[i]?.[1] || "")
            .replace(/<[^>]+>/g, "")
            .trim()
            .slice(0, 300),
          engine: "baidu",
        });
      }
    }
  } catch {}
  return out;
}
const PIXIV_CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const PIXIV_CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QrFE3uK1ngA";

/** 用 refresh token 换 Pixiv access token（公开的 PixivApp OAuth） */
async function pixivToken(env) {
  const rt = (env.PIXIV_REFRESH_TOKEN || "").trim();
  if (!rt) return "";
  try {
    const res = await fetch("https://oauth.secure.pixiv.net/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)",
      },
      body: new URLSearchParams({
        client_id: PIXIV_CLIENT_ID,
        client_secret: PIXIV_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: rt,
      }),
    });
    if (!res.ok) return "";
    const j = await res.json();
    return (j && j.response && j.response.access_token) || "";
  } catch {
    return "";
  }
}

/** Pixiv 插画搜索（app-api），返回统一结构 */
async function pixivSearch(token, query, limit) {
  try {
    const res = await fetch(
      "https://app-api.pixiv.net/v1/search/illust?word=" +
        encodeURIComponent(query) +
        "&search_target=partial_match_for_tags&filter=for_android&limit=" +
        limit,
      {
        headers: {
          Authorization: "Bearer " + token,
          "User-Agent": "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)",
        },
      },
    );
    if (!res.ok) return [];
    const j = await res.json();
    const illusts = Array.isArray(j && j.illusts) ? j.illusts : [];
    return illusts
      .filter((il) => il && !il.is_muted)
      .map((il) => {
        const orig =
          (il.meta_single_page && il.meta_single_page.original_image_url) ||
          (il.image_urls && il.image_urls.large) ||
          "";
        const rawUrl = orig.replace(/^https?:\/\/i\.pximg\.net\//, "");
        return {
          id: String(il.id || ""),
          title: il.title || "",
          author: (il.user && il.user.name) || "",
          author_id: il.user && il.user.id ? String(il.user.id) : "",
          url: rawUrl ? "/api/image/raw?u=" + encodeURIComponent(rawUrl) : "",
          thumbnail:
            il.image_urls && il.image_urls.square_medium
              ? "/api/image/raw?u=" +
                encodeURIComponent(
                  il.image_urls.square_medium.replace(
                    /^https?:\/\/i\.pximg\.net\//,
                    "",
                  ),
                )
              : "",
          source: "pixiv",
          type: "anime",
          width: il.width || 0,
          height: il.height || 0,
          r18: il.x_restrict ? true : false,
          tags: Array.isArray(il.tags)
            ? il.tags.map((t) => (typeof t === "string" ? t : t.name || ""))
            : [],
        };
      })
      .filter((r) => r.url && !r.r18);
  } catch {
    return [];
  }
}

/** Danbooru 动漫图（公开 API，无需 key；过滤 explicit） */
async function danbooruSearch(query, limit) {
  try {
    const res = await fetch(
      "https://danbooru.donmai.us/posts.json?tags=" +
        encodeURIComponent(query) +
        "&limit=" +
        limit +
        "&order=score",
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const j = await res.json();
    if (!Array.isArray(j)) return [];
    return j
      .filter((p) => p && p.rating !== "e")
      .map((p) => ({
        id: String(p.id || ""),
        title:
          (
            p.tag_string_character ||
            p.tag_string_artist ||
            p.tag_string_general ||
            ""
          )
            .split(" ")
            .slice(0, 4)
            .join(" ") || "Danbooru",
        author: p.uploader_name || "",
        url: p.large_file_url || p.file_url || "",
        thumbnail: p.preview_file_url || "",
        source: "danbooru",
        type: "anime",
        width: p.image_width || 0,
        height: p.image_height || 0,
        r18: false,
        tags: (p.tag_string_general || "").split(" ").slice(0, 10),
      }))
      .filter((r) => r.url);
  } catch {
    return [];
  }
}

/** Safebooru 安全动漫图（公开 API，无需 key） */
async function safebooruSearch(query, limit) {
  try {
    const res = await fetch(
      "https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=" +
        encodeURIComponent(query) +
        "&limit=" +
        limit,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const j = await res.json();
    if (!Array.isArray(j)) return [];
    return j
      .filter((p) => p && p.image)
      .map((p) => ({
        id: String(p.id || ""),
        title: (p.tags || "").split(" ").slice(0, 4).join(" ") || "Safebooru",
        author: "",
        url: "https://safebooru.org/images/" + p.directory + "/" + p.image,
        thumbnail:
          "https://safebooru.org/thumbnails/" +
          p.directory +
          "/thumbnail_" +
          p.image,
        source: "safebooru",
        type: "anime",
        width: p.width || 0,
        height: p.height || 0,
        r18: false,
        tags: (p.tags || "").split(" ").slice(0, 10),
      }));
  } catch {
    return [];
  }
}

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
        url.searchParams.get("engines") ||
        "baidu,bing,googlenews,mojeek,qwant,duckduckgo,brave,wikipedia";
      if (!query) return new Response("Missing q parameter", { status: 400 });
      const json = (data, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      const out = [];
      const seen = new Set();
      const push = (r) => {
        if (r && r.title && r.url && !seen.has(r.url)) {
          seen.add(r.url);
          out.push(r);
        }
      };

      // 并行抓取各引擎（各自限时，总耗时 ≈ 最慢引擎；避免串行拖到 Worker 墙钟上限导致"没结果"）
      const ENGINE_FNS = {
        baidu: searchBaidu,
        bing: searchBing,
        duckduckgo: searchDuckDuckGo,
        brave: searchBrave,
        googlenews: searchGoogleNews,
        mojeek: searchMojeek,
        qwant: searchQwant,
        wikipedia: searchWikipedia,
      };
      const wanted = engines
        .split(",")
        .map((s) => s.trim())
        .filter((e) => ENGINE_FNS[e]);
      const settled = await Promise.allSettled(
        wanted.map((name) => ENGINE_FNS[name](query, limit).catch(() => [])),
      );
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        for (const r of s.value || []) push(r);
      }

      // 域名多样化：让结果覆盖多个不同网站（每站最多 2 条），避免只来自单一站点
      const hostCount = {};
      const diverse = [];
      for (const r of out) {
        let host = r.source || "";
        try {
          host = new URL(r.url).hostname.replace(/^www\./i, "");
        } catch {}
        if ((hostCount[host] || 0) >= 2) continue;
        hostCount[host] = (hostCount[host] || 0) + 1;
        diverse.push(r);
        if (diverse.length >= limit) break;
      }
      return json(diverse.length ? diverse : out);
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
        const res = await fetchT(
          targetUrl,
          {
            headers: {
              "User-Agent": UA,
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
            redirect: "follow",
          },
          12000,
        );
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
          // og:image 封面（含 secure_url/url 变体；供 AI 文章插图）
          const ogMatch =
            raw.match(
              /<meta[^>]*property=["']og:image(?:[:]?(?:secure_url|url))?["'][^>]*content=["']([^"']+)["']/i,
            ) ||
            raw.match(
              /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image(?:[:]?(?:secure_url|url))?["']/i,
            );
          ogImage = ogMatch ? ogMatch[1].trim() : "";
          if (!ogImage) {
            // twitter:image 兜底
            const twMatch =
              raw.match(
                /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
              ) ||
              raw.match(
                /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
              );
            ogImage = twMatch ? twMatch[1].trim() : "";
          }
          // 正文图片：兼容 src/data-src/data-lazy-src/data-original/srcset（供 AI 文章多图）
          const rawImgAttrs = raw.match(/<img[^>]*>/gi) || [];
          const NOISE =
            /icon|logo|spacer|badge|avatar|sprite|pixel|blank|\.svg|\.ico|1x1|placeholder|loading\.gif|emoji|favicon|vip|heart|collect|tobar|share|qrcode|qr_|btn_|button|nav_|head_|arrow|dots|comment|thumb|zan|gif_|img_btn|lock\.png|like|unlike|toolbar/i;
          for (const tag of rawImgAttrs) {
            if (images.length >= 8) break;
            const srcMatch =
              tag.match(
                /(?:src|data-src|data-lazy-src|data-original|data-url|data-srcset)=["']([^"']+)["']/i,
              ) || tag.match(/srcset=["']([^"']+)["']/i);
            let src = srcMatch
              ? srcMatch[1]
                  .trim()
                  .split(",")
                  .map((p) => p.trim().split(/\s+/)[0])
                  .filter(Boolean)
                  .sort(
                    (a, b) =>
                      (b.match(/\d{2,}w/) ? Number(b.match(/\d{2,}w/)[0]) : 0) -
                      (a.match(/\d{2,}w/) ? Number(a.match(/\d{2,}w/)[0]) : 0),
                  )[0] || ""
              : "";
            if (!src || src.startsWith("data:") || NOISE.test(src)) continue;
            if (src.startsWith("//")) src = "https:" + src;
            else if (!/^https?:\/\//i.test(src)) {
              if (!src.startsWith("/")) continue;
              try {
                src = new URL(src, finalUrl).href;
              } catch {
                continue;
              }
            }
            if (images.includes(src)) continue;
            images.push(src);
          }
          if (ogImage && !images.includes(ogImage)) images.unshift(ogImage);
          images = [...new Set(images)].slice(0, 8);
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

    // ── 2.5) 图片搜索代理：/api/image/search → Wikimedia Commons + DuckDuckGo i.js ──
    if (pathname === "/api/image/search") {
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "8", 10);
      const type = url.searchParams.get("type") || "photo";
      if (!query) return new Response("Missing q parameter", { status: 400 });
      const json = (data, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      const out = [];
      const seen = new Set();
      const push = (r) => {
        if (r && r.url && !seen.has(r.url)) {
          seen.add(r.url);
          out.push(r);
        }
      };

      // ── 二次元（anime）：Pixiv 独家优先 → Danbooru → Safebooru ──
      if (type === "anime") {
        const token = await pixivToken(env);
        if (token) {
          const pix = await pixivSearch(token, query, limit);
          for (const r of pix) push(r);
        }
        if (out.length < limit) {
          const dan = await danbooruSearch(query, limit - out.length);
          for (const r of dan) push(r);
        }
        if (out.length < limit) {
          const safe = await safebooruSearch(query, limit - out.length);
          for (const r of safe) push(r);
        }
      }

      // ── 普通图（photo/product）：Wikimedia Commons（免费、无 key、图质高）──
      try {
        const res = await fetch(
          "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
            encodeURIComponent(query) +
            "&gsrnamespace=6&gsrlimit=" +
            Math.min(30, limit * 3) +
            "&prop=imageinfo&iiprop=url%7Csize%7Cmime&iiurlwidth=640&format=json&origin=*",
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; KimoBot/1.0)",
            },
          },
        );
        if (res.ok) {
          const j = await res.json();
          const pages = (j && j.query && j.query.pages) || {};
          for (const p of Object.values(pages)) {
            if (out.length >= limit) break;
            const ii = (p.imageinfo && p.imageinfo[0]) || {};
            if (!ii.url) continue;
            if (ii.mime && ii.mime.startsWith("image/svg")) continue;
            if ((ii.width || 0) < 400) continue;
            push({
              title: p.title || "",
              url: ii.thumburl || ii.url,
              thumbnail: ii.thumburl || ii.url,
              source: "wikimedia",
              type,
              width: ii.width || 0,
              height: ii.height || 0,
              tags: [],
            });
          }
        }
      } catch {}
      // DuckDuckGo i.js 兜底
      if (out.length < limit) {
        try {
          const res = await fetch(
            "https://duckduckgo.com/i.js?o=json&q=" +
              encodeURIComponent(query) +
              "&f=,,,&p=1&s=0",
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Referer: "https://duckduckgo.com/",
              },
            },
          );
          if (res.ok) {
            const j = await res.json();
            const results = Array.isArray(j && j.results) ? j.results : [];
            for (const r of results) {
              if (out.length >= limit) break;
              if (!r.image || r.image.startsWith("data:")) continue;
              push({
                title: r.title || "",
                url: r.image,
                thumbnail: r.thumbnail || r.image,
                source: "duckduckgo",
                type,
                width: r.width || 0,
                height: r.height || 0,
                tags: [],
              });
            }
          }
        } catch {}
      }
      return json({ items: out });
    }

    // ── 2.6) 图片代理：/api/image/raw?u=...（Pixiv i.pximg.net 需 Referer）──
    if (pathname === "/api/image/raw") {
      const imgPath = url.searchParams.get("u") || "";
      const target = /^https?:\/\//i.test(imgPath)
        ? imgPath
        : "https://i.pximg.net/" + imgPath.replace(/^\/+/, "");
      if (!imgPath) return new Response("Missing u parameter", { status: 400 });
      try {
        const res = await fetch(target, {
          headers: {
            Referer: "https://www.pixiv.net/",
            "User-Agent": UA,
          },
          redirect: "follow",
        });
        if (!res.ok)
          return new Response("Image fetch failed: " + res.status, {
            status: 502,
          });
        const ct = res.headers.get("content-type") || "image/jpeg";
        return new Response(res.body, {
          headers: {
            "Content-Type": ct,
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
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

    // ── 2.7) Live2D 资源反代：/api/live2d/asset/* → bestdori.com/assets/* 、/api/live2d/api/* → bestdori.com/api/* ──
    // bestdori 不返回 CORS 头，浏览器无法跨域直连加载 Live2D 模型，必须经此同源代理。
    if (
      pathname.startsWith("/api/live2d/asset/") ||
      pathname.startsWith("/api/live2d/api/")
    ) {
      const isApi = pathname.startsWith("/api/live2d/api/");
      const rest = pathname.replace(
        isApi ? /^\/api\/live2d\/api\// : /^\/api\/live2d\/asset\//,
        "",
      );
      const base = isApi
        ? "https://bestdori.com/api"
        : "https://bestdori.com/assets";
      const target = base + "/" + rest + url.search;
      try {
        const res = await fetch(target, {
          headers: {
            "User-Agent": UA,
            Accept: "*/*",
          },
          redirect: "follow",
        });
        if (!res.ok)
          return new Response("Live2D fetch failed: " + res.status, {
            status: 502,
          });
        const ct =
          res.headers.get("content-type") || "application/octet-stream";
        return new Response(res.body, {
          headers: {
            "Content-Type": ct,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
          },
        });
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

    // ── 2.8) Live2D 通用代理：/api/live2d/proxy?url=... → 任意 URL（第三方模型导入用）──
    // 第三方 Live2D model.json 通常无 CORS 头，浏览器需经此同源代理拉取模型/贴图/动作。
    if (pathname.startsWith("/api/live2d/proxy")) {
      const target = url.searchParams.get("url") || "";
      if (!/^https?:\/\//i.test(target)) {
        return new Response("bad proxy url", { status: 400 });
      }
      try {
        const res = await fetch(target, {
          headers: {
            "User-Agent": UA,
            Accept: "*/*",
          },
          redirect: "follow",
        });
        if (!res.ok)
          return new Response("proxy fetch failed: " + res.status, {
            status: 502,
          });
        const ct =
          res.headers.get("content-type") || "application/octet-stream";
        return new Response(res.body, {
          headers: {
            "Content-Type": ct,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
          },
        });
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
    // HTML 响应强制 no-store：避免 Cloudflare 边缘缓存无版本号的 index.html，
    // 导致部署后用户刷新仍是旧界面（JS/CSS 等带 hash 资源仍正常缓存）
    const res = await env.ASSETS.fetch(request);
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("text/html")) {
      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("CDN-Cache-Control", "no-store");
      return new Response(res.body, { status: res.status, headers });
    }
    return res;
  },
};
