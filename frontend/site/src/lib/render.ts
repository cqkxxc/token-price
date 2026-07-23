// ═══════════════════════════════════════════════════════
// 纯函数渲染层 —— 服务端(SSR)与客户端(交互)共用，零副作用、无 Node/DOM 依赖。
// 输出与旧版 index.html 完全一致的 HTML 片段，保证排版不变。
// ═══════════════════════════════════════════════════════

export type PricingMethod = 'per_token' | 'per_call' | 'per_image' | 'per_second';
export type PriceUnit = 'token' | 'call' | 'image' | 'second';
export type SupplierStatus = 'online' | 'degraded' | 'offline' | 'unknown';

export interface Company { slug: string; name: string; name_zh: string; logo_color: string; }
export interface Model {
  slug: string; display_name: string; canonical_id: string; company: Company;
  series: string; capabilities: string[]; pricing_method: PricingMethod; context_window: string | null;
  official_input_price: number; official_output_price: number; official_currency: 'CNY';
  official_price_source: string;
  publish_date: string | null; description: string; supplier_count: number; has_online_supplier: boolean;
}
export interface Price {
  canonical_id: string; supplier_slug: string; supplier_name: string;
  supplier_type: 'official' | 'direct' | 'cloud' | 'aggregator' | 'relay' | 'other';
  route: string; unit: PriceUnit; currency: 'CNY';
  input_price: number; output_price: number; cache_read_price: number | null;
  is_active: boolean; fetched_at: string | null;
}
export interface Supplier {
  slug: string; name: string; description: string;
  payment_methods: string[]; has_invoice: boolean | null; status: SupplierStatus;
  uptime_7d: number | null; avg_latency_ms: number | null; last_checked_at: string | null;
  available_models: number; total_models: number;
}
export interface Stability {
  supplier_slug: string; supplier_name: string; canonical_id: string; model_slug: string;
  route: string; uptime_7d: number | null; avg_latency_ms: number | null;
  samples_7d: number | null; last_checked_at: string; status: SupplierStatus;
  last_response_time_ms: number | null; last_http_status: number | null; last_error: string | null;
  response_text: string | null;
}
export interface DataMeta {
  version: '4.0.0'; data_updated_at: string; source_name: 'Oken';
  total_models: number; total_suppliers: number; source_total_models?: number; excluded_models?: number;
}
export interface QuoteSummary {
  supplierCount: number;
  quoteCount: number;
  bestTotal: number | null;
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
const SUPPLIER_TYPE_TAGS: Record<Price['supplier_type'], { className: string; label: string }> = {
  official: { className: 'tag-official', label: '官方参考' },
  direct: { className: 'tag-official', label: '模型官网' },
  cloud: { className: 'tag-relay', label: '云服务商' },
  aggregator: { className: 'tag-relay', label: '聚合服务商' },
  relay: { className: 'tag-relay', label: '中转站' },
  other: { className: 'tag-relay', label: '其他渠道' },
};

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>'"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] as string));
export const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const MISSING_VALUE = '—';

export function displayText(value: unknown, fallback = MISSING_VALUE): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function normalizedTextList(values: readonly unknown[] | null | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

export function capabilitiesFor(model: Pick<Model, 'capabilities'>): string[] {
  return normalizedTextList(model.capabilities);
}

export function capabilityText(model: Pick<Model, 'capabilities'>): string {
  return capabilitiesFor(model).join(' · ') || MISSING_VALUE;
}

export function shortDateText(value: unknown): string {
  const text = displayText(value, '');
  return text ? text.slice(0, 10) : MISSING_VALUE;
}

export function modelMetaSegments(
  model: Model,
  supplierCount: number,
  quoteCount: number,
  capabilityLimit?: number,
): string[] {
  const capabilities = capabilitiesFor(model);
  const visibleCapabilities = capabilityLimit === undefined
    ? capabilities
    : capabilities.slice(0, Math.max(0, capabilityLimit));
  const contextWindow = displayText(model.context_window, '');
  return [
    displayText(companyName(model)),
    ...(visibleCapabilities.length ? visibleCapabilities : [MISSING_VALUE]),
    contextWindow || `上下文 ${MISSING_VALUE}`,
    `${supplierCount} 家已验证供应商`,
    `${quoteCount} 条报价线路`,
  ];
}

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
export function officialComparisonPrice(m: Model): number {
  return isToken(m)
    ? num(m.official_input_price) + num(m.official_output_price)
    : num(m.official_input_price) || num(m.official_output_price);
}
export function priceNumberText(value: number | null): string {
  const amount = num(value);
  if (amount === 0 || Math.abs(amount) >= 0.01) return amount.toFixed(2);
  return amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
export function priceText(value: number | null, m: Model): string {
  return `¥${priceNumberText(value)}<span class="price-unit">/${unitFor(m)}</span>`;
}
export function officialPriceDisplay(m: Model): {
  primaryLabel: '官方输入价' | '官方单位价';
  primaryHtml: string;
  outputHtml: string;
  compositeHtml: string;
} {
  const tokenPricing = isToken(m);
  const total = composite(m);
  return {
    primaryLabel: tokenPricing ? '官方输入价' : '官方单位价',
    primaryHtml: priceText(tokenPricing ? m.official_input_price : officialComparisonPrice(m), m),
    outputHtml: tokenPricing ? priceText(m.official_output_price, m) : '—',
    compositeHtml: total === null ? '—' : priceText(total, m),
  };
}
export function activePrices(prices: Price[]): Price[] {
  return (prices || []).filter((p) => p.is_active === true);
}
export function quoteTotal(p: Price, m: Model): number {
  return isToken(m) ? num(p.input_price) + num(p.output_price) : num(p.input_price) || num(p.output_price);
}
export function discountFor(m: Model, prices: Price[]): number {
  const official = officialComparisonPrice(m);
  const quotes = activePrices(prices);
  if (!official || !quotes.length) return 0;
  const best = Math.min(...quotes.map((p) => quoteTotal(p, m)));
  return Math.max(0, (1 - best / official) * 100);
}
export function discountForBestTotal(m: Model, bestTotal: number | null): number {
  const official = officialComparisonPrice(m);
  if (!official || bestTotal === null || !Number.isFinite(bestTotal) || bestTotal < 0) return 0;
  return Math.max(0, (1 - bestTotal / official) * 100);
}
export function discountPercentText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  // A positive quote can approach but never equal a 100% discount. Truncate
  // extreme values so the UI never rounds a non-free route to a misleading 100%.
  const displayed = value >= 99
    ? Math.min(99.9, Math.floor(value * 10) / 10)
    : Math.round(value);
  return `${displayed.toFixed(value >= 99 ? 1 : 0).replace(/\.0$/, '')}%`;
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

const STABILITY_LABELS: Record<Stability['status'], string> = {
  online: '正常', degraded: '波动', offline: '离线', unknown: '未知',
};
const stabilityKey = (item: Pick<Stability, 'supplier_slug' | 'canonical_id' | 'route'>): string =>
  `${item.supplier_slug}::${item.canonical_id}::${item.route || 'default'}`;
const normalizeStatus = (value: unknown): Stability['status'] =>
  value === 'online' || value === 'degraded' || value === 'offline' ? value : 'unknown';
const uptimeText = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
const latencyText = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value))}ms`;

function stabilityCellHTML(item?: Stability): string {
  const status = normalizeStatus(item?.status);
  const uptime = uptimeText(item?.uptime_7d);
  const latency = latencyText(item?.avg_latency_ms);
  const checked = item?.last_checked_at ? ` · 最近更新 ${item.last_checked_at}` : '';
  const title = item
    ? `近 7 天稳定率 ${uptime} · 平均响应延迟 ${latency}${checked}`
    : '暂无已验证稳定性数据';
  return '<td class="dt-stability" title="' + esc(title) + '">' +
    '<div class="dt-stability-main"><span class="status-dot ' + status + '" aria-hidden="true"></span>' +
      '<span class="status-text ' + status + '">' + STABILITY_LABELS[status] + '</span></div>' +
    '<div class="dt-stability-detail"><span>' + uptime + '</span><span aria-hidden="true">·</span><span>' + latency + '</span></div></td>';
}

// 首页表格：单行 HTML（prices = 该模型的全部报价）
export function rowHTML(
  m: Model,
  prices: Price[],
  manifest: Manifest,
  summary?: QuoteSummary,
): string {
  const official = officialPriceDisplay(m);
  const ps = activePrices(prices);
  const disc = summary ? discountForBestTotal(m, summary.bestTotal) : discountFor(m, prices);
  const supplierCount = summary?.supplierCount ?? new Set(ps.map((price) => price.supplier_slug)).size;
  const caps = capabilitiesFor(m);
  const capTags = caps.slice(0, 3)
    .map((capability) => '<span class="model-tag">' + esc(capability) + '</span>')
    .join('');
  return (
    '<tr>' +
    '<td><div class="model-cell">' + modelLogo(m, manifest) +
      '<div><div class="model-name"><a href="/models/' + esc(m.slug) + '/">' + esc(m.display_name) + '</a></div>' +
      (capTags ? '<div class="model-tags">' + capTags + '</div>' : '') + '</div></div></td>' +
    '<td><span class="model-company-name">' + esc(companyName(m)) + '</span>' +
      '<small class="official-price-source">价格源 · ' + esc(m.official_price_source) + '</small></td>' +
    '<td class="capabilities-cell">' + esc(capabilityText(m)) + '</td>' +
    '<td class="price-cell">' + official.primaryHtml + '</td>' +
    '<td class="price-cell">' + official.outputHtml + '</td>' +
    '<td class="price-cell">' + official.compositeHtml + '</td>' +
    '<td class="price-cell' + (disc > 0 ? ' price-lowest' : '') + '">' + (disc > 0 ? '-' + discountPercentText(disc) : '—') + '</td>' +
    '<td style="font-family:var(--font-mono);font-size:13px">' + supplierCount + ' 家</td>' +
    '<td><button type="button" class="btn-compare" data-compare="' + esc(m.slug) + '" aria-label="比较 ' + esc(m.display_name) + ' 的供应商报价">比价 →</button></td>' +
    '</tr>'
  );
}

// 供应商比价表格（详情页 + 抽屉共用）
export function priceTableHTML(m: Model, prices: Price[], stability: Stability[] = []): string {
  const ps = activePrices(prices);
  const sorted = [...ps].sort((a, b) => quoteTotal(a, m) - quoteTotal(b, m));
  const min = sorted.length ? quoteTotal(sorted[0], m) : null;
  const tokenPricing = isToken(m);
  const stabilityByRoute = new Map(stability.map((item) => [stabilityKey(item), item]));
  return (
    '<table class="drawer-table">' +
    '<colgroup><col class="dt-col-supplier"><col class="dt-col-type"><col class="dt-col-route"><col class="dt-col-price"><col class="dt-col-price"><col class="dt-col-composite"><col class="dt-col-stability"></colgroup>' +
    '<thead><tr><th>供应方</th><th>类型</th><th>线路</th>' +
      (tokenPricing
        ? '<th class="dt-num dt-sortable" aria-sort="none"><button type="button" class="dt-sort-control" data-price-sort="input"><span>输入</span><i class="sort-arrow" aria-hidden="true"></i></button></th>' +
          '<th class="dt-num dt-sortable" aria-sort="none"><button type="button" class="dt-sort-control" data-price-sort="output"><span>输出</span><i class="sort-arrow" aria-hidden="true"></i></button></th>' +
          '<th class="dt-num dt-sortable active asc" aria-sort="ascending"><button type="button" class="dt-sort-control" data-price-sort="composite"><span>综合</span><i class="sort-arrow" aria-hidden="true"></i></button></th>'
        : '<th class="dt-num dt-sortable active asc" aria-sort="ascending"><button type="button" class="dt-sort-control" data-price-sort="input"><span>单位价</span><i class="sort-arrow" aria-hidden="true"></i></button></th>' +
          '<th class="dt-num">不适用</th><th class="dt-num">不适用</th>') +
      '<th>稳定性</th></tr></thead><tbody>' +
    sorted.map((p) => {
      const pc = quoteTotal(p, m);
      const inputSortPrice = tokenPricing ? num(p.input_price) : pc;
      const supplierTag = SUPPLIER_TYPE_TAGS[p.supplier_type] || SUPPLIER_TYPE_TAGS.other;
      const stabilityItem = stabilityByRoute.get(stabilityKey({
        supplier_slug: p.supplier_slug,
        canonical_id: p.canonical_id,
        route: p.route || 'default',
      }));
      return '<tr data-input-price="' + inputSortPrice + '" data-output-price="' + num(p.output_price) + '" data-composite-price="' + pc + '" data-supplier="' + esc(p.supplier_name) + '"><td class="dt-supplier">' + esc(p.supplier_name) + '</td>' +
        '<td><span class="tag ' + supplierTag.className + '">' + supplierTag.label + '</span></td>' +
        '<td class="dt-route">' + esc(p.route) + '</td>' +
        '<td class="price-cell dt-num ' + (!tokenPricing && pc === min ? 'price-lowest' : '') + '">' + (tokenPricing ? '¥' + priceNumberText(p.input_price) : priceText(pc, m)) + (!tokenPricing && pc === min ? '<span class="lowest-badge">最低</span>' : '') + '</td>' +
        '<td class="price-cell dt-num">' + (tokenPricing ? '¥' + priceNumberText(p.output_price) : '—') + '</td>' +
        '<td class="price-cell dt-num ' + (tokenPricing && pc === min ? 'price-lowest' : '') + '">' + (tokenPricing ? '¥' + priceNumberText(pc) + (pc === min ? '<span class="lowest-badge">最低</span>' : '') : '—') + '</td>' +
        stabilityCellHTML(stabilityItem) + '</tr>';
    }).join('') +
    '</tbody></table>'
  );
}
