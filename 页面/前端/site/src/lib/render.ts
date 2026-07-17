// ═══════════════════════════════════════════════════════
// 纯函数渲染层 —— 服务端(SSR)与客户端(交互)共用，零副作用、无 Node/DOM 依赖。
// 输出与旧版 index.html 完全一致的 HTML 片段，保证排版不变。
// ═══════════════════════════════════════════════════════

export interface Company { slug: string; name: string; name_zh?: string; logo_color?: string; }
export interface Model {
  slug: string; display_name: string; canonical_id: string; company: Company;
  series?: string; capabilities?: string[]; pricing_method: string; context_window?: string | null;
  official_input_price: number; official_output_price: number; official_currency?: string;
  description?: string; supplier_count?: number; has_online_supplier?: boolean;
}
export interface Price {
  canonical_id: string; supplier_slug: string; supplier_name: string; supplier_type: string;
  route: string; unit?: string; currency?: string; input_price: number; output_price: number;
  is_active: boolean; source_url?: string;
}
export interface Supplier {
  slug: string; name: string; status: string; uptime_7d?: number | null;
  avg_latency_ms?: number | null; payment_methods?: string[];
}
export interface VendorIconEntry {
  vendorId: string;
  file?: string;
  files?: string[];
}
export interface ModelIconMapping {
  prd_models: string[];
  file?: string;
  files?: string[];
  derived_from?: string;
  source_url?: string;
}
export interface Manifest {
  vendors?: VendorIconEntry[];
  model_mappings?: ModelIconMapping[];
}

const ICON_ALIASES: Record<string, string> = {
  bytedance: 'doubao', volcengine: 'doubao', alibaba: 'qwen', 'alibaba-cloud': 'qwen',
  'zhipu-ai': 'zhipu', 'google-gemini': 'google', tencent: 'hunyuan', moonshot: 'kimi',
};
export const PRICING_UNITS: Record<string, string> = {
  per_token: '百万 tokens', per_call: '次', per_image: '张', per_second: '秒',
};

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>'"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] as string));
export const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

const iconPath = (file?: string): string => file ? `/icons/${file}` : '';
const normalizeIconKey = (value: unknown): string => String(value ?? '').trim().toLowerCase();

export function vendorIconFor(company: Company, manifest: Manifest): string {
  const slug = ICON_ALIASES[company.slug] || company.slug;
  const item = (manifest.vendors || []).find((v) => v.vendorId === slug);
  const file = item?.file || item?.files?.[0];
  return iconPath(file);
}
export function modelIconFor(model: Model, manifest: Manifest): string {
  const key = normalizeIconKey(model.series);
  if (!key) return '';

  for (const mapping of manifest.model_mappings || []) {
    const labels = mapping.prd_models || [];
    const index = labels.findIndex((label) => normalizeIconKey(label) === key);
    if (index < 0) continue;

    if (mapping.file) return iconPath(mapping.file);
    if (!mapping.files || mapping.files.length !== labels.length) return '';
    return iconPath(mapping.files[index]);
  }
  return '';
}
export function companyName(m: Model): string { return m.company.name_zh || m.company.name; }
export function unitFor(m: Model): string { return PRICING_UNITS[m.pricing_method] || '单位'; }
export function isToken(m: Model): boolean { return m.pricing_method === 'per_token'; }
export function composite(m: Model): number | null {
  return isToken(m) ? num(m.official_input_price) + num(m.official_output_price) : null;
}
export function priceText(value: number | null, m: Model): string {
  return `¥${num(value).toFixed(2)}<span class="price-unit">/${unitFor(m)}</span>`;
}
export function activePrices(prices: Price[]): Price[] {
  return (prices || []).filter((p) => p.is_active === true && p.source_url);
}
export function quoteTotal(p: Price, m: Model): number {
  return isToken(m) ? num(p.input_price) + num(p.output_price) : num(p.input_price) || num(p.output_price);
}
export function discountFor(m: Model, prices: Price[]): number {
  const official = composite(m);
  const quotes = activePrices(prices);
  if (!official || !quotes.length) return 0;
  const best = Math.min(...quotes.map((p) => quoteTotal(p, m)));
  return Math.max(0, (1 - best / official) * 100);
}

export function modelLogo(m: Model, manifest: Manifest, size = ''): string {
  const icon = modelIconFor(m, manifest);
  const fallbackName = String(m.series || m.display_name || '?').trim();
  const letter = esc((Array.from(fallbackName)[0] || '?').toUpperCase());
  const img = icon
    ? `<img src="${esc(icon)}" alt="" aria-hidden="true" onerror="this.parentElement.classList.add('logo-fallback');this.remove()">`
    : '';
  return `<div class="model-avatar ${size}" aria-hidden="true">${img}<span>${letter}</span></div>`;
}

// 首页表格：单行 HTML（prices = 该模型的全部报价）
export function rowHTML(m: Model, prices: Price[], manifest: Manifest): string {
  const comp = composite(m);
  const ps = activePrices(prices);
  const disc = discountFor(m, prices);
  const caps = m.capabilities || [];
  return (
    '<tr>' +
    '<td><div class="model-cell">' + modelLogo(m, manifest) +
      '<div><div class="model-name"><a href="/models/' + esc(m.slug) + '/">' + esc(m.display_name) + '</a></div>' +
      '<div class="model-tags">' + caps.slice(0, 3).map((c) => '<span class="model-tag">' + esc(c) + '</span>').join('') + '</div></div></div></td>' +
    '<td><span style="font-size:13px;color:var(--color-text-secondary)">' + esc(companyName(m)) + '</span></td>' +
    '<td class="capabilities-cell">' + caps.map(esc).join(' · ') + '</td>' +
    '<td class="price-cell">' + priceText(m.official_input_price, m) + '</td>' +
    '<td class="price-cell">' + priceText(m.official_output_price, m) + '</td>' +
    '<td class="price-cell">' + (comp === null ? '—' : priceText(comp, m)) + '</td>' +
    '<td class="price-cell' + (disc > 0 ? ' price-lowest' : '') + '">' + (disc > 0 ? '-' + disc.toFixed(0) + '%' : '—') + '</td>' +
    '<td style="font-family:var(--font-mono);font-size:13px">' + ps.length + ' 家</td>' +
    '<td><button class="btn-compare" data-compare="' + esc(m.slug) + '">比价 →</button></td>' +
    '</tr>'
  );
}

// 供应商比价表格（详情页 + 抽屉共用）
export function priceTableHTML(m: Model, prices: Price[]): string {
  const ps = activePrices(prices);
  const sorted = [...ps].sort((a, b) => quoteTotal(a, m) - quoteTotal(b, m));
  const min = sorted.length ? quoteTotal(sorted[0], m) : null;
  return (
    '<table class="drawer-table">' +
    '<colgroup><col class="dt-col-supplier"><col class="dt-col-type"><col class="dt-col-route"><col class="dt-col-price"><col class="dt-col-price"><col class="dt-col-composite"><col class="dt-col-action"></colgroup>' +
    '<thead><tr><th>供应方</th><th>类型</th><th>线路</th><th class="dt-num">输入</th><th class="dt-num">输出</th><th class="dt-num">综合</th><th class="dt-action">操作</th></tr></thead><tbody>' +
    sorted.map((p) => {
      const pc = quoteTotal(p, m);
      return '<tr><td class="dt-supplier">' + esc(p.supplier_name) + '</td>' +
        '<td><span class="tag ' + (p.supplier_type === 'official' ? 'tag-official' : 'tag-relay') + '">' + (p.supplier_type === 'official' ? '官方' : '中转') + '</span></td>' +
        '<td class="dt-route">' + esc(p.route) + '</td>' +
        '<td class="price-cell dt-num">¥' + num(p.input_price).toFixed(2) + '</td>' +
        '<td class="price-cell dt-num">¥' + num(p.output_price).toFixed(2) + '</td>' +
        '<td class="price-cell dt-num ' + (pc === min ? 'price-lowest' : '') + '">¥' + pc.toFixed(2) + (pc === min ? '<span class="lowest-badge">最低</span>' : '') + '</td>' +
        '<td class="dt-action"><a href="' + esc(p.source_url) + '" target="_blank" rel="noopener" class="source-link">前往 ↗</a></td></tr>';
    }).join('') +
    '</tbody></table>'
  );
}
