// @ts-check
import { defineConfig } from 'astro/config';

// 纯静态输出（SSG）：构建期把 5 个 JSON 渲染成 HTML，SEO 最佳。
// 部署到子路径时改 `base`，换域名改 `site`（影响 canonical / sitemap）。
export default defineConfig({
  site: 'https://example.com',
  output: 'static',
  build: {
    format: 'directory', // /models/gpt-5.5/ 形式的干净 URL
  },
  compressHTML: true,
});
