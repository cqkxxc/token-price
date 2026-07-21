import type { APIRoute } from 'astro';
import { META, MODELS, pricesOf, stabilityOf } from '../../../lib/data';
import { activePrices, type Model, type Price, type Stability } from '../../../lib/render';

interface QuoteRouteProps {
  model: Model;
  prices: Price[];
  stability: Stability[];
}

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
    v: 1,
    model_slug: model.slug,
    updated_at: META.data_updated_at,
    prices,
    stability,
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
    },
  });
};
