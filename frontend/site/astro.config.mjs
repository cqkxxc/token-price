// @ts-check
import { defineConfig } from 'astro/config';

// 纯静态输出（SSG）：构建期把 5 个 JSON 渲染成 HTML，SEO 最佳。
// 正式上线时设置 SITE_URL=https://example.com，canonical / sitemap / robots 会同步更新。
export default defineConfig({
  site: process.env.SITE_URL || 'http://124.223.221.163',
  output: 'static',
  build: {
    format: 'directory', // /models/gpt-5.5/ 形式的干净 URL
  },
  compressHTML: true,
});
