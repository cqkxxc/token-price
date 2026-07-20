// ═══════════════════════════════════════════════════════
// 首页客户端交互 —— 筛选 / 排序 / 搜索 / 热门模型 / 比价抽屉。
// 初始表格由 SSR 输出（SEO 友好），本脚本负责后续的动态重渲染。
// ═══════════════════════════════════════════════════════
import {
  rowHTML, priceTableHTML, modelLogo, companyName, composite, activePrices,
  discountFor, quoteTotal, num, esc, priceText,
  type Model, type Price, type Manifest, type Stability,
} from '../lib/render';

interface Dataset { models: Model[]; prices: Price[]; stability: Stability[]; meta: any; manifest: Manifest; }
const raw = document.getElementById('__DATA__')?.textContent || '{}';
const DATA: Dataset = JSON.parse(raw);
const MODELS = DATA.models || [];
const MANIFEST = DATA.manifest || { vendors: [] };
const META = DATA.meta || {};

const priceMap = new Map<string, Price[]>();
for (const p of DATA.prices || []) {
  if (!priceMap.has(p.canonical_id)) priceMap.set(p.canonical_id, []);
  priceMap.get(p.canonical_id)!.push(p);
}
const pricesOf = (cid: string): Price[] => priceMap.get(cid) || [];

const stabilityMap = new Map<string, Stability[]>();
for (const item of DATA.stability || []) {
  if (!stabilityMap.has(item.canonical_id)) stabilityMap.set(item.canonical_id, []);
  stabilityMap.get(item.canonical_id)!.push(item);
}
const stabilityOf = (cid: string): Stability[] => stabilityMap.get(cid) || [];

// ── 状态 ────────────────────────────────────────────────
let activeCompany: string | null = null;
let activeCapability: string | null = null;
let searchQuery = '';
let hotModelKey: string | null = null;
let sort = { f: 'composite_price', asc: false };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

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
      case 'input_price': va = num(a.official_input_price); vb = num(b.official_input_price); break;
      case 'output_price': va = num(a.official_output_price); vb = num(b.official_output_price); break;
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
  const em = $('emptyState')!;
  if (!list.length) { tb.innerHTML = ''; em.style.display = 'block'; }
  else { em.style.display = 'none'; tb.innerHTML = list.map((m) => rowHTML(m, pricesOf(m.canonical_id), MANIFEST)).join(''); }
  $('resultsInfo')!.textContent = `共 ${list.length} 个模型 · 表内为官方价 · ${String(META.data_updated_at || '').slice(0, 10)}`;
}
function syncChips() {
  document.querySelectorAll<HTMLElement>('#companyChips .chip').forEach((c) =>
    c.classList.toggle('active', (c.dataset.company || '') === (activeCompany || '')));
  document.querySelectorAll<HTMLElement>('#capabilityChips .chip').forEach((c) =>
    c.classList.toggle('active', (c.dataset.capability || '') === (activeCapability || '')));
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
function openDrawer(slug: string) {
  const m = MODELS.find((x) => x.slug === slug);
  if (!m) return;
  const ps = activePrices(pricesOf(m.canonical_id));
  const comp = composite(m);
  $('drawerContent')!.innerHTML =
    '<div class="drawer-model-header">' + modelLogo(m, MANIFEST, 'model-avatar-lg') +
      '<div><div class="drawer-model-name">' + esc(m.display_name) + '</div>' +
      '<div class="drawer-model-meta">' + esc(companyName(m)) + ' · ' + (m.capabilities || []).slice(0, 3).map(esc).join(' · ') +
      ' · ' + esc(m.context_window || '—') + ' · ' + ps.length + ' 家供应方</div></div></div>' +
    (m.description ? '<p class="model-description">' + esc(m.description) + '</p>' : '') +
    '<div class="price-summary"><div><small>官方输入价</small><div class="price-cell">' + priceText(m.official_input_price, m) + '</div></div>' +
      '<div><small>官方输出价</small><div class="price-cell">' + priceText(m.official_output_price, m) + '</div></div>' +
      '<div><small>官方综合价</small><div class="price-cell">' + (comp === null ? '—' : priceText(comp, m)) + '</div></div></div>' +
    '<div class="drawer-section-title">供应商比价</div>' +
    '<div class="drawer-table-scroll">' + priceTableHTML(m, pricesOf(m.canonical_id), stabilityOf(m.canonical_id)) + '</div>';
  $('drawerOverlay')!.style.display = 'block';
  $('drawer')!.style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  $('drawerOverlay')!.style.display = 'none';
  $('drawer')!.style.display = 'none';
  document.body.style.overflow = '';
}

// ── 热门走马灯：拖动时暂停 ───────────────────────────────
function initMarquee() {
  const track = $('hotModelsTrack');
  if (!track) return;
  let t: number | undefined;
  const pause = () => { clearTimeout(t); track.classList.add('user-paused'); };
  const resume = () => { clearTimeout(t); t = window.setTimeout(() => track.classList.remove('user-paused'), 1500); };
  track.addEventListener('pointerdown', pause, { passive: true });
  window.addEventListener('pointerup', resume, { passive: true });
  window.addEventListener('pointercancel', resume, { passive: true });
}

// ── 事件绑定 ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const company = target.closest<HTMLElement>('[data-company]');
  if (company) {
    activeCompany = company.dataset.company || null;
    hotModelKey = null; searchQuery = '';
    const search = $('globalSearch') as HTMLInputElement | null; if (search) search.value = '';
    syncChips(); renderTable(); return;
  }
  const cap = target.closest<HTMLElement>('[data-capability]');
  if (cap) {
    activeCapability = cap.dataset.capability || null;
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
  if (cmp) { e.preventDefault(); openDrawer(cmp.dataset.compare!); return; }
  if (target.closest('#drawerOverlay') || target.closest('#drawerClose')) closeDrawer();
});
$('globalSearch')?.addEventListener('input', (e) => {
  searchQuery = (e.target as HTMLInputElement).value.trim();
  if (searchQuery) {
    hotModelKey = null; activeCompany = null; activeCapability = null;
  }
  syncChips(); renderTable();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

initMarquee();
