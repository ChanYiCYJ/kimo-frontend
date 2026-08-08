import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { articleApi, commentApi, resolveAsset } from "../lib/api";
import type { ArticleDetail, CommentItem } from "../lib/types";
import { Markdown } from "../components/Markdown";
import { PageSpinner } from "../components/Spinner";
import { formatDate, readingTime, slugify } from "../lib/format";
import { EmptyState, btnPrimary } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

interface TocItem {
  level: number;
  text: string;
  id: string;
}

/** 从 Markdown 中提取 h2-h4 作为目录（与 Markdown 渲染的 id 保持一致） */
function extractToc(md: string): TocItem[] {
  const items: TocItem[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{2,4})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const text = m[2].replace(/[*`_]/g, "").trim();
      if (text) items.push({ level: m[1].length, text, id: slugify(text) });
    }
  }
  return items;
}

/** 顶部阅读进度条 */
function ReadingProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const total = h.scrollHeight - h.clientHeight;
      setPct(total > 0 ? Math.min(100, (h.scrollTop / total) * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="fixed inset-x-0 top-0 z-[70] h-0.5 bg-transparent">
      <div
        className="h-full bg-gray-800 transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** 回到顶部按钮 */
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到顶部"
      className="fixed bottom-6 right-6 z-50 grid h-11 w-11 place-items-center rounded-full border border-gray-200 bg-white/90 text-gray-500 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:text-gray-900"
    >
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4a.75.75 0 011.08 0l4.25 4a.75.75 0 01-.02 1.06z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

export function Article() {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  // 评论
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  // 去掉 Markdown 首行 # 标题（已通过 h1 单独渲染，避免重复）
  const displayContent = useMemo(() => {
    if (!article) return "";
    const lines = article.content.split(/\r?\n/);
    if (lines.length > 0 && /^\s*#\s/.test(lines[0])) {
      lines.shift();
      if (lines.length > 0 && lines[0].trim() === "") lines.shift();
    }
    return lines.join("\n");
  }, [article]);

  const toc = useMemo(
    () => (article ? extractToc(displayContent) : []),
    [article, displayContent],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    articleApi
      .get(Number(id))
      .then((a) => {
        if (active) setArticle(a);
      })
      .catch((e: Error) => {
        if (active) setError(e.message || "文章不存在");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    commentApi
      .byArticle(Number(id))
      .then((cs) => {
        if (active) setComments(cs);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  // 目录滚动高亮
  useEffect(() => {
    if (!toc.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveId(e.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    toc.forEach((t) => {
      const el = document.getElementById(t.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [toc]);

  const scrollToHeading = (tid: string) => {
    document
      .getElementById(tid)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text) {
      toastError("请输入评论内容");
      return;
    }
    setSubmitting(true);
    try {
      await commentApi.create({ article_id: Number(id), content: text });
      setCommentText("");
      success("评论已提交，审核通过后将展示");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSpinner />;

  if (error || !article) {
    return (
      <EmptyState
        title="文章不存在"
        description={error || "这篇文章可能已被删除"}
        icon={
          <svg
            className="h-8 w-8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        }
        action={
          <Link
            to="/"
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            返回首页
          </Link>
        }
      />
    );
  }

  return (
    <div className="fade-up">
      <ReadingProgress />
      <BackToTop />

      {/* 头部：封面 + 标题 + 元信息 */}
      <div className="mx-auto max-w-3xl px-4 sm:px-0">
        {/* 封面 */}
        {article.cover_image && (
          <div className="h-64 w-full overflow-hidden rounded-2xl bg-gray-100 md:h-96">
            <img
              src={resolveAsset(article.cover_image)}
              alt={article.title}
              className="h-full w-full object-cover transition-transform duration-300"
            />
          </div>
        )}

        {/* 大标题居中 */}
        <h1 className="mb-4 mt-6 text-center text-3xl font-semibold leading-snug tracking-tight text-gray-900 sm:text-4xl">
          {article.title}
        </h1>

        {/* 元信息 */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {article.category_name && (
            <span className="inline-block rounded-full border border-gray-200 px-4 py-1 text-sm text-gray-600">
              {article.category_name}
            </span>
          )}
          <span className="inline-block rounded-full border border-gray-200 px-4 py-1 text-sm text-gray-600">
            {formatDate(article.created)}
          </span>
          <span className="inline-block rounded-full border border-gray-200 px-4 py-1 text-sm text-gray-600">
            约 {readingTime(article.content)} 分钟
          </span>
        </div>

        <div className="mt-6 border-t border-gray-200" />
      </div>

      {/* 正文 + 目录：双栏布局 */}
      <div className="mx-auto mt-8 grid w-full gap-8 xl:grid-cols-[minmax(0,1fr)_13rem]">
        <article className="mx-auto w-full max-w-3xl px-4 sm:px-0">
          <div className="flex justify-center">
            <div className="w-full max-w-3xl">
              <Markdown content={displayContent} />
            </div>
          </div>

          {/* 底部：标签 + 返回 */}
          <div className="mt-8 border-t border-gray-100 pt-6">
            {article.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-400">标签：</span>
                {article.tags.map((t) => (
                  <Link
                    key={t.id}
                    to={`/?keyword=${encodeURIComponent(t.tag_name)}`}
                    className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 transition hover:bg-gray-200"
                  >
                    #{t.tag_name}
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-6 flex items-center justify-between text-sm">
              <Link
                to="/"
                className="inline-flex items-center gap-1 text-gray-400 transition hover:text-gray-600"
              >
                ← 返回列表
              </Link>
            </div>
          </div>

          {/* 评论区 */}
          <div className="mt-8 border-t border-gray-100 pt-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
              评论
              {comments.length > 0 && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
                  {comments.length}
                </span>
              )}
            </h2>

            {comments.length > 0 ? (
              <div className="mt-4 space-y-4">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-content-center rounded-full bg-gray-200 text-xs font-bold text-gray-500">
                        {(c.username || "U").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-sm font-medium text-gray-800">
                        {c.username || "匿名"}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatDate(c.created)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                      {c.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-400">
                还没有评论，来抢沙发～
              </p>
            )}

            {/* 提交表单 */}
            <div className="mt-5">
              {user ? (
                <>
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={3}
                    placeholder="写下你的评论…"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={submitComment}
                      disabled={submitting}
                      className={btnPrimary}
                    >
                      {submitting ? "提交中…" : "发表评论"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400">
                  <Link to="/login" className="text-blue-600 hover:underline">
                    登录
                  </Link>{" "}
                  后参与评论
                </p>
              )}
            </div>
          </div>
        </article>

        {/* 目录（宽屏显示） */}
        {toc.length > 0 && (
          <aside className="hidden xl:block">
            <nav className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-auto pr-2">
              <p className="mb-3 text-sm font-semibold text-gray-500">目录</p>
              <ul className="border-l border-gray-200">
                {toc.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => scrollToHeading(item.id)}
                      className={`block w-full border-l-2 py-1 text-left transition ${
                        item.level === 2
                          ? "pl-3 text-sm"
                          : item.level === 3
                            ? "pl-7 text-xs"
                            : "pl-5 text-xs"
                      } ${
                        activeId === item.id
                          ? "border-gray-900 font-medium text-gray-900"
                          : "border-transparent text-gray-400 hover:text-gray-700"
                      }`}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
