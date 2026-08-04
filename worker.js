// ===== Kimo 前端 — Cloudflare Workers 适配脚本 =====
// 职责：
//  1. /api/* 与 /static/* 反代到真实后端（API_BACKEND，服务端转发无 CORS 问题）
//  2. 其余请求交给 Cloudflare Assets 托管 dist 静态资源；
//     前端路由（/ai、/article/:id、/page/:name 等）的刷新回退由
//     wrangler.jsonc 里 assets.not_found_handling = "single-page-application" 处理
//
// 环境变量：
//  - API_BACKEND  后端地址，不带尾部斜杠，例如 https://api.yogofor.top
//
// 本地预览：npx wrangler dev
// 部署：    npm run deploy:cf   （或 npx wrangler deploy）

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname
    const backend = (env.API_BACKEND || '').trim().replace(/\/+$/, '')

    // 1) API / 上传静态资源反代
    if (pathname.startsWith('/api/') || pathname.startsWith('/static/')) {
      if (!backend) {
        return new Response('API_BACKEND not configured', { status: 502 })
      }
      const target = backend + pathname + url.search
      const headers = new Headers(request.headers)
      headers.set('Host', new URL(backend).host)
      return fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
      })
    }

    // 2) 静态资源 / SPA 回退（由 ASSETS binding + single-page-application 处理）
    return env.ASSETS.fetch(request)
  },
}
