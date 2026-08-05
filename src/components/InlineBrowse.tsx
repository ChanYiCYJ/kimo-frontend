import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { searchWithCache } from "../lib/search";
import { TypeWriter } from "./Spinner";

interface Source {
  title: string;
  href: string;
  host: string;
}

function parseSources(content: string): { results: Source[]; sourcesText: string } {
  const srcIdx = content.indexOf("【来源内容");
  const resultsText = srcIdx >= 0 ? content.slice(0, srcIdx) : content;
  const sourcesText = srcIdx >= 0 ? content.slice(srcIdx) : "";
  const results = resultsText
    .split(/\n(?=(?:-\s|\d+[.、)]\s))/)
    .map((s) => s.trim())
    .filter((s) => s && !/^【[^】]*】\s*$/.test(s))
    .map((line) => {
      const urlM = line.match(/https?:\/\/[^\s)\]】>]+/);
      const href = urlM ? urlM[0].replace(/[)\]】>]+$/, "") : "";
      const title = line
        .replace(/^(?:-\s|\d+[.、)]\s+)/, "")
        .replace(/\*\*/g, "")
        .replace(/\s*https?:\/\/[^\s)\]】>]+/, " ")
        .split("\n")[0]
        .trim()
        .replace(/[\s()）【】]+$/g, "");
      let host = "";
      try {
        host = href ? new URL(href).hostname.replace(/^www\./i, "") : "";
      } catch {}
      return { title, href, host };
    })
    .filter((r) => r.href && /^https?:\/\//i.test(r.href) && r.title);
  return { results, sourcesText };
}

/**
 * 内嵌浏览：移动端搜索时直接嵌在对话里（站点式 Think Different 加载 + AI 文章 + 来源）。
 */
export function InlineBrowse({
  query,
  onOpenPanel,
}: {
  query: string;
  onOpenPanel?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [article, setArticle] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setContent("");
    setArticle("");
    searchWithCache(query, { maxSources: 3, perSourceChars: 2500 }).then(
      (r) => {
        if (!alive) return;
        setLoading(false);
        setContent(r.content || "未找到结果");
        setArticle(r.article || "");
      },
    );
    return () => {
      alive = false;
    };
  }, [query]);

  const { results } = parseSources(content);

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-8">
          <TypeWriter
            text="Think Different"
            className="text-base font-medium tracking-[0.2em] text-gray-500 dark:text-gray-400"
          />
          <p className="font-mono text-[11px] text-gray-300 dark:text-gray-600">
            $ loading ...
          </p>
        </div>
      ) : (
        <div className="p-3">
          {article ? (
            <div className="markdown-body kimo-panel">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{article}</ReactMarkdown>
            </div>
          ) : (
            content && (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {content}
              </p>
            )
          )}
          {results.length > 0 && (
            <div className="mt-3 border-t border-gray-50 pt-2 dark:border-gray-800">
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                来源 · {results.length}
              </p>
              <div className="mt-1 space-y-0.5">
                {results.map((r, i) => (
                  <a
                    key={i}
                    href={r.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-gray-500 transition hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400"
                  >
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 text-[10px] text-gray-300 dark:text-gray-600">
                      {r.host}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {onOpenPanel && (
            <button
              onClick={onOpenPanel}
              className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 transition hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              在 Agent 中查看
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
