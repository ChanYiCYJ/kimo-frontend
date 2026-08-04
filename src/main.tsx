import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './lib/theme'
import { aiChat } from './lib/ai'
import './index.css'
import App from './App.tsx'

// 暴露给自定义 HTML 页面的全局 AI 接口
;(window as unknown as Record<string, unknown>).kimoAI = {
  chat: async (msg: string, system?: string) => aiChat(msg, system),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
