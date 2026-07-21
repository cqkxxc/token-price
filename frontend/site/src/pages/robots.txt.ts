import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const root = site || new URL('http://124.223.221.163');
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', root).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
