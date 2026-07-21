import type { Model, Price } from './render';
import { activePrices, companyName, isToken, unitFor } from './render';

type JsonLd = Record<string, unknown>;
type DatedModel = Model & { publish_date?: string | null };

export interface MonitorSupplierSummary {
  slug: string;
  name: string;
}

const absoluteUrl = (site: URL, path: string): string => new URL(path, site).href;
const priceValue = (value: number): number => Number(Number(value).toFixed(6));

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
  const unitText = `每${unitFor(model)}`;
  const aggregateFor = (
    name: string,
    field: 'input_price' | 'output_price',
  ): JsonLd | undefined => {
    if (!quotes.length) return undefined;
    const values = quotes.map((quote) => priceValue(quote[field]));
    return {
      '@type': 'AggregateOffer',
      name: `${name}（${unitText}）`,
      priceCurrency: 'CNY',
      lowPrice: Math.min(...values),
      highPrice: Math.max(...values),
      offerCount: quotes.length,
      offers: quotes.map((quote) => ({
        '@type': 'Offer',
        name: `${quote.supplier_name} · ${quote.route}`,
        price: priceValue(quote[field]),
        priceCurrency: 'CNY',
        url: quote.source_url,
        seller: { '@type': 'Organization', name: quote.supplier_name },
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          name,
          price: priceValue(quote[field]),
          priceCurrency: 'CNY',
          unitText,
        },
      })),
    };
  };
  const offers = [
    aggregateFor(isToken(model) ? '输入价格' : '单位价格', 'input_price'),
    isToken(model) ? aggregateFor('输出价格', 'output_price') : undefined,
  ].filter((offer): offer is JsonLd => Boolean(offer));

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
        datePublished: (model as DatedModel).publish_date || undefined,
        dateModified: updatedAt,
        author: {
          '@type': 'Organization',
          '@id': `${absoluteUrl(site, '/')}#vendor-${model.company.slug}`,
          name: companyName(model),
          alternateName: model.company.name,
        },
        offers: offers.length ? offers : undefined,
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

export function monitorIndexJsonLd(
  site: URL,
  suppliers: MonitorSupplierSummary[],
  description: string,
  updatedAt?: string,
): JsonLd {
  const home = absoluteUrl(site, '/');
  const pageUrl = absoluteUrl(site, '/monitor/');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${pageUrl}#page`,
        url: pageUrl,
        name: '供应商可用性监控',
        description,
        inLanguage: 'zh-CN',
        dateModified: updatedAt,
        isPartOf: { '@id': `${home}#website` },
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: suppliers.length,
          itemListElement: suppliers.map((supplier, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: supplier.name,
            url: absoluteUrl(site, `/monitor/${encodeURIComponent(supplier.slug)}/`),
          })),
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: home },
          { '@type': 'ListItem', position: 2, name: '可用性监控', item: pageUrl },
        ],
      },
    ],
  };
}

export function monitorSupplierJsonLd(
  site: URL,
  supplierSlug: string,
  supplierName: string,
  description: string,
  modelCount: number,
  routeCount: number,
  updatedAt?: string,
): JsonLd {
  const home = absoluteUrl(site, '/');
  const monitorUrl = absoluteUrl(site, '/monitor/');
  const pageUrl = absoluteUrl(site, `/monitor/${encodeURIComponent(supplierSlug)}/`);
  const supplierId = `${pageUrl}#supplier`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#page`,
        url: pageUrl,
        name: `${supplierName} 可用性监控`,
        description,
        inLanguage: 'zh-CN',
        dateModified: updatedAt,
        isPartOf: { '@id': `${home}#website` },
        about: { '@id': supplierId },
        mainEntity: { '@id': supplierId },
      },
      {
        '@type': 'Organization',
        '@id': supplierId,
        name: supplierName,
        additionalProperty: [
          { '@type': 'PropertyValue', name: '已验证模型数', value: modelCount },
          { '@type': 'PropertyValue', name: '已验证线路数', value: routeCount },
        ],
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: home },
          { '@type': 'ListItem', position: 2, name: '可用性监控', item: monitorUrl },
          { '@type': 'ListItem', position: 3, name: supplierName, item: pageUrl },
        ],
      },
    ],
  };
}
