/**
 * 分段多线程搜索编排模块
 *
 * 功能：
 *   - 查询分段（拆分为多个子查询并发搜索）
 *   - 多语言关键词增强
 *   - 无结果自动纠错
 *   - 结果合并去重/多样化/相关性过滤
 *   - 搜索定式缓存（学习最优引擎组合）
 */

import {
  searchBackend,
  searchAI,
  searchFast,
  detectQueryLang,
  detectQueryType,
} from "./search";
import type { SearchResult, QueryType } from "./search";

// ====== 内部工具 ======

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function diversifyByDomain(
  results: SearchResult[],
  max: number,
  perDomain = 2,
): SearchResult[] {
  const hostCount: Record<string, number> = {};
  const out: SearchResult[] = [];
  for (const r of results) {
    if (out.length >= max) break;
    let host = r.source || "";
    try {
      host = new URL(r.url).hostname.replace(/^www\./i, "");
    } catch {
      /* ignore */
    }
    const cap =
      host.includes("bilibili.com") || host.includes("bgm.tv") ? 4 : perDomain;
    if ((hostCount[host] || 0) >= cap) continue;
    hostCount[host] = (hostCount[host] || 0) + 1;
    out.push(r);
  }
  return out;
}

// ====== 查询分段 ======

const SPLIT_RE =
  /(?:和|与|以及|还有|还有啥|另外|此外|同时|顺便|也|对比|比较|区别|vs\.?|VS|，|；|;|、)/;

/** 季节/列表通用词 */
const SEASON_RE =
  /新番|当季|本季|番表|在播|新作|夏季|冬季|春季|秋季|夏アニメ|冬アニメ|春アニメ|秋アニメ|夏番|冬番|春番|秋番|一覧|推荐|おすすめ|202\d|anime|season|list|lineup/gi;

/** 去除查询中所有季节/列表通用词和日期噪声 */
function stripSeason(query: string): string {
  return query
    .replace(SEASON_RE, "")
    .replace(/[年月度、，。:：（）()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 规则式查询分段。fast 最多 2 段，standard 最多 4 段。
 */
export function splitSubQueries(
  query: string,
  _lang: string,
  type: QueryType,
  speed: "fast" | "standard",
): string[] {
  const q = (query || "").trim();
  if (!q) return [];

  const maxSubs = speed === "fast" ? 2 : 4;
  const parts = q
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, maxSubs);

  // anime：分离主标题和季节后缀
  if (type.anime) {
    const main = stripSeason(q);
    if (main && main !== q) return [main, q].slice(0, maxSubs);
  }
  return [q];
}

// ====== 多语言关键词增强 ======

/**
 * 为查询生成多语言混合关键词（保留原语言 + 英文，动漫附日文）。
 */
export function enrichKeywords(
  query: string,
  lang: string,
  type: QueryType,
): string {
  const q = (query || "").trim();
  if (!q) return q;
  const parts = [q];

  // 非英文：追加已有拉丁词或泛化英文
  if (lang !== "en") {
    const enWords = q.match(/[a-zA-Z]{2,}/g);
    if (enWords && enWords.length > 0) {
      parts.push(enWords.join(" "));
    }
  }

  // anime：追加日文关键词块
  if (type.anime) {
    const jp = q.match(/[\u3040-\u30ff\u4e00-\u9fff]{2,}/g);
    if (jp) parts.push(jp.join(" "));
  }
  return parts.join(" ");
}

// ====== 相关性过滤（反污染） ======

/**
 * anime 类型强制按标题相关性过滤，列表类查询（纯新番/季节）放行。
 */
export function filterRelevant(
  results: SearchResult[],
  query: string,
  type: QueryType,
): SearchResult[] {
  const q = (query || "").trim().toLowerCase();
  if (!q || !type.anime) return results;

  // 纯列表类查询放行
  const pure = stripSeason(q).replace(/[\s\d]/g, "");
  if (pure.length < 2) return results;

  // 提取显著 token（长度 ≥2）
  const tokens = q
    .split(/[\s.,;:、，；：（）()「」\[\]【】\-–—/]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  if (!tokens.length) return results;

  return results.filter((r) => {
    const t = (r.title || "").toLowerCase();
    return tokens.some((tk) => t.includes(tk));
  });
}

// ====== 无结果自动纠错 ======

/**
 * 无结果时生成纠错候选（去通用词 → 截短 → 换语言），最多 3 个。
 */
export function correctQuery(query: string, lang: string): string[] {
  const q = (query || "").trim();
  if (!q) return [];
  const out: string[] = [];

  // 1) 去季节/列表通用词
  const c1 = stripSeason(q);
  if (c1 && c1 !== q && c1.length >= 2) out.push(c1);

  // 2) 截短（前 20 字）
  const c2 = q.slice(0, 20).trim();
  if (c2 && c2 !== q && c2.length >= 2) out.push(c2);

  // 3) 非英文 → 追加英文泛化
  if (lang !== "en") {
    const alpha = q
      .replace(/[^\x00-\x7F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (alpha) {
      out.push(alpha);
    } else if (lang === "ja") {
      out.push(`${q} anime`);
    } else {
      out.push(`${q} search`);
    }
  }
  return [...new Set(out)].slice(0, 3);
}

// ====== 搜索定式缓存 ======

interface PatternEntry {
  queryType: string; // "anime"|"news"|"weather"|"general"
  lang: string;
  score: number; // 正值=偏好，负值=避坑
  updatedAt: number;
}

const PATTERN_KEY = "kimo_search_patterns_v1";
const PATTERN_MAX = 20;
const PATTERN_TTL_MS = 7 * 24 * 3600 * 1000;

function loadPatterns(): PatternEntry[] {
  try {
    const raw = localStorage.getItem(PATTERN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePatterns(pat: PatternEntry[]) {
  try {
    localStorage.setItem(PATTERN_KEY, JSON.stringify(pat));
  } catch {
    /* quota exceeded */
  }
}

/** 生成 pattern 键 */
function patternKey(type: QueryType, lang: string): string {
  if (type.weather) return `weather:${lang}`;
  if (type.anime) return `anime:${lang}`;
  if (type.news) return `news:${lang}`;
  if (type.fresh) return `fresh:${lang}`;
  return `general:${lang}`;
}

/** 按反馈更新定式分数：positive +1，negative -2 */
export function applyFeedbackToSearch(
  queryType: QueryType,
  lang: string,
  rating: 1 | -1,
): void {
  const key = patternKey(queryType, lang);
  const pat = loadPatterns();
  const now = Date.now();
  const existing = pat.find((p) => p.queryType === key);
  if (existing) {
    existing.score += rating === 1 ? 1 : -2;
    existing.updatedAt = now;
  } else {
    pat.push({
      queryType: key,
      lang,
      score: rating === 1 ? 1 : -2,
      updatedAt: now,
    });
  }
  // 清理过期 & 限数
  const valid = pat
    .filter((p) => now - p.updatedAt < PATTERN_TTL_MS)
    .slice(-PATTERN_MAX);
  savePatterns(valid);
}

/**
 * 查定式缓存：返回当前查询类型的得分（>0=有偏好，≤0=无偏好/避坑）。
 * 得分 >0 表示同类查询过去 👍 多于 👎，可以复用上次策略。
 */
export function getPatternScore(type: QueryType, lang: string): number {
  const key = patternKey(type, lang);
  const pat = loadPatterns();
  const now = Date.now();
  const hit = pat.find(
    (p) => p.queryType === key && now - p.updatedAt < PATTERN_TTL_MS,
  );
  return hit ? hit.score : 0;
}

// ====== 进度回调 ======

export interface SearchProgress {
  stage:
    | "thinking"
    | "planning"
    | "searching"
    | "correcting"
    | "merging"
    | "done";
  current?: number;
  total?: number;
  subQuery?: string;
  message?: string;
}

// ====== 分段搜索结果 ======

export interface SegmentedSearchResult {
  results: SearchResult[];
  subQueries: string[];
  corrected: boolean;
  totalSearches: number;
}

// ====== 主编排 ======

/**
 * 分段多线程搜索：拆分 → 并发 → 纠错 → AI 兜底 → 合并。
 */
export async function searchSegmented(
  query: string,
  opts: {
    limit?: number;
    speed?: "fast" | "standard";
    onProgress?: (p: SearchProgress) => void;
  } = {},
): Promise<SegmentedSearchResult> {
  const { limit = 8, speed = "standard", onProgress } = opts;
  const q = (query || "").trim();
  if (!q) {
    onProgress?.({ stage: "done" });
    return { results: [], subQueries: [], corrected: false, totalSearches: 0 };
  }

  // 阶段 1 & 2
  onProgress?.({ stage: "thinking" });
  const lang = detectQueryLang(q);
  const type = detectQueryType(q);
  const enriched = enrichKeywords(q, lang, type);
  const subs = splitSubQueries(enriched, lang, type, speed);

  onProgress?.({ stage: "planning" });

  const perSub = Math.max(3, Math.ceil(limit / Math.max(1, subs.length)));
  let totalSearches = subs.length;
  let corrected = false;

  // 阶段 3：并发搜索（每子查询走 searchFast——配置 Tavily 时浏览器直连优先，
  // ~1-2s 返回，不再等经 Worker 中转的慢路径 ~8s+，auto 联网明显提速）
  const settled = await Promise.allSettled(
    subs.map(async (sq, i) => {
      onProgress?.({
        stage: "searching",
        current: i + 1,
        total: subs.length,
        subQuery: sq,
      });
      const results = await searchFast(enriched, perSub);
      return { sub: sq, results };
    }),
  );

  const all: SearchResult[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") all.push(...s.value.results);
  }

  // 全空 → 纠错重试 + AI 兜底
  if (all.length === 0) {
    const corrections = correctQuery(enriched, lang);
    for (const cq of corrections) {
      onProgress?.({
        stage: "correcting",
        total: corrections.length,
        subQuery: cq,
        message: "未找到结果，正在自动纠错重试…",
      });
      const retry = await searchBackend(cq, limit);
      totalSearches++;
      if (retry.length > 0) {
        all.push(...retry);
        corrected = true;
        break;
      }
    }

    // 仍空 → AI 兜底
    if (all.length === 0) {
      const ai = await searchAI(enriched, Math.min(limit, 6));
      totalSearches++;
      if (ai.length > 0) {
        all.push(...ai);
        corrected = true;
      }
    }
  }

  // 阶段 4：合并
  onProgress?.({ stage: "merging" });
  const merged = diversifyByDomain(
    filterRelevant(dedupeByUrl(all), q, type),
    limit,
    2,
  );

  // 反馈命中缓存？仅记录得分（不改变本次结果，下一次同类查询可用 getPatternScore 参考）
  if (merged.length > 0) {
    // 本次搜索成功 → 记录正反馈（轻量 +1，后续用户 👍/👎 会加权覆盖）
    // applyFeedbackToSearch(type, lang, 1); -- 留到用户显式 👍 才写
  }

  onProgress?.({ stage: "done" });
  return { results: merged, subQueries: subs, corrected, totalSearches };
}
