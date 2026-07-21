// ═══════════════════════════════════════════════════════
// 构建期数据层 —— 直接 import JSON（Astro/Vite 在构建时内联）。
// 前端不再 fetch，全部在 SSG 阶段读入，产出纯静态 HTML。
// 数据契约见 json-schema.md。
// ═══════════════════════════════════════════════════════
import modelsJson from '../data/models.json';
import pricesJson from '../data/prices.json';
import suppliersJson from '../data/suppliers.json';
import metaJson from '../data/meta.json';
import manifestJson from '../data/manifest.json';
import stabilityJson from '../data/stability.json';
import type { Model, Price, Supplier, Manifest, Stability } from './render';

export const MODELS: Model[] = (modelsJson as any).models ?? [];
export const PRICES: Price[] = (pricesJson as any).prices ?? [];
export const SUPPLIERS: Supplier[] = (suppliersJson as any).suppliers ?? [];
export const META: any = metaJson ?? {};
export const MANIFEST: Manifest = manifestJson as Manifest;
export const STABILITY: Stability[] = (stabilityJson as any).stability ?? [];

// canonical_id -> 该模型的全部报价
const priceMap = new Map<string, Price[]>();
for (const p of PRICES) {
  if (!priceMap.has(p.canonical_id)) priceMap.set(p.canonical_id, []);
  priceMap.get(p.canonical_id)!.push(p);
}
export function pricesOf(canonicalId: string): Price[] {
  return priceMap.get(canonicalId) ?? [];
}

// canonical_id -> 该模型各供应方/线路的稳定性
const stabilityMap = new Map<string, Stability[]>();
for (const item of STABILITY) {
  if (!stabilityMap.has(item.canonical_id)) stabilityMap.set(item.canonical_id, []);
  stabilityMap.get(item.canonical_id)!.push(item);
}
export function stabilityOf(canonicalId: string): Stability[] {
  return stabilityMap.get(canonicalId) ?? [];
}

export function getModel(slug: string): Model | undefined {
  return MODELS.find((m) => m.slug === slug);
}

// 客户端交互脚本需要的最小数据集（序列化进 <script type="application/json">）
export function clientDataset() {
  // 完整稳定性文件约 890KB；首页抽屉只下发当前有效报价能用到的记录。
  const quotedKeys = new Set(
    PRICES
      .filter((p) => p.is_active === true && p.source_url)
      .map((p) => `${p.supplier_slug}::${p.canonical_id}::${p.route || 'default'}`),
  );
  const stability = STABILITY.filter((item) =>
    quotedKeys.has(`${item.supplier_slug}::${item.canonical_id}::${item.route || 'default'}`));
  return { models: MODELS, prices: PRICES, stability, meta: META, manifest: MANIFEST };
}
