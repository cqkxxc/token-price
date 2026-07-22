import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteDirectory = path.resolve(scriptDirectory, '..');
const dataDirectory = path.join(siteDirectory, 'src', 'data');
const schemaPath = path.join(scriptDirectory, 'data-contract.schema.json');
const fileNames = ['meta', 'models', 'prices', 'suppliers', 'stability', 'monitor', 'manifest'];
const errors = [];
const maxReportedErrors = 100;

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(siteDirectory, filePath)}: ${error.message}`);
    return undefined;
  }
}

const schema = await readJson(schemaPath);
const bundle = {};
for (const name of fileNames) {
  bundle[name] = await readJson(path.join(dataDirectory, `${name}.json`));
}

function resolveReference(reference) {
  if (!reference.startsWith('#/')) throw new Error(`Unsupported schema reference: ${reference}`);
  return reference.slice(2).split('/').reduce((value, key) => value?.[key], schema);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function validateFormat(value, format, location) {
  if (typeof value !== 'string') return;
  if (format === 'date-time') {
    const canonicalUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
    const calendarDate = value.slice(0, 10);
    const parsed = new Date(value);
    if (!canonicalUtc.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== calendarDate) {
      errors.push(`${location}: must be an ISO 8601 UTC date-time`);
    }
  } else if (format === 'date') {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!dateOnly.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
      errors.push(`${location}: must be a YYYY-MM-DD date`);
    }
  } else if (format === 'uri') {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      errors.push(`${location}: must be a non-empty HTTP(S) URL`);
    }
  }
}

function validateSchema(value, rule, location = '$') {
  if (!rule || value === undefined) return;
  if (rule.$ref) return validateSchema(value, resolveReference(rule.$ref), location);

  if (rule.const !== undefined && value !== rule.const) {
    errors.push(`${location}: must equal ${JSON.stringify(rule.const)}`);
  }
  if (rule.enum && !rule.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${location}: must be one of ${rule.enum.map(JSON.stringify).join(', ')}`);
  }

  if (rule.type) {
    const expectedTypes = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!expectedTypes.some((expected) => matchesType(value, expected))) {
      errors.push(`${location}: expected ${expectedTypes.join(' or ')}, received ${valueType(value)}`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      errors.push(`${location}: must contain at least ${rule.minLength} character(s)`);
    }
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) {
      errors.push(`${location}: does not match ${rule.pattern}`);
    }
    if (rule.format) validateFormat(value, rule.format, location);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (rule.minimum !== undefined && value < rule.minimum) {
      errors.push(`${location}: must be >= ${rule.minimum}`);
    }
    if (rule.maximum !== undefined && value > rule.maximum) {
      errors.push(`${location}: must be <= ${rule.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) {
      errors.push(`${location}: must contain at least ${rule.minItems} item(s)`);
    }
    if (rule.uniqueItems) {
      const values = value.map((item) => JSON.stringify(item));
      if (new Set(values).size !== values.length) errors.push(`${location}: items must be unique`);
    }
    if (rule.items) value.forEach((item, index) => validateSchema(item, rule.items, `${location}[${index}]`));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}.${key}: required property is missing`);
    }
    for (const [key, child] of Object.entries(rule.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], child, `${location}.${key}`);
    }
    if (rule.additionalProperties === false) {
      const allowed = new Set(Object.keys(rule.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push(`${location}.${key}: unknown property`);
      }
    }
  }
}

if (schema && fileNames.every((name) => bundle[name] !== undefined)) {
  validateSchema(bundle, schema);
}

function addUniqueErrors(items, keyFor, label, location) {
  const seen = new Map();
  items.forEach((item, index) => {
    const key = keyFor(item);
    if (!key) return;
    if (seen.has(key)) {
      errors.push(`${location}[${index}]: duplicate ${label} ${JSON.stringify(key)} (first at index ${seen.get(key)})`);
    } else {
      seen.set(key, index);
    }
  });
}

function sameNumber(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9;
}

function routeRecordKey(item, modelKey = 'canonical_id') {
  const model = item?.[modelKey];
  const supplier = item?.supplier_slug;
  const route = item?.route;
  if (typeof model !== 'string' || typeof supplier !== 'string' || typeof route !== 'string') return '';
  return JSON.stringify([model.trim(), supplier.trim(), route.trim()]);
}

function hasMetric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateBusinessRules(data) {
  const models = data.models.models;
  const prices = data.prices.prices;
  const suppliers = data.suppliers.suppliers;
  const stability = data.stability.stability;
  const monitor = data.monitor.records;

  addUniqueErrors(models, (item) => item.slug, 'model slug', 'models.models');
  addUniqueErrors(models, (item) => item.canonical_id, 'canonical_id', 'models.models');
  addUniqueErrors(suppliers, (item) => item.slug, 'supplier slug', 'suppliers.suppliers');
  addUniqueErrors(
    prices,
    (item) => routeRecordKey(item),
    'model/supplier/route price key',
    'prices.prices',
  );
  addUniqueErrors(
    stability,
    (item) => routeRecordKey(item),
    'model/supplier/route stability key',
    'stability.stability',
  );
  addUniqueErrors(
    monitor,
    (item) => {
      if (typeof item?.model_slug !== 'string' || typeof item?.supplier_slug !== 'string' ||
          typeof item?.checked_at !== 'string') return '';
      return JSON.stringify([item.model_slug.trim(), item.supplier_slug.trim(), item.checked_at]);
    },
    'model/supplier/check-time monitor key',
    'monitor.records',
  );

  const modelById = new Map(models.map((model) => [model.canonical_id, model]));
  const modelBySlug = new Map(models.map((model) => [model.slug, model]));
  const supplierBySlug = new Map(suppliers.map((supplier) => [supplier.slug, supplier]));
  const companyBySlug = new Map();
  const activePriceKeys = new Set(
    prices.filter((price) => price.is_active === true).map((price) => routeRecordKey(price)).filter(Boolean),
  );
  const expectedUnit = {
    per_token: 'token',
    per_call: 'call',
    per_image: 'image',
    per_second: 'second',
  };

  for (const [index, model] of models.entries()) {
    const location = `models.models[${index}]`;
    const companyIdentity = JSON.stringify({
      name: model.company.name,
      name_zh: model.company.name_zh,
      logo_color: model.company.logo_color,
    });
    const knownCompany = companyBySlug.get(model.company.slug);
    if (knownCompany && knownCompany !== companyIdentity) {
      errors.push(`${location}.company: metadata is inconsistent with another model using slug ${JSON.stringify(model.company.slug)}`);
    } else {
      companyBySlug.set(model.company.slug, companyIdentity);
    }
    if (model.official_input_price + model.official_output_price <= 0) {
      errors.push(`${location}: official prices cannot both be zero`);
    }
    const activeQuotes = prices.filter((price) => price.canonical_id === model.canonical_id && price.is_active);
    const officialQuotes = activeQuotes.filter((price) => price.supplier_type === 'official');
    if (officialQuotes.length !== 1) {
      errors.push(`${location}: expected exactly one active official quote, found ${officialQuotes.length}`);
    } else {
      const quote = officialQuotes[0];
      if (quote.supplier_name !== model.official_price_source) {
        errors.push(`${location}: official quote supplier must equal official_price_source`);
      }
      if (quote.route !== '官方参考价') {
        errors.push(`${location}: official quote route must be 官方参考价`);
      }
      if (!sameNumber(quote.input_price, model.official_input_price) ||
          !sameNumber(quote.output_price, model.official_output_price)) {
        errors.push(`${location}: official quote prices must match the model official prices`);
      }
    }

    const distinctSuppliers = new Set(activeQuotes.map((price) => price.supplier_slug)).size;
    if (model.supplier_count !== distinctSuppliers) {
      errors.push(`${location}.supplier_count: expected ${distinctSuppliers}, received ${model.supplier_count}`);
    }
    const hasOnlineSupplier = activeQuotes.some((price) => price.supplier_type !== 'official');
    if (model.has_online_supplier !== hasOnlineSupplier) {
      errors.push(
        `${location}.has_online_supplier: expected ${hasOnlineSupplier} from active non-reference quotes`,
      );
    }
  }

  for (const [index, price] of prices.entries()) {
    const location = `prices.prices[${index}]`;
    const model = modelById.get(price.canonical_id);
    if (!model) {
      errors.push(`${location}.canonical_id: does not reference models.json`);
      continue;
    }
    if (price.unit !== expectedUnit[model.pricing_method]) {
      errors.push(`${location}.unit: expected ${expectedUnit[model.pricing_method]} for ${model.pricing_method}`);
    }
    if (price.is_active && !price.fetched_at) {
      errors.push(`${location}.fetched_at: active quotes require a collection timestamp`);
    }
    if (price.is_active && price.input_price <= 0 && price.output_price <= 0) {
      errors.push(`${location}: active quotes require a positive input_price or output_price`);
    }
    const referencedSupplier = supplierBySlug.get(price.supplier_slug);
    if (price.is_active && !referencedSupplier) {
      errors.push(`${location}.supplier_slug: active quote does not reference suppliers.json`);
    }
    if (referencedSupplier && price.supplier_name !== referencedSupplier.name) {
      errors.push(`${location}.supplier_name: does not match the referenced supplier name`);
    }
  }

  for (const [index, supplier] of suppliers.entries()) {
    const quotedModels = new Set(
      prices
        .filter((price) => price.is_active && price.supplier_slug === supplier.slug)
        .map((price) => price.canonical_id),
    ).size;
    if (supplier.available_models !== quotedModels) {
      errors.push(`suppliers.suppliers[${index}].available_models: expected ${quotedModels}, received ${supplier.available_models}`);
    }
    if (supplier.total_models < supplier.available_models) {
      errors.push(`suppliers.suppliers[${index}].total_models: cannot be lower than available_models`);
    }
  }

  for (const [index, item] of stability.entries()) {
    const location = `stability.stability[${index}]`;
    const model = modelById.get(item.canonical_id);
    if (!model) errors.push(`${location}.canonical_id: does not reference models.json`);
    if (model && item.model_slug !== model.slug) {
      errors.push(`${location}.model_slug: does not match canonical_id`);
    }
    const supplier = supplierBySlug.get(item.supplier_slug);
    if (!supplier) {
      errors.push(`${location}.supplier_slug: does not reference suppliers.json`);
    }
    if (supplier && item.supplier_name !== supplier.name) {
      errors.push(`${location}.supplier_name: does not match the referenced supplier name`);
    }
    if (!activePriceKeys.has(routeRecordKey(item))) {
      errors.push(`${location}: does not reference an active quote with the same model, supplier, and route`);
    }
    if (!item.last_checked_at) {
      errors.push(`${location}.last_checked_at: verified stability records require an upstream observation timestamp`);
    }
    if (![item.uptime_7d, item.avg_latency_ms, item.last_response_time_ms].some(hasMetric)) {
      errors.push(`${location}: verified stability records require at least one upstream metric`);
    }
    const countMatch = typeof item.response_text === 'string'
      ? item.response_text.match(/(?:共)?监控\s*([\d,]+)\s*次/u)
      : null;
    const reportedSamples = countMatch ? Number(countMatch[1].replaceAll(',', '')) : null;
    if (reportedSamples !== null && item.samples_7d !== reportedSamples) {
      errors.push(`${location}.samples_7d: must equal the monitor count ${reportedSamples} reported by response_text`);
    }
    if (reportedSamples === null && item.samples_7d !== null) {
      errors.push(`${location}.samples_7d: must be null when response_text has no auditable monitor count`);
    }
    if (item.last_error && item.response_text && item.last_error === item.response_text) {
      errors.push(`${location}.last_error: upstream explanatory text must not be stored as an error`);
    }
  }

  for (const [index, item] of monitor.entries()) {
    if (!modelBySlug.has(item.model_slug)) {
      errors.push(`monitor.records[${index}].model_slug: does not reference models.json`);
    }
    if (!supplierBySlug.has(item.supplier_slug)) {
      errors.push(`monitor.records[${index}].supplier_slug: does not reference suppliers.json`);
    }
  }

  if (data.meta.total_models !== models.length) {
    errors.push(`meta.total_models: expected ${models.length}, received ${data.meta.total_models}`);
  }
  if (data.meta.total_suppliers !== suppliers.length) {
    errors.push(`meta.total_suppliers: expected ${suppliers.length}, received ${data.meta.total_suppliers}`);
  }
  if (data.meta.source_total_models !== undefined || data.meta.excluded_models !== undefined) {
    if (!Number.isInteger(data.meta.source_total_models) || !Number.isInteger(data.meta.excluded_models)) {
      errors.push('meta.source_total_models and meta.excluded_models must be provided together as integers');
    } else {
      if (data.meta.source_total_models < data.meta.total_models) {
        errors.push('meta.source_total_models: cannot be lower than total_models');
      }
      const expectedExcluded = data.meta.source_total_models - data.meta.total_models;
      if (data.meta.excluded_models !== expectedExcluded) {
        errors.push(`meta.excluded_models: expected ${expectedExcluded}, received ${data.meta.excluded_models}`);
      }
    }
  }
  for (const fileName of ['models', 'prices', 'suppliers', 'stability', 'monitor']) {
    if (data[fileName].updated_at !== data.meta.data_updated_at) {
      errors.push(`${fileName}.updated_at: must match meta.data_updated_at`);
    }
  }

  const vendors = data.manifest.vendors;
  addUniqueErrors(vendors, (item) => item.vendorId, 'manifest vendorId', 'manifest.vendors');
  for (const [index, vendor] of vendors.entries()) {
    if (!vendor.file && !(Array.isArray(vendor.files) && vendor.files.length)) {
      errors.push(`manifest.vendors[${index}]: either file or files is required`);
    }
  }
  for (const [index, mapping] of data.manifest.model_mappings.entries()) {
    if (!mapping.file && !(Array.isArray(mapping.files) && mapping.files.length)) {
      errors.push(`manifest.model_mappings[${index}]: either file or files is required`);
    }
    if (mapping.files && mapping.files.length !== mapping.prd_models.length) {
      errors.push(`manifest.model_mappings[${index}]: files and prd_models must have equal lengths`);
    }
  }
}

const hasBusinessShape =
  bundle.meta !== null && typeof bundle.meta === 'object' && !Array.isArray(bundle.meta) &&
  Array.isArray(bundle.models?.models) &&
  bundle.models.models.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
  Array.isArray(bundle.prices?.prices) &&
  bundle.prices.prices.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
  Array.isArray(bundle.suppliers?.suppliers) &&
  bundle.suppliers.suppliers.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
  Array.isArray(bundle.stability?.stability) &&
  bundle.stability.stability.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
  Array.isArray(bundle.monitor?.records) &&
  bundle.monitor.records.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
  Array.isArray(bundle.manifest?.vendors) &&
  bundle.manifest.vendors.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) &&
  Array.isArray(bundle.manifest?.model_mappings);

if (hasBusinessShape) validateBusinessRules(bundle);

if (errors.length) {
  console.error(`Data validation failed with ${errors.length} error(s):`);
  const grouped = new Map();
  for (const error of errors) {
    const signature = error.replace(/\[\d+\]/g, '[]').replace(/first at index \d+/g, 'first at another index');
    const group = grouped.get(signature);
    if (group) group.count += 1;
    else grouped.set(signature, { first: error, count: 1 });
  }
  const groups = [...grouped.values()];
  for (const group of groups.slice(0, maxReportedErrors)) {
    const repeated = group.count > 1 ? ` (${group.count} occurrences)` : '';
    console.error(`  - ${group.first}${repeated}`);
  }
  if (groups.length > maxReportedErrors) {
    console.error(`  - ... ${groups.length - maxReportedErrors} additional error group(s) omitted`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Data validation passed: ${bundle.models.models.length} models, ` +
    `${bundle.prices.prices.length} prices, ${bundle.suppliers.suppliers.length} suppliers, ` +
    `${bundle.stability.stability.length} stability records.`,
  );
}
