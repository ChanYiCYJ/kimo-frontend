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

export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner size="lg" />
    </div>
  )
}
