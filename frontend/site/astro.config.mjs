// @ts-check
import { defineConfig } from 'astro/config';

// 纯静态输出（SSG）：构建期把 src/data 中的已验证 JSON 渲染成 HTML。
// 域名确定后设置 SITE_URL；canonical、sitemap 与 robots 会同步切换。
// Reflect keeps this config type-checkable without adding Node types solely for one env read.
const siteUrl = Reflect.get(globalThis, 'process')?.env?.SITE_URL;
export default defineConfig({
  site: siteUrl || 'http://124.223.221.163',
  output: 'static',
  build: {
    format: 'directory', // /models/gpt-5.5/ 形式的干净 URL
  },
  compressHTML: true,
});
