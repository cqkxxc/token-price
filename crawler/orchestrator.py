"""
爬虫调度器 — fetch → normalize → validate → output JSON
输出到 frontend/site/src/data/
"""
import json
import os
import sys
import datetime
import time
from collections import Counter

from config import FRONTEND_DATA_DIR, USD_CNY_RATE
from adapters.oken_api import (
    fetch_models, fetch_suppliers,
    normalize_models, normalize_prices, normalize_suppliers
)
from probe import run_probe


def crawl(dry_run: bool = False):
    """主流程"""
    errors = []
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    models_data = []
    prices_data = []
    suppliers_data = []
    stability_data = None

    # ── 1. 抓取模型 + 价格（oken.ai API） ──
    try:
        raw_models = fetch_models()
        models_data = normalize_models(raw_models)
        print(f"  ✓ oken_api: {len(models_data)} models")
    except Exception as e:
        errors.append(f"  ✗ oken_api models: {e}")
        print(f"  ✗ oken_api models: {e}")

    # ── 2. 抓取供应商 ──
    raw_suppliers = []
    try:
        raw_suppliers = fetch_suppliers()
        suppliers_data = normalize_suppliers(raw_suppliers)
        print(f"  ✓ oken_api suppliers: {len(suppliers_data)} suppliers")
    except Exception as e:
        errors.append(f"  ✗ oken_api suppliers: {e}")
        print(f"  ✗ oken_api suppliers: {e}")

    # ── 3. 生成价格（官方 + 中转站） ──
    if models_data:
        prices_data = normalize_prices(raw_models, raw_suppliers)
        print(f"  ✓ prices: {len(prices_data)} entries")

    # ── 4. 校验与补全 ──
    if not models_data:
        print("  ⚠ No models from API — output will be empty")
        return 1

    # 从 prices 计算 supplier_count 和 has_online_supplier
    model_price_counts = Counter(p.get("canonical_id", "") for p in prices_data)
    for m in models_data:
        m["supplier_count"] = model_price_counts.get(m.get("canonical_id", ""), 0)
        m["has_online_supplier"] = m["supplier_count"] > 0

    # 给 suppliers 补上 available_models
    supplier_model_counts = Counter(p.get("supplier_slug", "") for p in prices_data)
    for s in suppliers_data:
        s["available_models"] = supplier_model_counts.get(s.get("slug", ""), 0)
        s["total_models"] = s["available_models"] or 0

    # ── 5. 稳定性探测（每个中转站） ──
    try:
        stability_data = run_probe(suppliers_data, models_data)
        print(f"  ✓ stability: {len(stability_data.get('stability', []))} records")
    except Exception as e:
        errors.append(f"  ✗ stability probe: {e}")
        print(f"  ✗ stability probe: {e}")

    # ── 6. 输出 JSON ──
    os.makedirs(FRONTEND_DATA_DIR, exist_ok=True)

    meta = {
        "version": "1.0.0",
        "data_updated_at": now,
        "usd_cny_rate": USD_CNY_RATE,
        "rate_updated_at": now,
        "total_models": len(models_data),
        "total_suppliers": len(suppliers_data),
    }

    outputs = {
        "meta.json": meta,
        "models.json": {"updated_at": now, "models": models_data},
        "prices.json": {"updated_at": now, "prices": prices_data},
        "suppliers.json": {"updated_at": now, "suppliers": suppliers_data},
        "monitor.json": {"updated_at": now, "records": []},
    }
    if stability_data:
        outputs["stability.json"] = stability_data

    if dry_run:
        print("\n  [DRY RUN] Would write:")
        for name, data in outputs.items():
            path = os.path.join(FRONTEND_DATA_DIR, name)
            size = len(json.dumps(data, ensure_ascii=False))
            print(f"    {path}  ({size:,} bytes)")
        return 0

    for filename, data in outputs.items():
        path = os.path.join(FRONTEND_DATA_DIR, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ── 7. 报告 ──
    print(f"\n  ✅ Output → {FRONTEND_DATA_DIR}/")
    print(f"     meta.json        — {len(models_data)} models, {len(suppliers_data)} suppliers")
    print(f"     models.json      — {len(models_data)} entries")
    print(f"     prices.json      — {len(prices_data)} entries")
    print(f"     suppliers.json   — {len(suppliers_data)} entries")
    if stability_data:
        print(f"     stability.json   — {len(stability_data['stability'])} entries")

    if errors:
        print(f"\n  ⚠ Errors ({len(errors)}):")
        for e in errors:
            print(e)

    return 0 if not errors else 1


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sys.exit(crawl(dry_run=dry))
