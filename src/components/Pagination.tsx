import { useNavigate } from "react-router-dom";

interface PaginationProps {
  page: number;
  totalPage: number;
  /** 前台模式：额外拼接到 query 的参数（走 navigate） */
  extra?: Record<string, string | number | undefined>;
  /** 受控模式：提供后走 onChange 回调，不导航（后台列表用） */
  onChange?: (page: number) => void;
}

const btnBase =
  "rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";

export function Pagination({
  page,
  totalPage,
  extra = {},
  onChange,
}: PaginationProps) {
  const navigate = useNavigate();

  if (totalPage <= 1) return null;

  const go = (p: number) => {
    if (onChange) {
      onChange(p);
      return;
    }
    const sp = new URLSearchParams();
    sp.set("page", String(p));
    Object.entries(extra).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== 0) sp.set(k, String(v));
    });
    navigate(`/?${sp.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 生成页码（最多显示 5 个）
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPage - 4));
  const end = Math.min(totalPage, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav className="flex justify-center">
      <ul className="flex items-center gap-2 text-sm select-none">
        {/* 上一页 */}
        {page > 1 && (
          <li>
            <button
              onClick={() => go(page - 1)}
              className={`${btnBase} px-3 py-1.5`}
            >
              ←
            </button>
          </li>
        )}

        {/* 页码 */}
        {pages.map((p) => (
          <li key={p}>
            <button
              onClick={() => go(p)}
              className={`min-w-[2.25rem] rounded-lg border px-3 py-1.5 text-center transition ${
                p === page
                  ? "pointer-events-none border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900"
                  : btnBase
              }`}
            >
              {p}
            </button>
          </li>
        ))}

        {/* 下一页 */}
        {page < totalPage && (
          <li>
            <button
              onClick={() => go(page + 1)}
              className={`${btnBase} px-3 py-1.5`}
            >
              →
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
