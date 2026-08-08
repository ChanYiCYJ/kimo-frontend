import { useEffect, useRef, useState } from "react";
import { mediaApi, resolveAsset, uploadApi } from "../../lib/api";
import type { MediaItem } from "../../lib/types";
import {
  EmptyState,
  PageHeader,
  Skeleton,
  btnPrimary,
} from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../lib/toast";
import { formatDate } from "../../lib/format";

function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type MediaFilter = "all" | "image" | "video";

export function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { success, error } = useToast();

  const load = (p: number) => {
    setLoading(true);
    const mime = filter === "all" ? undefined : filter;
    mediaApi
      .list(p, mime)
      .then((res) => {
        setItems(res.items);
        setTotalPage(res.total_page);
        setTotal(res.total);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(page);
  }, [page, filter]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadApi.image(file);
      success("上传成功");
      setPage(1);
      load(1);
    } catch (err) {
      error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const copyUrl = async (m: MediaItem) => {
    try {
      await navigator.clipboard.writeText(resolveAsset(m.url));
      success("链接已复制");
    } catch {
      error("复制失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await mediaApi.remove(deleting.id);
      success("已删除");
      setDeleting(null);
      if (items.length === 1 && page > 1) setPage((p) => p - 1);
      else load(page);
    } catch (e) {
      error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const isImage = (m: MediaItem) => (m.mime || "").startsWith("image/");

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="媒体库"
        desc={`共 ${total} 个文件`}
        action={
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={btnPrimary}
          >
            {uploading ? (
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
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                />
              </svg>
            )}
            {uploading ? "上传中…" : "上传图片"}
          </button>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onUpload}
        className="hidden"
      />

      {/* 类型筛选 */}
      <div className="flex w-fit gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
        {(
          [
            { v: "all", l: "全部" },
            { v: "image", l: "图片" },
            { v: "video", l: "视频" },
          ] as { v: MediaFilter; l: string }[]
        ).map((f) => (
          <button
            key={f.v}
            onClick={() => {
              setFilter(f.v);
              setPage(1);
            }}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition ${
              filter === f.v
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "媒体库为空" : "没有匹配的文件"}
          description="上传的图片会显示在这里，可在文章/页面中复用链接"
          action={
            filter === "all" ? (
              <button
                onClick={() => inputRef.current?.click()}
                className={btnPrimary}
              >
                上传图片
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <div key={m.id} className="card card-hover group overflow-hidden">
              <div className="relative aspect-video overflow-hidden bg-gray-100 dark:bg-gray-800">
                {isImage(m) ? (
                  <img
                    src={resolveAsset(m.url)}
                    alt={m.original_name || m.filename}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-content-center text-gray-300">
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
                        d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
                      />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/50 p-1.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => copyUrl(m)}
                    className="rounded-lg bg-white/90 px-2 py-1 text-[11px] text-gray-700 transition hover:bg-white"
                  >
                    复制链接
                  </button>
                  <button
                    onClick={() => setDeleting(m)}
                    className="rounded-lg bg-red-500/90 px-2 py-1 text-[11px] text-white transition hover:bg-red-500"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                  {m.original_name || m.filename}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-gray-400">
                  {formatSize(m.size)} · {formatDate(m.created)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {!loading && totalPage > 1 && (
        <div className="flex items-center justify-center pt-2">
          <Pagination page={page} totalPage={totalPage} onChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除文件"
        message={`确定要删除「${deleting?.original_name || deleting?.filename}」吗？此操作不可恢复。`}
        confirmText={busy ? "删除中..." : "删除"}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
