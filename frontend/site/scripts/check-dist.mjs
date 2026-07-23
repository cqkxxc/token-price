import { readFile, readdir, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = path.join(siteDirectory, 'dist');
const errors = [];
const warnings = [];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(location) : [location];
  }));
  return nested.flat();
}

function pagePathFor(file) {
  const relative = path.relative(distDirectory, file).replaceAll('\\', '/');
  if (relative === 'index.html') return '/';
  return '/' + relative.replace(/index\.html$/, '');
}

function attributeValue(tag, name) {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", 'i');
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? '') : null;
}

function parseHttpUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      errors.push(label + ': expected an HTTP(S) URL without credentials (' + value + ')');
      return null;
    }
    return parsed;
  } catch {
    errors.push(label + ': invalid absolute URL (' + value + ')');
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nodesFromStructuredData(parsed) {
  if (Array.isArray(parsed?.['@graph'])) return parsed['@graph'];
  return parsed && typeof parsed === 'object' ? [parsed] : [];
}

function nodeOfType(nodes, type) {
  return nodes.find((node) => {
    const value = node?.['@type'];
    return value === type || (Array.isArray(value) && value.includes(type));
  });
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function validateBreadcrumb(nodes, pagePath, canonicalHref) {
  const breadcrumb = nodeOfType(nodes, 'BreadcrumbList');
  if (!breadcrumb) {
    errors.push(pagePath + ': BreadcrumbList JSON-LD is missing');
    return;
  }
  const items = breadcrumb.itemListElement;
  if (!Array.isArray(items) || items.length < 2) {
    errors.push(pagePath + ': BreadcrumbList must contain at least two items');
    return;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.['@type'] !== 'ListItem' || item.position !== index + 1 || !item.name) {
      errors.push(pagePath + ': BreadcrumbList item ' + (index + 1) + ' is invalid');
    }
  }
  if (items.at(-1)?.item !== canonicalHref) {
    errors.push(pagePath + ': BreadcrumbList does not end at the canonical URL');
  }
}

function validateModelJsonLd(nodes, pagePath, canonicalHref) {
  const application = nodeOfType(nodes, 'SoftwareApplication');
  if (!application) {
    errors.push(pagePath + ': SoftwareApplication JSON-LD is missing');
    return;
  }
  if (application.url !== canonicalHref || application['@id'] !== canonicalHref + '#model') {
    errors.push(pagePath + ': SoftwareApplication URL/@id does not match canonical');
  }
  const offers = application.offers;
  if (!Array.isArray(offers) || !offers.length) {
    errors.push(pagePath + ': SoftwareApplication must contain aggregate offers');
  } else {
    for (const [aggregateIndex, aggregate] of offers.entries()) {
      const label = pagePath + ': aggregate offer ' + (aggregateIndex + 1);
      const children = aggregate?.offers;
      if (
        aggregate?.['@type'] !== 'AggregateOffer'
        || aggregate.priceCurrency !== 'CNY'
        || !finiteNonNegative(aggregate.lowPrice)
        || !finiteNonNegative(aggregate.highPrice)
        || aggregate.lowPrice > aggregate.highPrice
      ) {
        errors.push(label + ' has invalid type, currency, or price range');
        continue;
      }
      if (
        !Number.isInteger(aggregate.offerCount)
        || aggregate.offerCount <= 0
        || !Array.isArray(children)
        || aggregate.offerCount !== children.length
      ) {
        errors.push(label + ' has an invalid offerCount');
        continue;
      }
      for (const [childIndex, offer] of children.entries()) {
        const childLabel = label + ', child ' + (childIndex + 1);
        const specification = offer?.priceSpecification;
        if (
          offer?.['@type'] !== 'Offer'
          || !finiteNonNegative(offer.price)
          || offer.price < aggregate.lowPrice
          || offer.price > aggregate.highPrice
          || offer.priceCurrency !== 'CNY'
          || offer.seller?.['@type'] !== 'Organization'
          || typeof offer.seller?.name !== 'string'
          || !offer.seller.name.trim()
          || Object.hasOwn(offer, 'url')
        ) {
          errors.push(childLabel + ' has invalid price, seller, or a public source URL');
        }
        if (
          specification?.['@type'] !== 'UnitPriceSpecification'
          || specification.price !== offer?.price
          || specification.priceCurrency !== 'CNY'
          || typeof specification.unitText !== 'string'
          || !specification.unitText.trim()
        ) {
          errors.push(childLabel + ' has an invalid UnitPriceSpecification');
        }
        if (Object.hasOwn(offer || {}, 'availability')) {
          errors.push(childLabel + ': availability must not be inferred from route telemetry');
        }
      }
    }
  }
  validateBreadcrumb(nodes, pagePath, canonicalHref);
}

function validatePageJsonLd(nodes, pagePath, canonicalHref) {
  if (pagePath === '/') {
    const website = nodeOfType(nodes, 'WebSite');
    const collection = nodeOfType(nodes, 'CollectionPage');
    if (!website || !collection || collection.url !== canonicalHref) {
      errors.push('/: WebSite or CollectionPage JSON-LD is invalid');
    }
    return;
  }
  if (pagePath.startsWith('/models/')) {
    validateModelJsonLd(nodes, pagePath, canonicalHref);
    return;
  }
  if (pagePath === '/monitor/') {
    const collection = nodeOfType(nodes, 'CollectionPage');
    if (!collection || collection.url !== canonicalHref || collection.mainEntity?.['@type'] !== 'ItemList') {
      errors.push('/monitor/: CollectionPage/ItemList JSON-LD is invalid');
    }
    validateBreadcrumb(nodes, pagePath, canonicalHref);
    return;
  }
  if (pagePath.startsWith('/monitor/')) {
    const page = nodeOfType(nodes, 'WebPage');
    const organization = nodeOfType(nodes, 'Organization');
    if (
      !page
      || page.url !== canonicalHref
      || !organization
      || page.mainEntity?.['@id'] !== organization['@id']
      || page.about?.['@id'] !== organization['@id']
    ) {
      errors.push(pagePath + ': WebPage/Organization JSON-LD is invalid');
    }
    validateBreadcrumb(nodes, pagePath, canonicalHref);
  }
}

async function isFile(location) {
  try {
    return (await stat(location)).isFile();
  } catch {
    return false;
  }
}

const files = await filesUnder(distDirectory);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const pagePaths = new Set(htmlFiles.map(pagePathFor));
const htmlFileByPath = new Map(htmlFiles.map((file) => [pagePathFor(file), file]));
const canonicalByPath = new Map();
const idsByPath = new Map();
const anchorRecords = [];

for (const file of htmlFiles) {
  const pagePath = pagePathFor(file);
  const html = await readFile(file, 'utf8');
  const mainCount = (html.match(/<main(?:\s|>)/gi) || []).length;
  const h1Count = (html.match(/<h1(?:\s|>)/gi) || []).length;
  if (mainCount !== 1) errors.push(pagePath + ': expected one <main>, found ' + mainCount);
  if (h1Count !== 1) errors.push(pagePath + ': expected one <h1>, found ' + h1Count);
  if (/<td\b[^>]*class=["'][^"']*\bcapabilities-cell\b[^"']*["'][^>]*>\s*<\/td>/i.test(html)) {
    errors.push(pagePath + ': an empty capabilities cell was rendered');
  }
  if (/ ·\s* · /.test(html)) {
    errors.push(pagePath + ': consecutive metadata separators were rendered');
  }

  const ids = new Set();
  for (const match of html.matchAll(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    ids.add(match[1] ?? match[2]);
  }
  idsByPath.set(pagePath, ids);

  const canonicalTags = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => (attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonicalTags.length !== 1) {
    errors.push(pagePath + ': expected one canonical link, found ' + canonicalTags.length);
  } else {
    const href = attributeValue(canonicalTags[0], 'href');
    const canonical = href ? parseHttpUrl(href, pagePath + ' canonical') : null;
    if (!href) errors.push(pagePath + ': canonical href is missing');
    if (canonical) {
      if (canonical.pathname !== pagePath || canonical.search || canonical.hash) {
        errors.push(pagePath + ': canonical path/query/fragment does not match the page');
      }
      canonicalByPath.set(pagePath, canonical);
    }
  }

  const structuredSources = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (!structuredSources.length) {
    errors.push(pagePath + ': JSON-LD is missing');
  }
  const nodes = [];
  for (const [, source] of structuredSources) {
    try {
      nodes.push(...nodesFromStructuredData(JSON.parse(source)));
    } catch (error) {
      errors.push(pagePath + ': JSON-LD is not valid JSON (' + error.message + ')');
    }
  }
  const canonicalHref = canonicalByPath.get(pagePath)?.href;
  if (canonicalHref) validatePageJsonLd(nodes, pagePath, canonicalHref);

  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const href = attributeValue(tag, 'href');
    if (!href) continue;
    const target = (attributeValue(tag, 'target') || '').toLowerCase();
    const rel = (attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (target === '_blank' && !rel.includes('noopener')) {
      errors.push(pagePath + ': target=_blank link lacks rel=noopener (' + href + ')');
    }
    anchorRecords.push({ pagePath, href });
  }
}

const decodeXml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'");

const sitemap = await readFile(path.join(distDirectory, 'sitemap.xml'), 'utf8');
const locValues = [...sitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => decodeXml(match[1].trim()));
const sitemapUrls = [];
const sitemapHrefSet = new Set();
const sitemapUrlByPath = new Map();
for (const value of locValues) {
  const url = parseHttpUrl(value, 'sitemap.xml <loc>');
  if (!url) continue;
  if (url.search || url.hash) errors.push('sitemap.xml: loc must not include query or fragment (' + value + ')');
  if (sitemapHrefSet.has(url.href)) errors.push('sitemap.xml: duplicate loc (' + url.href + ')');
  sitemapHrefSet.add(url.href);
  if (sitemapUrlByPath.has(url.pathname)) {
    errors.push('sitemap.xml: duplicate pathname (' + url.pathname + ')');
  }
  sitemapUrlByPath.set(url.pathname, url);
  sitemapUrls.push(url);
}
const sitemapOrigins = new Set(sitemapUrls.map((url) => url.origin));
if (sitemapOrigins.size !== 1) {
  errors.push('sitemap.xml: all loc URLs must use one origin');
}
const siteOrigin = sitemapOrigins.size === 1 ? [...sitemapOrigins][0] : null;

for (const pagePath of pagePaths) {
  if (!sitemapUrlByPath.has(pagePath)) errors.push('sitemap.xml: missing ' + pagePath);
}
for (const sitemapPath of sitemapUrlByPath.keys()) {
  if (!pagePaths.has(sitemapPath)) errors.push('sitemap.xml: route does not exist (' + sitemapPath + ')');
}
for (const [pagePath, canonical] of canonicalByPath) {
  const sitemapUrl = sitemapUrlByPath.get(pagePath);
  if (sitemapUrl && canonical.href !== sitemapUrl.href) {
    errors.push(pagePath + ': canonical URL differs from sitemap loc');
  }
  if (siteOrigin && canonical.origin !== siteOrigin) {
    errors.push(pagePath + ': canonical origin differs from sitemap origin');
  }
}

const robots = await readFile(path.join(distDirectory, 'robots.txt'), 'utf8');
const robotSitemaps = [...robots.matchAll(/^Sitemap:\s*(\S+)\s*$/gim)].map((match) => match[1]);
if (robotSitemaps.length !== 1) {
  errors.push('robots.txt: expected exactly one Sitemap declaration');
} else if (siteOrigin) {
  const expectedSitemap = new URL('/sitemap.xml', siteOrigin).href;
  if (robotSitemaps[0] !== expectedSitemap) {
    errors.push('robots.txt: Sitemap URL differs from the generated site origin');
  }
}

const configuredSite = String(process.env.SITE_URL || '').trim();
if (configuredSite) {
  const configured = parseHttpUrl(configuredSite, 'SITE_URL');
  if (configured) {
    if (configured.pathname !== '/' || configured.search || configured.hash) {
      errors.push('SITE_URL: expected an origin URL without a subpath, query, or fragment');
    }
    if (configured.protocol !== 'https:' || isIP(configured.hostname)) {
      errors.push('SITE_URL: an explicitly configured production URL must use an HTTPS domain');
    }
    if (siteOrigin && configured.origin !== siteOrigin) {
      errors.push('SITE_URL: configured origin differs from canonical/sitemap origin');
    }
  }
} else if (siteOrigin) {
  const site = new URL(siteOrigin);
  if (site.protocol !== 'https:' || isIP(site.hostname)) {
    warnings.push('SITE_URL is not configured; canonical output is using the temporary HTTP/IP origin ' + siteOrigin);
  }
}

for (const { pagePath, href } of anchorRecords) {
  const base = canonicalByPath.get(pagePath)?.href
    || (siteOrigin ? new URL(pagePath, siteOrigin).href : null);
  if (!base) continue;
  let target;
  try {
    target = new URL(href, base);
  } catch {
    errors.push(pagePath + ': invalid link URL (' + href + ')');
    continue;
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== siteOrigin) continue;
  let pathname;
  try {
    pathname = decodeURIComponent(target.pathname);
  } catch {
    errors.push(pagePath + ': invalid internal URL encoding (' + href + ')');
    continue;
  }
  const relative = pathname.replace(/^\/+/, '');
  const candidates = pathname.endsWith('/')
    ? [path.join(distDirectory, relative, 'index.html')]
    : [
        path.join(distDirectory, relative),
        path.join(distDirectory, relative, 'index.html'),
        path.join(distDirectory, relative + '.html'),
      ];
  const safeCandidates = candidates.filter((candidate) => {
    const resolved = path.resolve(candidate);
    return resolved === distDirectory || resolved.startsWith(distDirectory + path.sep);
  });
  let found = false;
  for (const candidate of safeCandidates) {
    if (await isFile(candidate)) {
      found = true;
      break;
    }
  }
  if (!found) {
    errors.push(pagePath + ': broken internal link (' + href + ')');
    continue;
  }
  if (target.hash && pagePaths.has(target.pathname)) {
    let fragment;
    try {
      fragment = decodeURIComponent(target.hash.slice(1));
    } catch {
      errors.push(pagePath + ': invalid URL fragment encoding (' + href + ')');
      continue;
    }
    if (fragment && !idsByPath.get(target.pathname)?.has(fragment)) {
      errors.push(pagePath + ': missing fragment target (' + href + ')');
    }
  }
}

const indexPath = path.join(distDirectory, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');
const indexBytes = (await stat(indexPath)).size;
if (indexBytes > 400 * 1024) errors.push('/: index.html exceeds 400 KiB (' + indexBytes + ' bytes)');
if (indexHtml.includes('-100%') || indexHtml.includes('约省 100%')) {
  errors.push('/: a positive quote was rounded to a misleading 100% discount');
}
if (indexHtml.includes('data-capability="—"') || indexHtml.includes('<span class="model-tag">—</span>')) {
  errors.push('/: the missing-value placeholder was rendered as a capability filter or tag');
}
const hotModelButtons = [...indexHtml.matchAll(/<button class="hot-model-card"[^>]*data-hot-model="([^"]+)"/g)]
  .map((match) => match[1]);
const hotModelClones = [...indexHtml.matchAll(/<span class="hot-model-card hot-model-card-clone"[^>]*data-hot-model="([^"]+)"[^>]*data-hot-model-clone="true"/g)]
  .map((match) => match[1]);
if (
  !hotModelButtons.length
  || hotModelButtons.length !== hotModelClones.length
  || hotModelButtons.some((slug) => !hotModelClones.includes(slug))
) {
  errors.push('/: marquee clones must preserve the clickable hot-model mapping');
}

const payloadMatch = indexHtml.match(/<script id="__DATA__" type="application\/json">([\s\S]*?)<\/script>/);
let payload = null;
let expectsMissingCapabilityPlaceholder = false;
if (!payloadMatch) {
  errors.push('/: compact client data payload is missing');
} else {
  try {
    payload = JSON.parse(payloadMatch[1]);
  } catch (error) {
    errors.push('/: compact client data payload is invalid JSON (' + error.message + ')');
  }
}

if (payload) {
  if (payload.v !== 2 || !Array.isArray(payload.models) || !Array.isArray(payload.r)) {
    errors.push('/: compact client data payload has an unsupported shape');
  } else if (payload.models.length !== payload.r.length) {
    errors.push('/: quote summary count does not match model count');
  } else {
    const slugs = new Set();
    for (let index = 0; index < payload.models.length; index += 1) {
      const model = payload.models[index];
      const summary = payload.r[index];
      if (!model || typeof model.slug !== 'string' || slugs.has(model.slug)) {
        errors.push('/: invalid or duplicate model slug at payload index ' + index);
        continue;
      }
      slugs.add(model.slug);
      if (
        !Array.isArray(summary)
        || summary.length !== 3
        || !Number.isInteger(summary[0])
        || !Number.isInteger(summary[1])
        || summary[0] < 0
        || summary[1] < summary[0]
        || (summary[2] !== null && !finiteNonNegative(summary[2]))
        || (summary[1] === 0 && summary[2] !== null)
        || (summary[1] > 0 && summary[2] === null)
      ) {
        errors.push('/: invalid quote summary for model ' + model.slug);
      }
      if (!pagePaths.has('/models/' + model.slug + '/')) {
        errors.push('/: model payload has no static detail page (' + model.slug + ')');
      }
    }

    const modelWithoutCapabilities = payload.models.find((model) => (
      !Array.isArray(model.capabilities)
      || !model.capabilities.some((capability) => String(capability ?? '').trim())
    ));
    if (modelWithoutCapabilities) {
      expectsMissingCapabilityPlaceholder = true;
      if (!/<td\b[^>]*class=["'][^"']*\bcapabilities-cell\b[^"']*["'][^>]*>\s*—\s*<\/td>/i.test(indexHtml)) {
        errors.push('/: a model without capabilities lacks the table placeholder');
      }
      const detailPath = '/models/' + modelWithoutCapabilities.slug + '/';
      const detailFile = htmlFileByPath.get(detailPath);
      const detailHtml = detailFile ? await readFile(detailFile, 'utf8') : '';
      if (!/<div class="drawer-model-meta">[^<]* · — · [^<]*<\/div>/.test(detailHtml)) {
        errors.push(detailPath + ': model metadata lacks the missing-capability placeholder');
      }
    }

    const quoteDirectory = path.join(distDirectory, 'api', 'quotes');
    const quoteFiles = files.filter((file) => (
      path.dirname(file) === quoteDirectory && file.endsWith('.json')
    ));
    const expectedQuoteFiles = new Set(payload.models.map((model) => model.slug + '.json'));
    for (const file of quoteFiles) {
      const filename = path.basename(file);
      if (!expectedQuoteFiles.has(filename)) {
        errors.push('api/quotes: unexpected snapshot ' + filename);
      }
    }
    if (quoteFiles.length !== expectedQuoteFiles.size) {
      errors.push('api/quotes: expected ' + expectedQuoteFiles.size + ' snapshots, found ' + quoteFiles.length);
    }

    for (let index = 0; index < payload.models.length; index += 1) {
      const model = payload.models[index];
      const summary = payload.r[index];
      const file = path.join(quoteDirectory, model.slug + '.json');
      if (!(await isFile(file))) {
        errors.push('api/quotes: missing snapshot for ' + model.slug);
        continue;
      }
      let quotePayload;
      try {
        quotePayload = JSON.parse(await readFile(file, 'utf8'));
      } catch (error) {
        errors.push('api/quotes/' + model.slug + '.json: invalid JSON (' + error.message + ')');
        continue;
      }
      if (
        quotePayload.v !== 2
        || quotePayload.model_slug !== model.slug
        || !Array.isArray(quotePayload.prices)
        || !Array.isArray(quotePayload.stability)
      ) {
        errors.push('api/quotes/' + model.slug + '.json: unsupported payload shape');
        continue;
      }
      const priceKeys = new Set();
      const supplierSlugs = new Set();
      const totals = [];
      for (const [priceIndex, price] of quotePayload.prices.entries()) {
        const key = price.supplier_slug + '::' + price.canonical_id + '::' + (price.route || 'default');
        if (priceKeys.has(key)) {
          errors.push('api/quotes/' + model.slug + '.json: duplicate quote key at ' + priceIndex);
        }
        priceKeys.add(key);
        supplierSlugs.add(price.supplier_slug);
        if (
          price.canonical_id !== model.canonical_id
          || price.is_active !== true
          || price.currency !== 'CNY'
          || !finiteNonNegative(price.input_price)
          || !finiteNonNegative(price.output_price)
          || Object.hasOwn(price, 'source_url')
        ) {
          errors.push('api/quotes/' + model.slug + '.json: invalid quote at ' + priceIndex);
        }
        totals.push(model.pricing_method === 'per_token'
          ? price.input_price + price.output_price
          : (price.input_price || price.output_price));
      }
      const expectedBest = totals.length ? Math.min(...totals) : null;
      if (
        quotePayload.prices.length !== summary[1]
        || supplierSlugs.size !== summary[0]
        || (
          expectedBest !== null
          && (!Number.isFinite(summary[2]) || Math.abs(expectedBest - summary[2]) > 1e-9)
        )
        || (expectedBest === null && summary[2] !== null)
      ) {
        errors.push('api/quotes/' + model.slug + '.json: summary does not match snapshot');
      }
      const stabilityKeys = new Set();
      for (const [stabilityIndex, record] of quotePayload.stability.entries()) {
        const key = record.supplier_slug + '::' + record.canonical_id + '::' + (record.route || 'default');
        if (
          stabilityKeys.has(key)
          || !priceKeys.has(key)
          || record.model_slug !== model.slug
          || Object.hasOwn(record, 'source_url')
          || Object.hasOwn(record, 'response_text')
          || Object.hasOwn(record, 'last_error')
        ) {
          errors.push('api/quotes/' + model.slug + '.json: invalid stability reference at ' + stabilityIndex);
        }
        stabilityKeys.add(key);
      }
    }
  }
}

const staleDataFiles = files.filter((file) => {
  const relative = path.relative(distDirectory, file).split(path.sep);
  return relative[0] === 'data';
});
if (staleDataFiles.length) {
  errors.push('dist: stale public/data files were published');
}

const privateMeta = JSON.parse(await readFile(path.join(siteDirectory, 'src', 'data', 'meta.json'), 'utf8'));
const privateSourceName = String(privateMeta.source_name || '').trim();
const privateSourceHosts = ['oken.ai'];
const privateSourceNamePattern = privateSourceName
  ? new RegExp('\\b' + escapeRegExp(privateSourceName) + '\\b', 'i')
  : null;
const publicTextFiles = files.filter((file) => /\.(?:css|html|js|json|svg|txt|xml)$/i.test(file));
const clientScriptFiles = files.filter((file) => /\.js$/i.test(file));
const clientScripts = await Promise.all(clientScriptFiles.map((file) => readFile(file, 'utf8')));
if (!clientScripts.some((content) => content.includes('.json?v=${'))) {
  errors.push('dist: quote requests are missing the versioned cache-busting query');
}
if (
  expectsMissingCapabilityPlaceholder
  && !clientScripts.some((content) => content.includes('model-result-capabilities-missing'))
) {
  errors.push('/: client-rendered mobile cards lack the missing-capability placeholder');
}
if (clientScripts.some((content) => content.includes('user-paused'))) {
  errors.push('dist: hot-model clicks still include the legacy delayed pause state');
}
if (!clientScripts.some((content) => content.includes('is-dragging'))) {
  errors.push('dist: hot-model drag detection is missing from the client script');
}
const exposedSourceFiles = [];
const exposedSourceEntryFiles = [];
const externalGoogleFontFiles = [];
for (const file of publicTextFiles) {
  const content = await readFile(file, 'utf8');
  if (
    privateSourceHosts.some((host) => content.toLowerCase().includes(host))
    || (privateSourceNamePattern && privateSourceNamePattern.test(content))
  ) {
    exposedSourceFiles.push(path.relative(distDirectory, file).replaceAll('\\', '/'));
  }
  if (/查看来源|查看上游记录/.test(content)) {
    exposedSourceEntryFiles.push(path.relative(distDirectory, file).replaceAll('\\', '/'));
  }
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(content)) {
    externalGoogleFontFiles.push(path.relative(distDirectory, file).replaceAll('\\', '/'));
  }
}
if (exposedSourceFiles.length) {
  errors.push('dist: private upstream identity is exposed in ' + exposedSourceFiles.slice(0, 8).join(', '));
}
if (exposedSourceEntryFiles.length) {
  errors.push('dist: upstream source entry text is exposed in ' + exposedSourceEntryFiles.slice(0, 8).join(', '));
}
if (externalGoogleFontFiles.length) {
  errors.push('dist: render-blocking Google Fonts references remain in ' + externalGoogleFontFiles.slice(0, 8).join(', '));
}

for (const warning of warnings) console.warn('Static output warning: ' + warning);
if (errors.length) {
  console.error('Static output check failed with ' + errors.length + ' error(s):');
  for (const error of errors) console.error('  - ' + error);
  process.exitCode = 1;
} else {
  const quoteCount = payload?.models?.length ?? 0;
  console.log(
    'Static output check passed: '
    + htmlFiles.length + ' HTML pages, '
    + sitemapUrls.length + ' sitemap URLs, '
    + quoteCount + ' quote snapshots, index '
    + indexBytes + ' bytes.',
  );
}
