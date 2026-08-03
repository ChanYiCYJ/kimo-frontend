import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { settingApi } from './api'
import type { SiteSettings } from './types'

interface SiteContextValue {
  settings: SiteSettings
  loaded: boolean
  refresh: () => Promise<void>
}

const DEFAULT_SETTINGS: SiteSettings = {
  title: 'Kimo',
  ltitle: '记录技术、生活与思考',
  avatar: '/favicon.svg',
  background: 'https://api.1314.cool/bingimg',
  footer: '© Kimo · Powered by FastAPI + React',
}

const SiteContext = createContext<SiteContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  refresh: async () => {},
})

export function SiteProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await settingApi.all()
      setSettings({ ...DEFAULT_SETTINGS, ...s })
    } catch {
      /* 忽略，使用默认 */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 同步文档标题
  useEffect(() => {
    document.title = settings.title ? `${settings.title} · 个人博客` : 'Kimo · 个人博客'
  }, [settings.title])

  const value = useMemo(() => ({ settings, loaded, refresh }), [settings, loaded, refresh])

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite(): SiteContextValue {
  return useContext(SiteContext)
}
