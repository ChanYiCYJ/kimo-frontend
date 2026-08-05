import { useState } from "react";
import { createPortal } from "react-dom";

interface KbNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export function KbPicker({
  selected,
  onToggle,
  onInsert,
  onClose,
  webSearchOn,
  onToggleWebSearch,
  browseAgentOn,
  onToggleBrowseAgent,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  onInsert: (notes: KbNote[]) => void;
  onClose: () => void;
  webSearchOn: boolean;
  onToggleWebSearch: () => void;
  browseAgentOn: boolean;
  onToggleBrowseAgent: () => void;
}) {
  const [notes] = useState<KbNote[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]");
    } catch {
      return [];
    }
  });
  const [listOpen, setListOpen] = useState(false);

  // 点条目 = 直接选中并插入（不再需要「插入选中」按钮）
  const handlePick = (n: KbNote) => {
    onToggle(n.id);
    onInsert([n]);
  };

  return createPortal(
    <div className="fixed bottom-20 left-4 right-4 z-[100] mx-auto max-w-lg animate-[kslideUp_0.25s_ease-out] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:left-16 sm:right-auto sm:w-96">
      {/* 头部：标题 + 关闭 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3.5 py-2.5 dark:border-gray-800">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          添加
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
      <div className="px-3 py-2.5">
        {/* 网络访问：网络搜索 / 浏览 Agent 互斥切换（都是联网，二选一） */}
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
          网络访问
        </p>
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
          <button
            onClick={onToggleWebSearch}
            className={
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition " +
              (webSearchOn
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200")
            }
          >
            网络搜索
          </button>
          <button
            onClick={onToggleBrowseAgent}
            className={
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition " +
              (browseAgentOn
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200")
            }
          >
            浏览 Agent
          </button>
        </div>
        {/* 知识库条目：点击即选中插入 */}
        <button
          onClick={() => setListOpen(!listOpen)}
          className="mt-2 flex w-full items-center justify-between rounded-xl px-2 py-2 transition hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <span className="flex items-center gap-2.5 text-sm font-medium text-gray-600 dark:text-gray-300">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
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
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
            </span>
            知识库条目
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {notes.length}
            </span>
          </span>
          <svg
            className={
              "h-4 w-4 text-gray-400 transition-transform " +
              (listOpen ? "rotate-180" : "")
            }
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {listOpen && (
          <div className="mt-1 max-h-52 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-400">
                暂无条目，请在 Agent 编辑器中创建
              </p>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handlePick(n)}
                  className="group flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span
                    className={
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition " +
                      (selected.includes(n.id)
                        ? "border-gray-900 bg-gray-900 dark:border-gray-200 dark:bg-gray-200"
                        : "border-gray-300 dark:border-gray-600")
                    }
                  >
                    {selected.includes(n.id) && (
                      <svg
                        className="h-3 w-3 text-white dark:text-gray-900"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        "block truncate text-sm font-medium " +
                        (selected.includes(n.id)
                          ? "text-gray-900 dark:text-gray-100"
                          : "text-gray-700 dark:text-gray-200")
                      }
                    >
                      {n.title}
                    </span>
                    <span className="line-clamp-1 block text-xs text-gray-400">
                      {n.content.slice(0, 80)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
