import { useEffect, useState } from 'react'

export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'h-4 w-4 border-2', md: 'h-7 w-7 border-[3px]', lg: 'h-10 w-10 border-4' }
  return (
    <div
      className={`inline-block animate-spin rounded-full border-gray-200 border-t-gray-700 ${sizes[size]} ${className}`}
      role="status"
      aria-label="加载中"
    />
  )
}

/** 打字机效果：像 CLI 一样逐字显现（带闪烁光标） */
export function TypeWriter({
  text = 'Think Different',
  speed = 90,
  className = '',
}: {
  text?: string
  speed?: number
  className?: string
}) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const t = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          window.clearInterval(t)
          return v
        }
        return v + 1
      })
    }, speed)
    return () => window.clearInterval(t)
  }, [text, speed])
  return (
    <span className={`font-mono ${className}`}>
      {text.slice(0, n)}
      <span className="ml-0.5 inline-block animate-pulse">▌</span>
    </span>
  )
}

/** 整页加载：Think Different 打字机（简洁、帅） */
export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
      <TypeWriter
        text="Think Different"
        className="text-xl font-medium tracking-[0.2em] text-gray-500 dark:text-gray-400"
      />
      <p className="font-mono text-xs text-gray-300 dark:text-gray-600">$ loading ...</p>
    </div>
  )
}
