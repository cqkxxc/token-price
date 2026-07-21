import type { Model, Price } from './render';
import { activePrices, companyName, quoteTotal } from './render';

type JsonLd = Record<string, unknown>;
type DatedModel = Model & { publish_date?: string };

const absoluteUrl = (site: URL, path: string): string => new URL(path, site).href;
const priceValue = (price: Price, model: Model): number => Number(quoteTotal(price, model).toFixed(6));

export function homeJsonLd(site: URL, models: Model[], updatedAt?: string): JsonLd {
  const home = absoluteUrl(site, '/');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        url: home,
        name: 'AI 模型比价',
        inLanguage: 'zh-CN',
        dateModified: updatedAt,
      },
      {
        '@type': 'CollectionPage',
        '@id': `${home}#page`,
        url: home,
        name: 'AI 模型官方价格与供应商报价对比',
        isPartOf: { '@id': `${home}#website` },
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: models.length,
          itemListElement: models.map((model, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: model.display_name,
            url: absoluteUrl(site, `/models/${model.slug}/`),
          })),
        },
      },
    ],
  };
}

export function modelJsonLd(site: URL, model: Model, prices: Price[], updatedAt?: string): JsonLd {
  const pageUrl = absoluteUrl(site, `/models/${model.slug}/`);
  const quotes = activePrices(prices);
  const totals = quotes.map((price) => priceValue(price, model)).filter(Number.isFinite);
  const currency = quotes[0]?.currency || model.official_currency || 'CNY';
  const offers = quotes.map((price) => ({
    '@type': 'Offer',
    price: priceValue(price, model),
    priceCurrency: price.currency || currency,
    url: price.source_url,
    seller: { '@type': 'Organization', name: price.supplier_name },
    availability: 'https://schema.org/InStock',
  }));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${pageUrl}#model`,
        name: model.display_name,
        description: model.description,
        applicationCategory: 'Artificial Intelligence Model',
        operatingSystem: 'API',
        url: pageUrl,
        datePublished: (model as DatedModel).publish_date,
        dateModified: updatedAt,
        author: {
          '@type': 'Organization',
          '@id': `${absoluteUrl(site, '/')}#vendor-${model.company.slug}`,
          name: companyName(model),
          alternateName: model.company.name,
        },
        offers: offers.length ? {
          '@type': 'AggregateOffer',
          priceCurrency: currency,
          lowPrice: Math.min(...totals),
          highPrice: Math.max(...totals),
          offerCount: offers.length,
          offers,
        } : undefined,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: absoluteUrl(site, '/') },
          { '@type': 'ListItem', position: 2, name: model.display_name, item: pageUrl },
        ],
      },
    ],
  };
}
