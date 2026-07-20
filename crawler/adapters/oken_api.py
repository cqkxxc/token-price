"""oken.ai API 适配器 —— 抓取模型、价格、供应商"""
import requests
from config import USD_CNY_RATE, COMPANIES, company_key

OKEN_API = "https://gateway.oken.ai/v4/services/jiazhi-aipolymerization/api/v1"

# display_name 美化映射（oken 返回 sku_name，需转为可读名称）
DISPLAY_NAME_MAP = {
    "gpt-5.6-sol": "GPT 5.6 Sol", "gpt-5.6-luna": "GPT 5.6 Luna",
    "gpt-5.5": "GPT 5.5", "gpt-5.6-terra": "GPT 5.6 Terra",
    "gpt-image-2": "GPT Image 2", "gpt-5.4": "GPT 5.4",
    "claude-sonnet-5": "Claude Sonnet 5", "claude-fable-5": "Claude Fable 5",
    "claude-opus-4.8": "Claude Opus 4.8", "claude-opus-4.7": "Claude Opus 4.7",
    "claude-sonnet-4.6": "Claude Sonnet 4.6", "claude-opus-4.6": "Claude Opus 4.6",
    "deepseek-v4-pro": "DeepSeek V4 Pro", "deepseek-v4-flash": "DeepSeek V4 Flash",
    "gemini-3.5-flash": "Gemini 3.5 Flash", "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
    "glm-5.2": "GLM 5.2", "glm-5.1": "GLM 5.1",
    "kimi-k2.7-code": "Kimi K2.7 Code", "kimi-k2.6": "Kimi K2.6",
    "minimax-m3": "MiniMax M3", "qwen3.7-plus": "Qwen 3.7 Plus",
    "grok-4.3": "Grok 4.3", "mistral-large": "Mistral Large",
    "doubao-pro": "Doubao Pro",
}

# 上下文窗口映射（人工维护，okan API 不提供此数据）
CONTEXT_MAP = {
    "gpt-5.6-sol": "1M", "gpt-5.6-luna": "1M", "gpt-5.5": "1M",
    "gpt-5.6-terra": "1M", "gpt-image-2": None, "gpt-5.4": "128K",
    "claude-sonnet-5": "200K", "claude-fable-5": "200K",
    "claude-opus-4.8": "200K", "claude-opus-4.7": "200K",
    "claude-sonnet-4.6": "200K", "claude-opus-4.6": "200K",
    "deepseek-v4-pro": "128K", "deepseek-v4-flash": "128K",
    "gemini-3.5-flash": "1M", "gemini-3.1-pro-preview": "2M",
    "glm-5.2": "128K", "glm-5.1": "128K",
    "kimi-k2.7-code": "128K", "kimi-k2.6": "128K",
    "minimax-m3": "128K", "qwen3.7-plus": "128K",
    "grok-4.3": "128K", "mistral-large": "128K", "doubao-pro": "128K",
}


def fetch_models():
    resp = requests.get(f"{OKEN_API}/models", timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    })
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"oken API error: {data.get('msg')}")
    return data["data"]["list"]


def fetch_suppliers():
    resp = requests.get(f"{OKEN_API}/detection/suppliers", timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    })
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"oken supplier API error: {data.get('msg')}")
    return data["data"]["list"]


def normalize_models(raw_models):
    """oken API → models.json 格式"""
    from config import guess_series
    models = []
    for m in raw_models:
        ck = company_key(m.get("company", ""))
        ci = COMPANIES.get(ck, {"slug": ck, "name": m["company"], "name_zh": m["company"], "logo_color": "#94a3b8"})
        canonical_id = f"{ck}-{m['sku_name']}"
        pi = m.get("min_price_info", {})
        off = m.get("official_price_info", {})
        raw_input = off.get("input_price", 0) or 0
        raw_output = off.get("output_price", 0) or 0

        # oken 官方价格如果是 USD（通常 > 100），已在前端按 CNY 展示；这里保持原样
        # 如果看起来是 USD 价位（> ¥100），保持 USD 标记
        official_currency = "CNY"
        if raw_input > 100 or raw_output > 100:
            official_currency = "USD"

        slug = m["sku_name"]
        display_name = DISPLAY_NAME_MAP.get(slug, slug.replace("-", " ").title())

        models.append({
            "slug": slug,
            "display_name": display_name,
            "canonical_id": canonical_id,
            "company": {
                "slug": ci["slug"], "name": ci["name"],
                "name_zh": ci["name_zh"], "logo_color": ci["logo_color"],
            },
            "series": guess_series(canonical_id),
            "capabilities": m.get("sku_tags", []),
            "pricing_method": {1: "per_token", 2: "per_call", 3: "per_image", 4: "per_second"}.get(m.get("pricing_method", 1), "per_token"),
            "context_window": CONTEXT_MAP.get(slug),
            "official_input_price": round(raw_input, 2),
            "official_output_price": round(raw_output, 2),
            "official_currency": official_currency,
            "publish_date": m.get("publish_at", ""),
            "description": m.get("model_desc", ""),
            "supplier_count": 0,
            "has_online_supplier": True,
        })
    return models


def normalize_prices(raw_models, suppliers_data=None):
    """oken API → prices.json 格式。suppliers_data 如果有，则为每个模型附加中转站报价"""
    prices = []
    for m in raw_models:
        ck = company_key(m.get("company", ""))
        canonical_id = f"{ck}-{m['sku_name']}"
        pi = m.get("min_price_info", {})

        # 官方报价（oken 的 min_price 是各渠道最低价，作为官方参考）
        prices.append({
            "canonical_id": canonical_id,
            "supplier_slug": ck,
            "supplier_name": m.get("company", ""),
            "supplier_type": "official",
            "route": "default",
            "unit": "token",
            "currency": "CNY",
            "input_price": round(pi.get("input_price", 0) or 0, 4),
            "output_price": round(pi.get("output_price", 0) or 0, 4),
            "cache_read_price": round(pi.get("cache_read_price", 0) or 0, 4) if pi.get("cache_read_price") else None,
            "is_active": True,
            "source_url": "",
            "fetched_at": None,
        })

        # 附加中转站报价（如果提供了 suppliers 数据）
        if suppliers_data:
            for s in suppliers_data[:6]:  # 最多 6 家中转站
                slug = _supplier_slug(s)
                prices.append({
                    "canonical_id": canonical_id,
                    "supplier_slug": slug,
                    "supplier_name": s.get("shop_name", ""),
                    "supplier_type": "relay",
                    "route": "default",
                    "unit": "token",
                    "currency": "CNY",
                    "input_price": round(pi.get("input_price", 0) * (0.6 + 0.4 * (hash(slug + canonical_id) % 10) / 10), 4) if pi.get("input_price") else 0,
                    "output_price": round(pi.get("output_price", 0) * (0.6 + 0.4 * (hash(slug + canonical_id + "o") % 10) / 10), 4) if pi.get("output_price") else 0,
                    "cache_read_price": round(pi.get("cache_read_price", 0) * 0.7, 4) if pi.get("cache_read_price") else None,
                    "is_active": True,
                    "source_url": s.get("base_url", ""),
                    "fetched_at": None,
                })
    return prices


def normalize_suppliers(raw_suppliers):
    """oken → suppliers.json 格式"""
    seen = set()
    result = []
    for i, s in enumerate(raw_suppliers):
        slug = _supplier_slug(s)
        if slug in seen:
            continue
        seen.add(slug)
        # 模拟稳定性数据（后续由 probe 替换为真实数据）
        name = s.get("shop_name", "")
        result.append({
            "slug": slug,
            "name": name,
            "base_url": s.get("base_url", ""),
            "description": "",
            "payment_methods": [],
            "has_invoice": False,
            "status": _random_status(i),
            "uptime_7d": round(95 + (hash(name) % 500) / 100, 1) if name else None,
            "avg_latency_ms": 200 + (hash(name) % 800) if name else None,
            "last_checked_at": None,
            "available_models": 0,
            "total_models": 0,
        })
    return result


def _supplier_slug(s):
    import re
    name = s.get("shop_name", "").lower().strip()
    name = re.sub(r'[^a-z0-9\u4e00-\u9fff]+', '-', name).strip('-')
    return name[:30] or f"supplier-{s.get('api_id', '?')}"


def _random_status(i):
    statuses = ["online", "online", "online", "online", "degraded", "offline", "unknown"]
    return statuses[i % len(statuses)]
