import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { resolveAsset } from '../lib/api'
import { slugify } from '../lib/format'

/** 提取 React 子节点中的纯文本 */
function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return extractText(props?.children)
  }
  return ''
}

/** 给标题加上 id，供目录锚点跳转 */
function headingWithId(Tag: 'h1' | 'h2' | 'h3' | 'h4') {
  return function Heading({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    return (
      <Tag id={slugify(extractText(children))} {...props}>
        {children}
      </Tag>
    )
  }
}

/** 代码块：右上角复制按钮 */
function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false)
  const code = extractText(children)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* 忽略剪贴板错误 */
    }
  }
  return (
    <div className="group/code relative">
      <pre {...props}>{children}</pre>
      <button
        onClick={copy}
        aria-label="复制代码"
        className="absolute right-2.5 top-2.5 rounded-lg bg-white/10 px-2 py-1 text-xs text-gray-400 opacity-0 transition hover:bg-white/25 hover:text-white group-hover/code:opacity-100"
      >
        {copied ? '已复制 ✓' : '复制'}
      </button>
    </div>
  )
}

/**
 * 客户端 Markdown 渲染（避免直接信任服务端 HTML，降低 XSS 风险）
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: headingWithId('h1'),
          h2: headingWithId('h2'),
          h3: headingWithId('h3'),
          h4: headingWithId('h4'),
          pre: CodeBlock,
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveAsset(src)} alt={alt || ''} loading="lazy" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
