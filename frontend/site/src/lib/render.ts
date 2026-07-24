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
  bestOnlineTotal: number | null;
  bestStableTotal: number | null;
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
export const STABLE_UPTIME_THRESHOLD = 99;
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
  compositeLabel: '官方预计成本' | '官方单位价';
  primaryHtml: string;
  outputHtml: string;
  compositeHtml: string;
} {
  const tokenPricing = isToken(m);
  const total = composite(m);
  return {
    primaryLabel: tokenPricing ? '官方输入价' : '官方单位价',
    compositeLabel: tokenPricing ? '官方预计成本' : '官方单位价',
    primaryHtml: priceText(tokenPricing ? m.official_input_price : officialComparisonPrice(m), m),
    outputHtml: tokenPricing ? priceText(m.official_output_price, m) : '—',
    compositeHtml: total === null ? '—' : `¥${priceNumberText(total)}`,
  };
}
export function activePrices(prices: Price[]): Price[] {
  return (prices || []).filter((p) => p.is_active === true);
}
export function quoteTotal(p: Price, m: Model): number {
  return isToken(m) ? num(p.input_price) + num(p.output_price) : num(p.input_price) || num(p.output_price);
}
const priceStabilityKey = (item: Pick<Stability, 'supplier_slug' | 'canonical_id' | 'route'>): string =>
  `${item.supplier_slug}::${item.canonical_id}::${item.route || 'default'}`;
const isOnlineRoute = (item?: Stability): boolean => item?.status === 'online';
const isStableRoute = (item?: Stability): boolean => (
  isOnlineRoute(item)
  && item?.uptime_7d != null
  && Number(item.uptime_7d) >= STABLE_UPTIME_THRESHOLD
);
const minimumTotal = (model: Model, quotes: Price[]): number | null => (
  quotes.length ? Math.min(...quotes.map((price) => quoteTotal(price, model))) : null
);

export function quoteSummary(
  model: Model,
  prices: Price[],
  stability: Stability[] = [],
): QuoteSummary {
  const quotes = activePrices(prices);
  const stabilityByRoute = new Map(stability.map((item) => [priceStabilityKey(item), item]));
  const withStability = quotes.map((price) => ({
    price,
    stability: stabilityByRoute.get(priceStabilityKey(price)),
  }));
  return {
    supplierCount: new Set(quotes.map((price) => price.supplier_slug)).size,
    quoteCount: quotes.length,
    bestTotal: minimumTotal(model, quotes),
    bestOnlineTotal: minimumTotal(
      model,
      withStability.filter(({ stability: item }) => isOnlineRoute(item)).map(({ price }) => price),
    ),
    bestStableTotal: minimumTotal(
      model,
      withStability.filter(({ stability: item }) => isStableRoute(item)).map(({ price }) => price),
    ),
  };
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

function stabilityCellHTML(item?: Stability, riskHtml = ''): string {
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
    '<div class="dt-stability-detail"><span>' + uptime + '</span><span aria-hidden="true">·</span><span>' + latency + '</span></div>' +
    riskHtml + '</td>';
}

const compactPriceText = (value: number | null): string => (
  value === null ? MISSING_VALUE : `¥${priceNumberText(value)}`
);

export function quoteMinimumsHTML(summary: QuoteSummary, className: string): string {
  return '<dl class="' + className + '">' +
    '<div><dt>全部最低</dt><dd>' + compactPriceText(summary.bestTotal) + '</dd></div>' +
    '<div><dt>在线最低</dt><dd>' + compactPriceText(summary.bestOnlineTotal) + '</dd></div>' +
    '<div><dt>稳定最低</dt><dd>' + compactPriceText(summary.bestStableTotal) + '</dd></div>' +
  '</dl>';
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
  const resolvedSummary = summary ?? quoteSummary(m, prices);
  const supplierCount = resolvedSummary.supplierCount ?? new Set(ps.map((price) => price.supplier_slug)).size;
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
    '<td class="quote-minimums-cell">' + quoteMinimumsHTML(resolvedSummary, 'quote-minimums quote-minimums-table') + '</td>' +
    '<td style="font-family:var(--font-mono);font-size:13px">' + supplierCount + ' 家</td>' +
    '<td><button type="button" class="btn-compare" data-compare="' + esc(m.slug) + '" aria-label="查看 ' + esc(m.display_name) + ' 的供应商报价">查看报价</button></td>' +
    '</tr>'
  );
}

interface QuoteRouteRecord {
  price: Price;
  stability?: Stability;
  total: number;
  online: boolean;
  stable: boolean;
}

function routeRiskHTML(model: Model, route: QuoteRouteRecord): string {
  const badges: Array<{ className: string; label: string }> = [];
  const status = normalizeStatus(route.stability?.status);
  if (!route.stability || status === 'unknown') {
    badges.push({ className: 'unknown', label: '未监控' });
  } else if (status === 'degraded') {
    badges.push({ className: 'degraded', label: '存在波动' });
  } else if (status === 'offline') {
    badges.push({
      className: 'offline',
      label: route.stability.uptime_7d != null && route.stability.uptime_7d <= 50 ? '长期离线' : '离线',
    });
  }
  const official = officialComparisonPrice(model);
  if (
    official > 0
    && route.total < official * 0.1
    && route.price.supplier_type !== 'official'
    && route.price.supplier_type !== 'direct'
  ) {
    badges.push({ className: 'price-anomaly', label: '异常低价' });
  }
  if (!badges.length) return '';
  return '<span class="route-risk-list">' + badges.map((badge) => (
    '<span class="route-risk ' + badge.className + '">' + badge.label + '</span>'
  )).join('') + '</span>';
}

function routeStabilityHTML(item?: Stability): string {
  const status = normalizeStatus(item?.status);
  const label = item ? STABILITY_LABELS[status] : '未监控';
  return '<span class="mobile-route-stability ' + status + '">' +
    '<span class="status-dot ' + status + '" aria-hidden="true"></span>' +
    '<span>' + label + '</span><small>' + uptimeText(item?.uptime_7d) + ' · ' + latencyText(item?.avg_latency_ms) + '</small>' +
  '</span>';
}

function quoteOverviewHTML(model: Model, summary: QuoteSummary): string {
  const value = (tier: 'all' | 'online' | 'stable', amount: number | null) => (
    '<dd data-price-tier="' + tier + '">' + compactPriceText(amount) + '</dd>'
  );
  return '<section class="quote-overview" aria-labelledby="quoteOverviewTitle">' +
    '<div class="quote-overview-heading"><div><span class="filter-kicker">PRICE BASIS</span>' +
      '<h3 id="quoteOverviewTitle">最低价口径</h3></div>' +
      '<p>' + (isToken(model) ? '预计成本默认按输入、输出各 100 万 tokens 计算' : '按模型计价单位比较') + '</p></div>' +
    '<dl class="quote-overview-values">' +
      '<div><dt>全部报价最低</dt>' + value('all', summary.bestTotal) + '<small>包含未监控与波动线路</small></div>' +
      '<div><dt>已验证在线最低</dt>' + value('online', summary.bestOnlineTotal) + '<small>最近监控状态正常</small></div>' +
      '<div><dt>稳定线路最低</dt>' + value('stable', summary.bestStableTotal) + '<small>近 7 天稳定率 ≥ ' + STABLE_UPTIME_THRESHOLD + '%</small></div>' +
    '</dl></section>';
}

function workloadControlsHTML(model: Model): string {
  if (!isToken(model)) return '';
  return '<div class="pricing-workload" role="group" aria-label="预计成本工作量">' +
    '<span class="pricing-workload-label">预计用量</span>' +
    '<label><span>输入</span><input type="number" min="0" step="0.1" value="1" inputmode="decimal" data-workload-input><small>百万 tokens</small></label>' +
    '<label><span>输出</span><input type="number" min="0" step="0.1" value="1" inputmode="decimal" data-workload-output><small>百万 tokens</small></label>' +
  '</div>';
}

function routeDataAttributes(route: QuoteRouteRecord): string {
  return ' data-price-route data-input-price="' + num(route.price.input_price) +
    '" data-output-price="' + num(route.price.output_price) +
    '" data-composite-price="' + route.total +
    '" data-route-online="' + String(route.online) +
    '" data-route-stable="' + String(route.stable) + '"';
}

function mobileSupplierGroupsHTML(model: Model, routes: QuoteRouteRecord[]): string {
  const grouped = new Map<string, QuoteRouteRecord[]>();
  for (const route of routes) {
    if (!grouped.has(route.price.supplier_slug)) grouped.set(route.price.supplier_slug, []);
    grouped.get(route.price.supplier_slug)!.push(route);
  }
  const preferredRoute = (items: QuoteRouteRecord[]): QuoteRouteRecord => {
    const online = items.filter((item) => item.online);
    return [...(online.length ? online : items)].sort((a, b) => a.total - b.total)[0];
  };
  const groups = [...grouped.values()].sort((a, b) => preferredRoute(a).total - preferredRoute(b).total);
  return '<div class="supplier-quote-list" aria-label="按供应商分组的报价">' + groups.map((items) => {
    const preferred = preferredRoute(items);
    const supplierTag = SUPPLIER_TYPE_TAGS[preferred.price.supplier_type] || SUPPLIER_TYPE_TAGS.other;
    return '<details class="supplier-quote-group">' +
      '<summary><span class="supplier-quote-summary-main"><span class="supplier-quote-name">' + esc(preferred.price.supplier_name) + '</span>' +
        '<span class="tag ' + supplierTag.className + '">' + supplierTag.label + '</span>' + routeRiskHTML(model, preferred) + '</span>' +
        '<span class="supplier-quote-summary-price"><small>' + (isToken(model) ? '预计成本' : '单位价') + '</small>' +
          '<strong data-workload-total data-input-price="' + num(preferred.price.input_price) + '" data-output-price="' + num(preferred.price.output_price) + '">¥' + priceNumberText(preferred.total) + '</strong>' +
          '<span>' + esc(preferred.price.route) + ' · ' + items.length + ' 条线路</span></span>' +
        routeStabilityHTML(preferred.stability) + '<span class="supplier-quote-chevron" aria-hidden="true"></span></summary>' +
      '<div class="supplier-route-list">' + [...items].sort((a, b) => a.total - b.total).map((route) => (
        '<div class="supplier-route"' + routeDataAttributes(route) + '>' +
          '<div class="supplier-route-heading"><strong>' + esc(route.price.route) + '</strong>' + routeRiskHTML(model, route) + '</div>' +
          '<dl><div><dt>输入</dt><dd>' + (isToken(model) ? '¥' + priceNumberText(route.price.input_price) : MISSING_VALUE) + '</dd></div>' +
            '<div><dt>输出</dt><dd>' + (isToken(model) ? '¥' + priceNumberText(route.price.output_price) : MISSING_VALUE) + '</dd></div>' +
            '<div><dt>' + (isToken(model) ? '预计成本' : '单位价') + '</dt><dd data-workload-total data-input-price="' + num(route.price.input_price) + '" data-output-price="' + num(route.price.output_price) + '">¥' + priceNumberText(route.total) + '</dd></div>' +
            '<div><dt>缓存读取</dt><dd>' + (route.price.cache_read_price == null ? MISSING_VALUE : '¥' + priceNumberText(route.price.cache_read_price)) + '</dd></div></dl>' +
          routeStabilityHTML(route.stability) +
        '</div>'
      )).join('') + '</div></details>';
  }).join('') + '</div>';
}

// 供应商报价（详情页 + 抽屉共用）：桌面表格与移动端供应商分组共用同一份线路数据。
export function priceTableHTML(model: Model, prices: Price[], stability: Stability[] = []): string {
  const tokenPricing = isToken(model);
  const stabilityByRoute = new Map(stability.map((item) => [stabilityKey(item), item]));
  const routes: QuoteRouteRecord[] = activePrices(prices).map((price) => {
    const routeStability = stabilityByRoute.get(stabilityKey(price));
    return {
      price,
      stability: routeStability,
      total: quoteTotal(price, model),
      online: isOnlineRoute(routeStability),
      stable: isStableRoute(routeStability),
    };
  }).sort((a, b) => a.total - b.total);
  const summary = quoteSummary(model, prices, stability);
  const min = summary.bestTotal;

  const table = '<div class="quote-table-scroll"><table class="drawer-table">' +
    '<colgroup><col class="dt-col-supplier"><col class="dt-col-type"><col class="dt-col-route"><col class="dt-col-price"><col class="dt-col-price"><col class="dt-col-composite"><col class="dt-col-stability"></colgroup>' +
    '<thead><tr><th>供应方</th><th>类型</th><th>线路</th>' +
      (tokenPricing
        ? '<th class="dt-num dt-sortable" aria-sort="none"><button type="button" class="dt-sort-control" data-price-sort="input"><span>输入</span><i class="sort-arrow" aria-hidden="true"></i></button></th>' +
          '<th class="dt-num dt-sortable" aria-sort="none"><button type="button" class="dt-sort-control" data-price-sort="output"><span>输出</span><i class="sort-arrow" aria-hidden="true"></i></button></th>' +
          '<th class="dt-num dt-sortable active asc" aria-sort="ascending"><button type="button" class="dt-sort-control" data-price-sort="composite"><span>预计成本</span><i class="sort-arrow" aria-hidden="true"></i></button></th>'
        : '<th class="dt-num dt-sortable active asc" aria-sort="ascending"><button type="button" class="dt-sort-control" data-price-sort="input"><span>单位价</span><i class="sort-arrow" aria-hidden="true"></i></button></th>' +
          '<th class="dt-num">不适用</th><th class="dt-num">不适用</th>') +
      '<th>稳定性</th></tr></thead><tbody>' + routes.map((route) => {
        const price = route.price;
        const supplierTag = SUPPLIER_TYPE_TAGS[price.supplier_type] || SUPPLIER_TYPE_TAGS.other;
        return '<tr' + routeDataAttributes(route) + ' data-supplier="' + esc(price.supplier_name) + '"><td class="dt-supplier">' + esc(price.supplier_name) + '</td>' +
          '<td><span class="tag ' + supplierTag.className + '">' + supplierTag.label + '</span></td>' +
          '<td class="dt-route">' + esc(price.route) + '</td>' +
          '<td class="price-cell dt-num ' + (!tokenPricing && route.total === min ? 'price-lowest' : '') + '">' + (tokenPricing ? '¥' + priceNumberText(price.input_price) : priceText(route.total, model)) + (!tokenPricing && route.total === min ? '<span class="lowest-badge">全部最低</span>' : '') + '</td>' +
          '<td class="price-cell dt-num">' + (tokenPricing ? '¥' + priceNumberText(price.output_price) : MISSING_VALUE) + '</td>' +
          '<td class="price-cell dt-num ' + (tokenPricing && route.total === min ? 'price-lowest' : '') + '" data-workload-total data-input-price="' + num(price.input_price) + '" data-output-price="' + num(price.output_price) + '">' + (tokenPricing ? '¥' + priceNumberText(route.total) + (route.total === min ? '<span class="lowest-badge">全部最低</span>' : '') : MISSING_VALUE) + '</td>' +
          stabilityCellHTML(route.stability, routeRiskHTML(model, route)) + '</tr>';
      }).join('') + '</tbody></table></div>';

  return '<div class="quote-comparison" data-price-comparison data-token-pricing="' + String(tokenPricing) + '">' +
    quoteOverviewHTML(model, summary) + workloadControlsHTML(model) + table + mobileSupplierGroupsHTML(model, routes) +
  '</div>';
}
