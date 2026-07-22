// ═══════════════════════════════════════════════════════
// 首页客户端交互 —— 筛选 / 排序 / 搜索 / 热门模型 / 比价抽屉。
// 初始表格由 SSR 输出（SEO 友好），本脚本负责后续的动态重渲染。
// ═══════════════════════════════════════════════════════
import {
  rowHTML, priceTableHTML, modelLogo, companyName, composite, activePrices,
  discountForBestTotal, discountPercentText, officialComparisonPrice,
  officialPriceDisplay, isToken, num, esc,
  type Model, type Price, type Manifest, type QuoteSummary, type Stability,
} from '../lib/render';

type CompactQuoteSummary = [number, number, number | null];
interface Dataset {
  v?: number;
  models: Model[];
  r?: CompactQuoteSummary[];
  meta: { data_updated_at?: string };
  manifest: Manifest;
}
const raw = document.getElementById('__DATA__')?.textContent || '{}';
const DATA: Dataset = JSON.parse(raw);
const MODELS = DATA.models || [];
const MANIFEST = DATA.manifest || { vendors: [] };
const META = DATA.meta || {};
const SUMMARIES: QuoteSummary[] = MODELS.map((model, index) => {
  const row = DATA.r?.[index];
  return row
    ? { supplierCount: row[0], quoteCount: row[1], bestTotal: row[2] }
    : { supplierCount: model.supplier_count || 0, quoteCount: 0, bestTotal: null };
});
const modelIndex = new Map(MODELS.map((model, index) => [model.canonical_id, index]));
const summaryOf = (model: Model): QuoteSummary =>
  SUMMARIES[modelIndex.get(model.canonical_id) ?? -1]
  ?? { supplierCount: model.supplier_count || 0, quoteCount: 0, bestTotal: null };

// ── 状态 ────────────────────────────────────────────────
let activeCompany: string | null = null;
let activeCapability: string | null = null;
let searchQuery = '';
let hotModelKey: string | null = null;
let sort = { f: 'composite_price', asc: false };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function homeRowHTML(m: Model): string {
  const summary = summaryOf(m);
  let html = rowHTML(m, [], MANIFEST, summary);
  if (!summary.quoteCount) {
    html = html.replace('>0 家</td>', '><span class="verified-quote-status is-empty">暂无已验证报价</span></td>');
  }
  return html;
}

function mobileCardHTML(m: Model): string {
  const summary = summaryOf(m);
  const official = officialPriceDisplay(m);
  const discount = discountForBestTotal(m, summary.bestTotal);
  const caps = (m.capabilities || []).slice(0, 3);
  const quoteStatus = summary.quoteCount
    ? `${summary.supplierCount} 家供应商 · ${summary.quoteCount} 条线路`
    : '暂无已验证报价';

  return '<article class="model-result-card">' +
    '<div class="model-result-card-head">' + modelLogo(m, MANIFEST, 'model-result-logo') +
      '<div class="model-result-identity"><h3><a href="/models/' + esc(m.slug) + '/">' + esc(m.display_name) + '</a></h3>' +
      '<p>' + esc(companyName(m)) + '</p></div>' +
      '<button type="button" class="btn-compare model-card-compare" data-compare="' + esc(m.slug) +
        '" aria-label="比较 ' + esc(m.display_name) + ' 的供应商报价">比价 <span aria-hidden="true">→</span></button></div>' +
    (caps.length ? '<div class="model-result-tags">' + caps.map((cap) => '<span>' + esc(cap) + '</span>').join('') + '</div>' : '') +
    '<dl class="model-result-prices">' +
      '<div><dt>' + official.primaryLabel + '</dt><dd>' + official.primaryHtml + '</dd></div>' +
      '<div><dt>官方输出价</dt><dd>' + official.outputHtml + '</dd></div>' +
      '<div><dt>官方综合价</dt><dd>' + official.compositeHtml + '</dd></div>' +
    '</dl>' +
    '<div class="model-result-card-foot"><span class="verified-quote-status' + (summary.quoteCount ? '' : ' is-empty') + '">' +
      quoteStatus + '</span>' +
      (discount > 0 ? '<span class="model-result-discount">最低约省 ' + discountPercentText(discount) + '</span>' : '') +
    '</div></article>';
}

// ── 筛选 + 排序 ─────────────────────────────────────────
function filtered(): Model[] {
  let f = [...MODELS];
  if (hotModelKey) f = f.filter((m) => m.slug === hotModelKey);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    f = f.filter((m) => [m.display_name, m.slug, m.series, companyName(m), ...(m.capabilities || [])]
      .some((v) => String(v).toLowerCase().includes(q)));
  }
  if (activeCompany) f = f.filter((m) => m.company.slug === activeCompany);
  if (activeCapability) f = f.filter((m) => (m.capabilities || []).includes(activeCapability));
  return f;
}
function sorted(arr: Model[]): Model[] {
  return [...arr].sort((a, b) => {
    let va: string | number | null, vb: string | number | null;
    switch (sort.f) {
      case 'name': va = a.display_name; vb = b.display_name; break;
      case 'input_price':
        va = isToken(a) ? num(a.official_input_price) : officialComparisonPrice(a);
        vb = isToken(b) ? num(b.official_input_price) : officialComparisonPrice(b);
        break;
      case 'output_price':
        va = isToken(a) ? num(a.official_output_price) : null;
        vb = isToken(b) ? num(b.official_output_price) : null;
        break;
      case 'composite_price': va = composite(a); vb = composite(b); break;
      default: return 0;
    }
    // Missing prices always stay at the end, regardless of direction.
    if (va === null && vb === null) return a.display_name.localeCompare(b.display_name);
    if (va === null) return 1;
    if (vb === null) return -1;
    const compared = typeof va === 'string'
      ? va.localeCompare(String(vb))
      : va - Number(vb);
    return (sort.asc ? compared : -compared) || a.display_name.localeCompare(b.display_name);
  });
}

// ── 渲染 ────────────────────────────────────────────────
function renderTable() {
  const list = sorted(filtered());
  const tb = $('tableBody')!;
  const cards = $('modelCardList')!;
  const em = $('emptyState')!;
  if (!list.length) {
    tb.innerHTML = '';
    cards.innerHTML = '';
    em.style.display = 'block';
  } else {
    em.style.display = 'none';
    tb.innerHTML = list.map(homeRowHTML).join('');
    cards.innerHTML = list.map(mobileCardHTML).join('');
  }
  $('resultsInfo')!.textContent = `共 ${list.length} 个模型 · 表内为官方价 · 更新 ${String(META.data_updated_at || '').slice(0, 10)}`;
}
function syncChips() {
  document.querySelectorAll<HTMLButtonElement>('#companyChips .chip').forEach((chip) => {
    const active = (chip.dataset.company || '') === (activeCompany || '');
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLButtonElement>('#capabilityChips .chip').forEach((chip) => {
    const active = (chip.dataset.capability || '') === (activeCapability || '');
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLElement>('[data-hot-model]').forEach((el) => {
    const on = el.dataset.hotModel === hotModelKey;
    el.classList.toggle('active', on);
    if (el.matches('button')) el.setAttribute('aria-pressed', String(on));
  });
}
function updateSortHeaders() {
  document.querySelectorAll<HTMLElement>('thead th.sortable').forEach((th) => {
    const active = th.id === `th-${sort.f.replace('_price', '')}`;
    th.classList.toggle('active', active);
    th.classList.toggle('asc', active && sort.asc);
    th.classList.toggle('desc', active && !sort.asc);
    th.setAttribute('aria-sort', active ? (sort.asc ? 'ascending' : 'descending') : 'none');
  });
}

// ── 比价抽屉 ────────────────────────────────────────────
let lastDrawerOpener: HTMLElement | null = null;
let previousBodyOverflow = '';
let inertedBackground: Array<{ element: HTMLElement; wasInert: boolean }> = [];

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function backgroundRoots(): HTMLElement[] {
  const drawer = $('drawer');
  const overlay = $('drawerOverlay');
  if (!drawer || !overlay) return [];
  const roots: HTMLElement[] = [];

  const visit = (element: HTMLElement) => {
    if (element === drawer || element === overlay || element.tagName === 'SCRIPT') return;
    if (!element.contains(drawer) && !element.contains(overlay)) {
      roots.push(element);
      return;
    }
    Array.from(element.children).forEach((child) => {
      if (child instanceof HTMLElement) visit(child);
    });
  };

  Array.from(document.body.children).forEach((child) => {
    if (child instanceof HTMLElement) visit(child);
  });
  return roots;
}

function setBackgroundInert(inert: boolean) {
  if (inert) {
    inertedBackground = backgroundRoots().map((element) => ({
      element,
      wasInert: element.hasAttribute('inert'),
    }));
    inertedBackground.forEach(({ element }) => element.setAttribute('inert', ''));
    return;
  }
  inertedBackground.forEach(({ element, wasInert }) => {
    if (!wasInert) element.removeAttribute('inert');
  });
  inertedBackground = [];
}

function drawerFocusableElements(): HTMLElement[] {
  const drawer = $('drawer');
  if (!drawer) return [];
  return Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

interface QuotePayload {
  v: 2;
  model_slug: string;
  updated_at: string;
  prices: Price[];
  stability: Stability[];
}

const quoteRequests = new Map<string, Promise<QuotePayload>>();
let drawerRequestSerial = 0;

function loadQuotes(model: Model): Promise<QuotePayload> {
  const cached = quoteRequests.get(model.slug);
  if (cached) return cached;
  const request = fetch(`/api/quotes/${encodeURIComponent(model.slug)}.json`, {
    headers: { Accept: 'application/json' },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as Partial<QuotePayload>;
    if (
      payload.v !== 2
      || payload.model_slug !== model.slug
      || !Array.isArray(payload.prices)
      || !Array.isArray(payload.stability)
    ) {
      throw new Error('报价快照格式不兼容');
    }
    return payload as QuotePayload;
  }).catch((error) => {
    quoteRequests.delete(model.slug);
    throw error;
  });
  quoteRequests.set(model.slug, request);
  return request;
}

function renderDrawerContent(
  model: Model,
  prices: Price[] | null,
  stability: Stability[] = [],
  loadError?: string,
) {
  const summary = summaryOf(model);
  const quotes = prices === null ? [] : activePrices(prices);
  const supplierCount = prices === null
    ? summary.supplierCount
    : new Set(quotes.map((price) => price.supplier_slug)).size;
  const quoteCount = prices === null ? summary.quoteCount : quotes.length;
  const official = officialPriceDisplay(model);
  const caps = (model.capabilities || []).slice(0, 3);
  const meta = [
    companyName(model), ...caps, model.context_window || null,
    `${supplierCount} 家已验证供应商`, `${quoteCount} 条报价线路`,
  ].filter(Boolean).map(esc).join(' · ');

  let quoteContent: string;
  if (loadError) {
    quoteContent = '<div class="verified-quotes-empty" role="alert"><strong>报价加载失败</strong>' +
      '<p>' + esc(loadError) + '。你仍可打开完整静态详情页查看报价。</p>' +
      '<a href="/models/' + esc(model.slug) + '/">查看模型详情</a></div>';
  } else if (prices === null) {
    quoteContent = '<div class="verified-quotes-empty" role="status"><strong>正在加载已验证报价…</strong>' +
      '<p>读取本站构建时生成的模型报价快照。</p></div>';
  } else if (quotes.length) {
    quoteContent = '<div class="drawer-table-scroll">' + priceTableHTML(model, prices, stability) + '</div>';
  } else {
    quoteContent = '<div class="verified-quotes-empty" role="status"><strong>暂无已验证报价</strong>' +
      '<p>当前数据集中没有有效的供应商报价。</p>' +
      '<a href="/models/' + esc(model.slug) + '/">查看模型详情</a></div>';
  }

  $('drawerContent')!.innerHTML =
    '<div class="drawer-model-header">' + modelLogo(model, MANIFEST, 'model-avatar-lg') +
      '<div><h2 class="drawer-model-name" id="drawerTitle" tabindex="-1">' + esc(model.display_name) + '</h2>' +
      '<div class="drawer-model-meta">' + meta + '</div></div></div>' +
    (model.description ? '<p class="model-description">' + esc(model.description) + '</p>' : '') +
    '<div class="price-summary"><div><small>' + official.primaryLabel + '</small><div class="price-cell">' + official.primaryHtml + '</div></div>' +
      '<div><small>官方输出价</small><div class="price-cell">' + official.outputHtml + '</div></div>' +
      '<div><small>官方综合价</small><div class="price-cell">' + official.compositeHtml + '</div></div></div>' +
    '<h3 class="drawer-section-title">供应商比价</h3>' + quoteContent;
}

async function openDrawer(slug: string, opener?: HTMLElement) {
  const m = MODELS.find((x) => x.slug === slug);
  if (!m) return;
  const requestSerial = ++drawerRequestSerial;
  renderDrawerContent(m, null);

  const drawer = $('drawer')!;
  const overlay = $('drawerOverlay')!;
  lastDrawerOpener = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  previousBodyOverflow = document.body.style.overflow;
  drawer.setAttribute('aria-labelledby', 'drawerTitle');
  drawer.removeAttribute('aria-label');
  drawer.hidden = false;
  overlay.hidden = false;
  drawer.scrollTop = 0;
  setBackgroundInert(true);
  document.body.style.overflow = 'hidden';
  window.requestAnimationFrame(() => $('drawerClose')?.focus({ preventScroll: true }));

  try {
    const payload = await loadQuotes(m);
    if (requestSerial !== drawerRequestSerial || drawer.hidden) return;
    renderDrawerContent(m, payload.prices, payload.stability);
  } catch (error) {
    if (requestSerial !== drawerRequestSerial || drawer.hidden) return;
    const message = error instanceof Error ? error.message : '未知错误';
    renderDrawerContent(m, null, [], message);
  }
}
function closeDrawer() {
  const drawer = $('drawer');
  const overlay = $('drawerOverlay');
  if (!drawer || !overlay || drawer.hidden) return;
  drawerRequestSerial += 1;
  drawer.hidden = true;
  overlay.hidden = true;
  drawer.removeAttribute('aria-labelledby');
  drawer.setAttribute('aria-label', '模型供应商比价');
  setBackgroundInert(false);
  document.body.style.overflow = previousBodyOverflow;
  const opener = lastDrawerOpener;
  lastDrawerOpener = null;
  if (opener?.isConnected) window.requestAnimationFrame(() => opener.focus({ preventScroll: true }));
}

function trapDrawerFocus(event: KeyboardEvent) {
  const drawer = $('drawer');
  if (!drawer || drawer.hidden || event.key !== 'Tab') return;
  const focusable = drawerFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    drawer.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !drawer.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

// ── 热门走马灯：拖动时暂停 ───────────────────────────────
function initMarquee() {
  const track = $('hotModelsTrack');
  const toggle = $<HTMLButtonElement>('hotModelsToggle');
  const toggleText = $('hotModelsToggleText');
  if (!track || !toggle || !toggleText) return;
  let t: number | undefined;
  let manuallyPaused = false;
  const pause = () => { clearTimeout(t); track.classList.add('user-paused'); };
  const resume = () => { clearTimeout(t); t = window.setTimeout(() => track.classList.remove('user-paused'), 1500); };
  const syncToggle = () => {
    track.classList.toggle('is-paused', manuallyPaused);
    toggle.setAttribute('aria-pressed', String(manuallyPaused));
    toggle.setAttribute('aria-label', manuallyPaused ? '继续热门模型滚动' : '暂停热门模型滚动');
    toggleText.textContent = manuallyPaused ? '继续' : '暂停';
  };
  track.addEventListener('pointerdown', pause, { passive: true });
  window.addEventListener('pointerup', resume, { passive: true });
  window.addEventListener('pointercancel', resume, { passive: true });
  toggle.addEventListener('click', () => {
    manuallyPaused = !manuallyPaused;
    syncToggle();
  });
  syncToggle();
}

// ── 事件绑定 ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const company = target.closest<HTMLElement>('[data-company]');
  if (company) {
    activeCompany = company.dataset.company || null;
    activeCapability = null;
    hotModelKey = null; searchQuery = '';
    const search = $('globalSearch') as HTMLInputElement | null; if (search) search.value = '';
    syncChips(); renderTable(); return;
  }
  const cap = target.closest<HTMLElement>('[data-capability]');
  if (cap) {
    activeCapability = cap.dataset.capability || null;
    activeCompany = null;
    hotModelKey = null; searchQuery = '';
    const search = $('globalSearch') as HTMLInputElement | null; if (search) search.value = '';
    syncChips(); renderTable(); return;
  }
  const hot = target.closest<HTMLElement>('[data-hot-model]');
  if (hot) {
    const key = hot.dataset.hotModel!;
    hotModelKey = hotModelKey === key ? null : key;
    activeCompany = null; activeCapability = null; searchQuery = '';
    const search = $('globalSearch') as HTMLInputElement | null; if (search) search.value = '';
    syncChips(); renderTable(); return;
  }
  const th = target.closest<HTMLElement>('thead th.sortable');
  if (th) {
    const f = th.dataset.sort!;
    if (sort.f === f) sort.asc = !sort.asc; else { sort.f = f; sort.asc = true; }
    updateSortHeaders(); renderTable(); return;
  }
  const cmp = target.closest<HTMLElement>('[data-compare]');
  if (cmp) { e.preventDefault(); void openDrawer(cmp.dataset.compare!, cmp); return; }
  if (target.closest('#drawerOverlay') || target.closest('#drawerClose')) closeDrawer();
});
$('globalSearch')?.addEventListener('input', (e) => {
  searchQuery = (e.target as HTMLInputElement).value.trim();
  if (searchQuery) {
    hotModelKey = null; activeCompany = null; activeCapability = null;
  }
  syncChips(); renderTable();
});
document.addEventListener('keydown', (e) => {
  const drawer = $('drawer');
  if (!drawer || drawer.hidden) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDrawer();
    return;
  }
  trapDrawerFocus(e);
});

renderTable();
initMarquee();
