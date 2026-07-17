// 一次性数据生成脚本：按 json-schema.md 契约生成 5 个关联一致的示例 JSON。
// 运行：node scripts/gen-sample-data.mjs  → 覆盖写入 src/data/*.json
// 数据均为编造，仅用于验证渲染。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const NOW = '2026-07-16T08:00:00Z';
const round = (n) => Math.round(n * 100) / 100;

// ── 模型定义（名称/价格编造；company.slug 用可命中 logo 的值）──────────
// io = [官方输入价, 官方输出价]（¥/百万 tokens，per_token）
const M = [
  // OpenAI
  ['gpt-5.6-sol', 'GPT 5.6 Sol', 'openai', 'OpenAI', 'OpenAI', '#10a37f', 'GPT', ['对话','识图','深度思考','编码','长文本处理','多模态融合'], 'per_token', '1M', 4.67, 28.05, 'USD', 'GPT-5.6 Sol 面向极限深度推理与长周期智能体任务，在代码开发、专业知识工作与科研领域达到业界顶尖水平，单位成本更低。'],
  ['gpt-5.5', 'GPT 5.5', 'openai', 'OpenAI', 'OpenAI', '#10a37f', 'GPT', ['对话','长文本处理','多模态融合'], 'per_token', '1M', 6.5, 40.0, 'USD', 'GPT-5.5 面向复杂专业工作负载，具备百万级上下文窗口，支持文本与图像输入，可完成大规模推理、编码与多模态工作流。'],
  ['gpt-image-2', 'GPT Image 2', 'openai', 'OpenAI', 'OpenAI', '#10a37f', 'GPT', ['识图','多模态融合'], 'per_image', null, 0.32, 0, 'USD', 'gpt-image-2 是具备推理能力的商用级图像模型，支持 4K 分辨率、精准编辑与高文字准确率。'],
  // Anthropic
  ['claude-sonnet-5', 'Claude Sonnet 5', 'anthropic', 'Anthropic', 'Anthropic', '#d97757', 'Claude', ['对话','识图','深度思考','编码','长文本处理','多模态融合'], 'per_token', '1M', 13.56, 67.78, 'CNY', 'Claude Sonnet 5 是迄今智能体能力最强的 Sonnet 系列模型，可自主制定任务规划、调用浏览器 / 终端工具完成任务。'],
  ['claude-opus-4.8', 'Claude Opus 4.8', 'anthropic', 'Anthropic', 'Anthropic', '#d97757', 'Claude', ['对话','深度思考','编码','多模态融合'], 'per_token', '1M', 33.9, 169.4, 'USD', 'Claude Opus 4.8 是 Opus 系列最强通用模型，适合高度自主的长周期智能体任务、复杂编码与端到端项目编排。'],
  ['claude-fable-5', 'Claude Fable 5', 'anthropic', 'Anthropic', 'Anthropic', '#d97757', 'Claude', ['对话','识图','深度思考','编码','长文本处理'], 'per_token', '1M', 9.35, 46.74, 'USD', 'Claude Fable 5 是 Mythos 级模型，专为自主知识工作与编码构建，擅长端到端完成多步骤、长耗时任务。'],
  // Google
  ['gemini-3-pro', 'Gemini 3 Pro', 'google', 'Google', 'Google', '#4285f4', 'Gemini', ['对话','识图','深度思考','编码','语音','视频','长文本处理','多模态融合'], 'per_token', '2M', 8.7, 52.2, 'USD', 'Gemini 3 Pro 是 Google 旗舰多模态模型，具备 200 万 token 上下文，原生支持文本、图像、音频与视频输入。'],
  ['gemini-3-flash', 'Gemini 3 Flash', 'google', 'Google', 'Google', '#4285f4', 'Gemini', ['对话','识图','长文本处理','多模态融合'], 'per_token', '1M', 1.4, 8.4, 'USD', 'Gemini 3 Flash 是低延迟高性价比版本，面向高并发线上业务，保留完整多模态能力。'],
  // DeepSeek
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'DeepSeek', 'DeepSeek', '#4d6bfe', 'DeepSeek', ['对话','识图','深度思考','编码','长文本处理','多模态融合'], 'per_token', '1M', 3.0, 6.0, 'CNY', 'DeepSeek V4 Pro 是大规模 MoE 模型（1.6T 总参 / 49B 激活），面向高级推理、编码与长周期智能体工作流。'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 'DeepSeek', 'DeepSeek', '#4d6bfe', 'DeepSeek', ['对话','深度思考','编码','长文本处理'], 'per_token', '1M', 1.0, 2.0, 'CNY', 'DeepSeek V4 Flash 是效率优化型 MoE 模型（284B 总参 / 13B 激活），面向快速推理与高吞吐场景。'],
  // xAI
  ['grok-4.5', 'Grok 4.5', 'xai', 'xAI', 'xAI', '#0f172a', 'Grok', ['对话','识图','深度思考','编码','长文本处理','多模态融合'], 'per_token', '512K', 13.56, 40.67, 'CNY', 'Grok 4.5 是 xAI 迄今性能最强模型，在编程、智能体任务与专业知识工作领域表现突出，支持深度推理与函数调用。'],
  // Zhipu
  ['glm-5.2', 'GLM 5.2', 'zhipu', 'Zhipu AI', '智谱', '#2563eb', 'GLM', ['对话','深度思考','编码','长文本处理'], 'per_token', '1M', 8.0, 28.0, 'CNY', 'GLM-5.2 是面向长任务时代的旗舰模型，支持真正可用的 1M 上下文，长程任务执行稳定、工程规范遵循可靠。'],
  // Moonshot / Kimi
  ['kimi-k2.7-code', 'Kimi K2.7 Code', 'kimi', 'Moonshot', '月之暗面', '#7c3aed', 'Kimi', ['对话','深度思考','编码','长文本处理'], 'per_token', '256K', 6.5, 27.0, 'CNY', 'Kimi K2.7 Code 是完全开源的代码专项 MoE 大模型（1T 总参 / 32B 激活），专为长周期软件工程任务打造。'],
  // MiniMax
  ['minimax-m3', 'MiniMax M3', 'minimax', 'MiniMax', 'MiniMax', '#ec4899', 'MiniMax', ['识图','语音','多模态融合'], 'per_token', '1M', 4.2, 16.8, 'CNY', 'MiniMax-M3 是多模态基础模型，支持文本 / 图像 / 视频输入，基于稀疏注意力大幅降低长上下文成本。'],
  // ByteDance / Doubao
  ['doubao-seed-2.1-pro', 'Doubao Seed 2.1 Pro', 'bytedance', 'ByteDance', '字节跳动', '#0f172a', 'Doubao', ['对话','识图','深度思考','编码','语音','视频','长文本处理','多模态融合'], 'per_token', '512K', 6.0, 30.0, 'CNY', 'Doubao-Seed-2.1-pro 是 Seed 2.1 系列旗舰深度推理版本，在编程交付、长链路智能体任务与多模态理解全面升级。'],
  // Alibaba / Qwen
  ['qwen-3-max', 'Qwen 3 Max', 'qwen', 'Alibaba', '阿里云', '#ff6a00', 'Qwen', ['对话','识图','深度思考','编码','长文本处理','多模态融合'], 'per_token', '1M', 5.6, 22.4, 'CNY', 'Qwen 3 Max 是通义千问旗舰模型，具备强推理与多模态能力，面向企业级复杂任务与智能体编排。'],
];

// ── 中转站供应商池（编造，slug 与官方厂商区分）─────────────────────
const RELAYS = [
  ['linkapi', 'LinkAPI', 'https://api.linkapi.ai', '全球 AI API 聚合平台，覆盖 OpenAI/Claude/Gemini/DeepSeek 等主流模型。', ['支付宝','微信','对公转账'], true, 'online', 99.9, 210],
  ['dmxapi', 'DMXAPI', 'https://www.dmxapi.com', '多模型统一接入中转站，支持高并发与企业开票。', ['支付宝','微信'], true, 'online', 99.6, 260],
  ['yunwu', '云雾API', 'https://yunwu.ai', '高性价比中转，支持 HK/US 多线路。', ['支付宝','微信','加密货币'], false, 'online', 98.7, 320],
  ['4sapi', '4SAPI', 'https://4sapi.com', '主打稳定低价的模型分发平台。', ['支付宝','微信'], false, 'degraded', 95.2, 540],
  ['sparkcode', 'Spark Code', 'https://sparkcode.top', '面向开发者的代码类模型中转。', ['微信'], false, 'online', 99.1, 300],
  ['xiavier', 'Xiavier AI', 'https://api.xiavier.com', '多区域路由，主打低延迟。', ['支付宝','微信','PayPal'], true, 'online', 99.4, 180],
  ['dadao', '刀刀中转API', 'https://api.chatgptid.net', '老牌中转，模型覆盖全。', ['支付宝','微信'], false, 'degraded', 96.0, 620],
  ['happyapi', 'Happy API', 'https://happyapi.org', '聚合中转，支持加密货币。', ['加密货币','PayPal'], false, 'online', 98.2, 350],
  ['packyapi', 'PackyAPI', 'https://www.packyapi.com', '企业级中转，提供 SLA 保障。', ['支付宝','对公转账'], true, 'online', 99.8, 150],
  ['apiyi', 'APIYI', 'https://api.apiyi.com', '多模型低价分发，支持开票。', ['支付宝','微信'], true, 'offline', 42.0, null],
];

// 官方厂商作为 supplier（用于 official 报价 + 监控）
const OFFICIALS = [
  ['openai', 'OpenAI', 'https://api.openai.com', '官方 API', ['信用卡'], true, 'online', 99.95, 400],
  ['anthropic', 'Anthropic', 'https://api.anthropic.com', '官方 API', ['信用卡'], true, 'online', 99.9, 380],
  ['google', 'Google', 'https://generativelanguage.googleapis.com', '官方 API', ['信用卡'], true, 'online', 99.9, 300],
  ['deepseek', 'DeepSeek', 'https://api.deepseek.com', '官方 API', ['支付宝','微信'], true, 'online', 99.7, 220],
  ['xai', 'xAI', 'https://api.x.ai', '官方 API', ['信用卡'], true, 'degraded', 97.5, 520],
  ['zhipu', '智谱 AI', 'https://open.bigmodel.cn', '官方 API', ['支付宝','微信','对公转账'], true, 'online', 99.6, 240],
  ['moonshot', 'Moonshot', 'https://api.moonshot.cn', '官方 API', ['支付宝','微信'], true, 'online', 99.5, 260],
  ['minimax', 'MiniMax', 'https://api.minimaxi.com', '官方 API', ['支付宝','微信'], true, 'online', 99.3, 280],
  ['volcengine', '火山引擎', 'https://ark.cn-beijing.volces.com', '字节官方（豆包）', ['支付宝','对公转账'], true, 'online', 99.8, 200],
  ['aliyun', '阿里云百炼', 'https://dashscope.aliyuncs.com', '官方 API（通义千问）', ['支付宝','对公转账'], true, 'online', 99.7, 210],
];

// 模型厂商 slug → 官方 supplier slug（用于 official 报价关联）
const OFFICIAL_OF = {
  openai: 'openai', anthropic: 'anthropic', google: 'google', deepseek: 'deepseek',
  xai: 'xai', zhipu: 'zhipu', kimi: 'moonshot', minimax: 'minimax',
  bytedance: 'volcengine', qwen: 'aliyun',
};

// ── 生成 models.json + prices.json ─────────────────────────────
const models = [];
const prices = [];
// 简单可复现的伪随机（不依赖 Math.random，保证每次生成一致）
let seed = 20260716;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr, n) => { const c = [...arr]; const out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };

for (const m of M) {
  const [slug, name, cslug, cname, cname_zh, color, series, caps, method, ctx, inP, outP, cur, desc] = m;
  const canonical = `${cslug}-${slug}`;
  const isToken = method === 'per_token';
  const officialComposite = isToken ? inP + outP : inP;

  // official 报价（≈官方价）
  const offSlug = OFFICIAL_OF[cslug] || cslug;
  const off = OFFICIALS.find((o) => o[0] === offSlug);
  const offName = off ? off[1] : cname;
  const relayCount = 2 + Math.floor(rnd() * 2); // 2~3 家中转
  const chosen = pick(RELAYS, relayCount);

  const routePool = ['default', 'hk', 'us', 'jp'];
  const rowPrices = [];
  // 官方报价
  rowPrices.push({
    canonical_id: canonical, supplier_slug: offSlug, supplier_name: offName, supplier_type: 'official',
    route: 'default', unit: isToken ? 'token' : (method === 'per_image' ? 'image' : 'call'),
    currency: 'CNY',
    input_price: isToken ? round(inP) : round(inP),
    output_price: isToken ? round(outP) : 0,
    cache_read_price: isToken ? round(inP * 0.1) : null,
    is_active: true, source_url: `${off ? off[2] : 'https://example.com'}/pricing`, fetched_at: NOW,
  });
  // 中转站报价：综合价按官方的 45%~85% 打折
  chosen.forEach((r, i) => {
    const factor = 0.45 + rnd() * 0.4; // 0.45~0.85
    const inp = round(inP * factor);
    const outp = isToken ? round(outP * factor) : 0;
    rowPrices.push({
      canonical_id: canonical, supplier_slug: r[0], supplier_name: r[1], supplier_type: 'relay',
      route: routePool[(i + 1) % routePool.length],
      unit: isToken ? 'token' : (method === 'per_image' ? 'image' : 'call'),
      currency: 'CNY', input_price: inp, output_price: outp,
      cache_read_price: isToken ? round(inp * 0.1) : null,
      is_active: true, source_url: `${r[2]}/pricing#${slug}`, fetched_at: NOW,
    });
  });
  prices.push(...rowPrices);

  const activeCount = rowPrices.filter((p) => p.is_active && p.source_url).length;
  models.push({
    slug, display_name: name,
    canonical_id: canonical,
    company: { slug: cslug, name: cname, name_zh: cname_zh, logo_color: color },
    series, capabilities: caps, pricing_method: method,
    context_window: ctx,
    official_input_price: round(inP), official_output_price: round(outP),
    official_currency: cur,
    publish_date: '2026-0' + (1 + Math.floor(rnd() * 6)) + '-1' + Math.floor(rnd() * 9),
    description: desc,
    supplier_count: activeCount,
    has_online_supplier: true,
  });
}

// ── suppliers.json（官方 + 中转，供监控页 + 抽屉状态用）──────────
const suppliers = [];
for (const o of OFFICIALS) {
  const [slug, nm, base, dscr, pays, invoice, status, uptime, latency] = o;
  suppliers.push({
    slug, name: nm, base_url: base, description: dscr, payment_methods: pays, has_invoice: invoice,
    status, uptime_7d: uptime, avg_latency_ms: latency, last_checked_at: NOW,
    available_models: models.filter((m) => (OFFICIAL_OF[m.company.slug] || m.company.slug) === slug).length,
    total_models: models.filter((m) => (OFFICIAL_OF[m.company.slug] || m.company.slug) === slug).length,
  });
}
for (const r of RELAYS) {
  const [slug, nm, base, dscr, pays, invoice, status, uptime, latency] = r;
  const cnt = prices.filter((p) => p.supplier_slug === slug).length;
  suppliers.push({
    slug, name: nm, base_url: base, description: dscr, payment_methods: pays, has_invoice: invoice,
    status, uptime_7d: uptime, avg_latency_ms: latency, last_checked_at: NOW,
    available_models: cnt, total_models: cnt,
  });
}

// ── monitor.json（原始探测记录，示范用）────────────────────────
const records = suppliers.map((s) => ({
  supplier_slug: s.slug,
  checked_at: NOW,
  is_available: s.status !== 'offline',
  response_time_ms: s.avg_latency_ms,
  http_status: s.status === 'offline' ? 0 : 200,
  error_message: s.status === 'offline' ? 'connection timeout' : null,
}));

// ── meta.json ─────────────────────────────────────────────────
const meta = {
  version: '1.0.0', data_updated_at: NOW, usd_cny_rate: 7.25, rate_updated_at: NOW,
  total_models: models.length, total_suppliers: suppliers.length,
};

// ── 写文件 ────────────────────────────────────────────────────
const w = (name, obj) => writeFileSync(join(DATA_DIR, name), JSON.stringify(obj, null, 2) + '\n', 'utf8');
w('meta.json', meta);
w('models.json', { updated_at: NOW, models });
w('prices.json', { updated_at: NOW, prices });
w('suppliers.json', { updated_at: NOW, suppliers });
w('monitor.json', { updated_at: NOW, records });

console.log(`✔ models=${models.length} prices=${prices.length} suppliers=${suppliers.length} records=${records.length}`);
console.log('  折扣抽样:');
for (const m of models.slice(0, 4)) {
  const ps = prices.filter((p) => p.canonical_id === m.canonical_id);
  const comp = m.pricing_method === 'per_token' ? m.official_input_price + m.official_output_price : m.official_input_price;
  const best = Math.min(...ps.map((p) => m.pricing_method === 'per_token' ? p.input_price + p.output_price : p.input_price));
  console.log(`   ${m.display_name}: 官方综合 ¥${round(comp)} → 最低 ¥${round(best)} (折 ${Math.round((1 - best / comp) * 100)}%) · ${ps.length} 家`);
}
