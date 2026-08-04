import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { SiteProvider } from './lib/site'
import { ToastProvider } from './lib/toast'
import { Layout } from './components/Layout'
import { AdminLayout } from './components/admin/AdminLayout'
import { PageSpinner } from './components/Spinner'
import { Home } from './pages/Home'
import { Article } from './pages/Article'
import { PageView } from './pages/PageView'
import { AICenter } from './pages/AICenter'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'

// 管理后台页面按需加载（含 Markdown 编辑器，体积较大）
const DashboardHome = lazy(() =>
  import('./pages/admin/DashboardHome').then((m) => ({ default: m.DashboardHome })),
)
const ManageArticles = lazy(() =>
  import('./pages/admin/ManageArticles').then((m) => ({ default: m.ManageArticles })),
)
const ArticleEditor = lazy(() =>
  import('./pages/admin/ArticleEditor').then((m) => ({ default: m.ArticleEditor })),
)
const ManagePages = lazy(() =>
  import('./pages/admin/ManagePages').then((m) => ({ default: m.ManagePages })),
)
const PageEditor = lazy(() =>
  import('./pages/admin/PageEditor').then((m) => ({ default: m.PageEditor })),
)
const AIManage = lazy(() =>
  import('./pages/admin/AIManage').then((m) => ({ default: m.AIManage })),
)
const CategoriesTags = lazy(() =>
  import('./pages/admin/CategoriesTags').then((m) => ({ default: m.CategoriesTags })),
)
const Settings = lazy(() =>
  import('./pages/admin/Settings').then((m) => ({ default: m.Settings })),
)
const UserManagement = lazy(() =>
  import('./pages/admin/UserManagement').then((m) => ({ default: m.UserManagement })),
)

function lazyEl(Comp: ComponentType) {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Comp />
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SiteProvider>
          <ToastProvider>
            <Routes>
              {/* 前台 */}
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/article/:id" element={<Article />} />
                <Route path="/page/:name" element={<PageView />} />
                <Route path="/ai" element={<AICenter />} />
                <Route path="/ai/:botId" element={<AICenter />} />
                <Route path="/login" element={<Login />} />
                <Route path="*" element={<NotFound />} />
              </Route>

              {/* 管理后台 */}
              <Route path="/dashboard" element={<AdminLayout />}>
                <Route index element={lazyEl(DashboardHome)} />
                <Route path="articles" element={lazyEl(ManageArticles)} />
                <Route path="articles/new" element={lazyEl(ArticleEditor)} />
                <Route path="articles/:id/edit" element={lazyEl(ArticleEditor)} />
                <Route path="pages" element={lazyEl(ManagePages)} />
                <Route path="pages/new" element={lazyEl(PageEditor)} />
                <Route path="pages/:id/edit" element={lazyEl(PageEditor)} />
                <Route path="ai" element={lazyEl(AIManage)} />
                <Route path="categories" element={lazyEl(CategoriesTags)} />
                <Route path="settings" element={lazyEl(Settings)} />
                <Route path="users" element={lazyEl(UserManagement)} />
              </Route>
            </Routes>
          </ToastProvider>
        </SiteProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
