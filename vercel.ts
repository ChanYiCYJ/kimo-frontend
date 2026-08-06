// ===== Vercel 程序化配置（vercel.ts）=====
// 说明：vercel.json 是静态的、不支持环境变量；vercel.ts 在构建时执行，
// 因此可以用 `API_BACKEND` 环境变量动态生成 /api 与 /static 的反代规则。
//
// 别人独立部署时，只需在 Vercel 项目里配置环境变量（Deploy 按钮会自动引导）：
//   API_BACKEND=https://your-api.example.com   （后端地址，不带尾部斜杠）
// 未设置 API_BACKEND 时不会配置代理（前端仅能渲染静态页面，无法联网）。
//
// 与 vercel.json 二选一：项目里已删除 vercel.json，统一使用本文件。
/// <reference types="node" />
import type { VercelConfig } from "@vercel/config/v1";

// 去掉尾部斜杠，避免拼出 //api 之类的双斜杠
const backend = (process.env.API_BACKEND || "").trim().replace(/\/+$/, "");

const rewrites: NonNullable<VercelConfig["rewrites"]> = [];

// Live2D 资源反代（bestdori.com 无 CORS，经 Vercel 服务端转发，独立于后端）
rewrites.push(
  {
    source: "/api/live2d/asset/(.*)",
    destination: "https://bestdori.com/assets/$1",
  },
  {
    source: "/api/live2d/api/(.*)",
    destination: "https://bestdori.com/api/$1",
  },
);

if (backend) {
  rewrites.push(
    // API 反代（服务端转发，无 CORS 问题）
    { source: "/api/(.*)", destination: `${backend}/api/$1` },
    // 上传图片 / 静态资源反代
    { source: "/static/(.*)", destination: `${backend}/static/$1` },
  );
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[vercel.ts] 未设置 API_BACKEND 环境变量：/api 与 /static 将不会代理到后端。" +
      "请在 Vercel 项目设置中配置 API_BACKEND=https://你的后端域名",
  );
}

// SPA 客户端路由回退
rewrites.push({ source: "/(.*)", destination: "/index.html" });

export const config: VercelConfig = {
  framework: "vite",
  buildCommand: "npm run build",
  outputDirectory: "dist",
  rewrites,
  headers: [
    {
      source: "/assets/(.*)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],
};
