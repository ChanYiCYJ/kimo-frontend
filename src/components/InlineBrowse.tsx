import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { searchWithCache } from "../lib/search";
import { saveKbEntry } from "../lib/kb";
import { TypeWriter } from "./Spinner";
import { useToast } from "../lib/toast";

/**
 * 浏览结果底部面板（移动端）：搜索后从底部滑出，不内嵌进对话流、也不自动弹 Agent 面板。
 * 只保留 AI 文章 + 保存文章（无来源卡/抓取正文卡）。
 */
export function InlineBrowse({
  query,
  onClose,
}: {
  query: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [article, setArticle] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setArticle("");
    searchWithCache(query, { maxSources: 3, perSourceChars: 2500 }).then(
      (r) => {
        if (!alive) return;
        setLoading(false);
        setArticle(r.article || "");
      },
    );
    return () => {
      alive = false;
    };
  }, [query, nonce]);

  const save = () => {
    const title = (
      article.match(/^#\s+(.+)$/m)?.[1] || query
    )
      .trim()
      .slice(0, 60);
    saveKbEntry(title, article);
    toast("已保存到知识库");
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] lg:hidden">
      {/* 遮罩：点击关闭 */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative mx-auto max-w-2xl animate-[kslideUp_0.3s_ease-out] rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            浏览结果
          </span>
          <button
            onClick={onClose}
            title="关闭"
            className="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <TypeWriter
                text="Think Different"
                className="text-base font-medium tracking-[0.2em] text-gray-500 dark:text-gray-400"
              />
              <p className="font-mono text-[11px] text-gray-300 dark:text-gray-600">
                $ loading ...
              </p>
            </div>
          ) : article ? (
            <div className="markdown-body kimo-panel">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {article}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="text-xs text-gray-400">文章生成失败</p>
              <button
                onClick={() => setNonce((n) => n + 1)}
                className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-900 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-200 dark:hover:text-gray-100"
              >
                重新生成
              </button>
            </div>
          )}
        </div>
        {!loading && article && (
          <div className="flex justify-end border-t border-gray-100 px-4 py-2.5 dark:border-gray-800">
            <button
              onClick={save}
              className="rounded-full bg-gray-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            >
              保存文章
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
