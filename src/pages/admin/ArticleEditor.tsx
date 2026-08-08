import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  articleApi,
  categoryApi,
  resolveAsset,
  uploadApi,
} from "../../lib/api";
import type { ArticleDetail, Category } from "../../lib/types";
import { MdEditor } from "../../components/MdEditor";
import { PageSpinner } from "../../components/Spinner";
import { useToast } from "../../lib/toast";
import { readingTime } from "../../lib/format";
import { aiWrite, getAIConfig } from "../../lib/ai";

export function ArticleEditor() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [tagsInput, setTagsInput] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);

  // 加载分类 & 编辑时加载文章
  useEffect(() => {
    categoryApi
      .list()
      .then(setCategories)
      .catch(() => {});
    if (isEdit) {
      articleApi
        .get(Number(id))
        .then((a: ArticleDetail) => {
          setTitle(a.title);
          setDescription(a.description ?? "");
          setContent(a.content);
          setCoverImage(a.cover_image ?? "");
          setCategoryId(a.category_id ?? "");
          setTagsInput(a.tags.map((t) => t.tag_name).join(", "));
        })
        .catch((e: Error) => error(e.message || "加载失败"))
        .finally(() => setLoading(false));
    }
  }, [isEdit, id, error]);

  const onUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadApi.image(file);
      setCoverImage(resolveAsset(res.url));
      success("封面已上传");
    } catch (err) {
      error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      error("请输入文章标题");
      return;
    }
    if (!content.trim()) {
      error("请输入文章内容");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      content,
      description: description.trim() || null,
      cover_image: coverImage || null,
      category_id: categoryId === "" ? null : Number(categoryId),
      tags: tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      if (isEdit) {
        await articleApi.update(Number(id), payload);
        success("文章已更新");
      } else {
        await articleApi.create(payload);
        success("文章已发布");
      }
      navigate("/dashboard/articles");
    } catch (e) {
      error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSpinner />;

  const handleAiGenerate = async (prompt: string) => {
    try {
      const result = await aiWrite(prompt, content || undefined);
      setContent((prev) => (prev ? prev + "\n\n" + result : result));
      success("AI 内容已追加");
    } catch (e) {
      error(e instanceof Error ? e.message : "AI 请求失败");
    }
  };

  const aiEnabled = getAIConfig().enabled;

  const inputCls =
    "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:placeholder:text-gray-500";

  return (
    <div className="fade-up">
      {/* 顶栏：返回 + 标题 + 发布（紧凑） */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-gray-200/70 bg-white/80 px-3 py-2.5 backdrop-blur sm:px-5 lg:top-14 lg:-mx-6 lg:-mt-4 lg:px-6 lg:py-2.5 dark:border-gray-800 dark:bg-gray-950/80">
        <button
          onClick={() => navigate("/dashboard/articles")}
          title="返回"
          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
            />
          </svg>
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入文章标题..."
          className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-gray-900 outline-none placeholder:text-gray-300 dark:text-gray-100 dark:placeholder:text-gray-600"
        />
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60 sm:gap-2 sm:px-5 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          {saving && (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          <span className="hidden sm:inline">
            {isEdit ? "保存修改" : "发布"}
          </span>
          <span className="sm:hidden">
            {saving ? "..." : isEdit ? "保存" : "发布"}
          </span>
        </button>
      </div>

      {/* 主体：编辑器 + 右侧元信息面板 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* 正文编辑器：限宽居中，像写作产品（不撑满整页，避免“很长一条”） */}
        <div className="min-w-0">
          <div className="mx-auto w-full max-w-[760px]">
            <MdEditor
              value={content}
              onChange={setContent}
              height={560}
              aiCommand={aiEnabled ? handleAiGenerate : undefined}
            />
          </div>
        </div>

        {/* 元信息面板（右侧 sticky） */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card space-y-4 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              文章设置
            </h2>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                分类
              </label>
              <select
                value={categoryId}
                onChange={(e) =>
                  setCategoryId(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className={inputCls}
              >
                <option value="">无分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                标签（逗号分隔）
              </label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="React, TypeScript"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                摘要
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="将显示在文章列表中"
                className={`${inputCls} resize-none`}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                封面图
              </label>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={onUploadCover}
                className="hidden"
                id="cover-upload"
              />
              <div
                className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed transition ${
                  coverImage
                    ? "border-gray-300 bg-gray-100/50 dark:border-gray-600 dark:bg-gray-800/50"
                    : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
                }`}
                onClick={() => coverInputRef.current?.click()}
              >
                {uploading ? (
                  <p className="text-xs text-gray-400">上传中...</p>
                ) : coverImage ? (
                  <img
                    src={coverImage}
                    alt="封面"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <svg
                      className="h-5 w-5 text-gray-300"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z"
                      />
                    </svg>
                    <p className="text-xs text-gray-400">点击上传</p>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 text-xs text-gray-400 dark:border-gray-800">
              正文 {content.length} 字 · 约 {readingTime(content)} 分钟
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
