import type { APIRoute } from 'astro';
import { META, MODELS } from '../lib/data';

const escapeXml = (value: string): string => value.replace(/[<>&'\"]/g, (char) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
}[char] || char));

export const GET: APIRoute = ({ site }) => {
  const root = site || new URL('http://124.223.221.163');
  const lastmod = META.data_updated_at || new Date().toISOString();
  const pages = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    { path: '/monitor/', changefreq: 'hourly', priority: '0.7' },
    ...MODELS.map((model) => ({ path: `/models/${model.slug}/`, changefreq: 'daily', priority: '0.8' })),
  ];
  const entries = pages.map(({ path, changefreq, priority }) =>
    `  <url><loc>${escapeXml(new URL(path, root).href)}</loc><lastmod>${escapeXml(lastmod)}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
