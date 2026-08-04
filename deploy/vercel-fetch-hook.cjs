// ===== Vercel CLI 网络修复钩子 =====
// 背景：Vercel CLI 打包了 undici 5.29 的 dispatcher（ProxyAgent/EnvProxyDispatcher），
// 但它用 Node 原生 `globalThis.fetch`（内置新版 undici）来发起请求，
// 两者跨版本不兼容，导致在需要走 HTTP 代理的环境下报 `TypeError: fetch failed`。
// 修复：当请求携带 dispatcher 时，改用 undici 5.29 自己的 fetch（同版本自洽，可正常走代理）。
// 用法：NODE_OPTIONS="--require /path/to/vercel-fetch-hook.cjs" npx vercel ...
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function findUndici() {
  // 1) 从当前进程可解析的位置查找
  try {
    return { mod: require('undici'), pkgPath: require.resolve('undici') }
  } catch {
    /* 继续 */
  }
  // 2) 在 npx 缓存中查找与 Vercel CLI 配套的 undici（5.29.0）
  const npxRoot = path.join(os.homedir(), '.npm', '_npx')
  try {
    const dirs = fs.readdirSync(npxRoot)
    for (const dir of dirs) {
      const p = path.join(npxRoot, dir, 'node_modules', 'undici')
      if (fs.existsSync(path.join(p, 'package.json'))) {
        return { mod: require(p), pkgPath: path.join(p, 'package.json') }
      }
    }
  } catch {
    /* 忽略 */
  }
  return null
}

try {
  const found = findUndici()
  if (found && typeof found.mod.fetch === 'function') {
    const nativeFetch = globalThis.fetch.bind(globalThis)
    const u = found.mod
    globalThis.fetch = function fetchProxy(input, init) {
      // 携带 dispatcher 的请求（CLI 的 EnvProxyDispatcher/ProxyAgent）走 undici 5.29
      if (init && init.dispatcher) {
        return u.fetch(input, init)
      }
      return nativeFetch(input, init)
    }
    let ver = ''
    try {
      ver = require(found.pkgPath).version
    } catch {
      /* 忽略 */
    }
    console.error(`[hook] undici@${ver} fetch 已启用（代理可用）`)
  } else {
    console.error('[hook] 未找到可用的 undici，跳过补丁')
  }
} catch (e) {
  console.error('[hook] 补丁失败:', e && e.message)
}
