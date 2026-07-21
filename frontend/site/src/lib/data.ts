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
import type { Model, Price, Supplier, Manifest, Stability, DataMeta } from './render';

export const MODELS: Model[] = (modelsJson as any).models ?? [];
export const PRICES: Price[] = (pricesJson as any).prices ?? [];
export const SUPPLIERS: Supplier[] = (suppliersJson as any).suppliers ?? [];
// JSON is validated before every production build; the double assertion keeps
// stale local fixtures from weakening the TypeScript contract.
export const META: DataMeta = metaJson as unknown as DataMeta;
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
