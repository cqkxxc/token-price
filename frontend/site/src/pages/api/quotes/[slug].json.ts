import type { APIRoute } from 'astro';
import { META, MODELS, pricesOf, stabilityOf } from '../../../lib/data';
import { activePrices, type Model, type Price, type Stability } from '../../../lib/render';

interface QuoteRouteProps {
  model: Model;
  prices: Price[];
  stability: Stability[];
}

const publicPrice = (price: Price) => ({
  canonical_id: price.canonical_id,
  supplier_slug: price.supplier_slug,
  supplier_name: price.supplier_name,
  supplier_type: price.supplier_type,
  route: price.route,
  unit: price.unit,
  currency: price.currency,
  input_price: price.input_price,
  output_price: price.output_price,
  cache_read_price: price.cache_read_price,
  is_active: price.is_active,
  fetched_at: price.fetched_at,
});

const publicStability = (record: Stability) => ({
  supplier_slug: record.supplier_slug,
  supplier_name: record.supplier_name,
  canonical_id: record.canonical_id,
  model_slug: record.model_slug,
  route: record.route,
  uptime_7d: record.uptime_7d,
  avg_latency_ms: record.avg_latency_ms,
  samples_7d: record.samples_7d,
  last_checked_at: record.last_checked_at,
  status: record.status,
  last_response_time_ms: record.last_response_time_ms,
  last_http_status: record.last_http_status,
});

export function getStaticPaths() {
  return MODELS.map((model) => {
    const prices = activePrices(pricesOf(model.canonical_id));
    const quoteKeys = new Set(prices.map((price) =>
      `${price.supplier_slug}::${price.canonical_id}::${price.route || 'default'}`));
    const stability = stabilityOf(model.canonical_id).filter((record) => quoteKeys.has(
      `${record.supplier_slug}::${record.canonical_id}::${record.route || 'default'}`,
    ));
    return {
      params: { slug: model.slug },
      props: { model, prices, stability } satisfies QuoteRouteProps,
    };
  });
}

export const GET: APIRoute = ({ props }) => {
  const { model, prices, stability } = props as QuoteRouteProps;
  return new Response(JSON.stringify({
    v: 2,
    model_slug: model.slug,
    updated_at: META.data_updated_at,
    prices: prices.map(publicPrice),
    stability: stability.map(publicStability),
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
    },
  });
};
