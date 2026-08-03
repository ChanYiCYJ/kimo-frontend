import MDEditor, { commands, type ICommand } from '@uiw/react-md-editor'
import { resolveAsset, uploadApi } from '../lib/api'
import { useToast } from '../lib/toast'

/**
 * 上传图片工具命令：上传到后端 /upload/image 后插入 Markdown
 */
function createUploadCommand(onError?: (msg: string) => void): ICommand {
  return {
    name: 'upload-image',
    keyCommand: 'upload-image',
    buttonProps: { 'aria-label': '上传图片', title: '上传图片' },
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21zM15.75 8.25a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
        />
      </svg>
    ),
    execute: (_state, api) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const res = await uploadApi.image(file)
          api.replaceSelection(`\n![${file.name}](${resolveAsset(res.url)})\n`)
        } catch (e) {
          onError?.(e instanceof Error ? e.message : '图片上传失败')
        }
      }
      input.click()
    },
  }
}

interface MdEditorProps {
  value: string
  onChange: (value: string) => void
  height?: number
  placeholder?: string
}

export function MdEditor({ value, onChange, height = 520, placeholder = '在这里输入 Markdown 内容...' }: MdEditorProps) {
  const { error } = useToast()
  return (
    <div data-color-mode="light" className="w-full overflow-hidden rounded-2xl">
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        height={height}
        preview="live"
        visibleDragbar
        commands={[...commands.getCommands(), createUploadCommand((msg) => error(msg))]}
        textareaProps={{ placeholder }}
      />
    </div>
  )
}
