"""Fetch a complete verified Oken snapshot and atomically write each site JSON file."""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
from typing import Any

from adapters.oken_api import (
    OKEN_SITE,
    create_session,
    fetch_model_suppliers,
    fetch_models,
    fetch_supplier_directory,
    normalize_catalog,
    normalize_models,
)
from config import FRONTEND_DATA_DIR


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json_atomic(path: str, value: Any) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        dir=directory, prefix=f".{os.path.basename(path)}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary_path, path)
    except BaseException:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def crawl(dry_run: bool = False) -> int:
    """Abort on any required model/route request failure; never publish partial data."""
    fetched_at = _utc_now()
    session = create_session()
    try:
        raw_models = fetch_models(session)
        if not raw_models:
            raise RuntimeError("Oken returned no models; refusing an empty snapshot")
        source_model_count = len(raw_models)
        raw_models, models, excluded_models = normalize_models(raw_models)
        if not models:
            raise RuntimeError("Oken returned no models with verified official prices")
        print(
            f"  OK Oken models: {len(models)} publishable / "
            f"{source_model_count} source rows"
        )
        for item in excluded_models:
            print(
                f"  WARN Excluded model {item.get('slug') or item.get('id')}: "
                f"{item['reason']}"
            )

        try:
            supplier_directory = fetch_supplier_directory(session)
            print(f"  OK Optional supplier URL directory: {len(supplier_directory)}")
        except Exception as error:
            supplier_directory = []
            print(f"  WARN Optional supplier URL directory unavailable: {error}")

        rows_by_model_id: dict[int, list[dict[str, Any]]] = {}
        for index, raw_model in enumerate(raw_models, start=1):
            rows = fetch_model_suppliers(session, raw_model)
            rows_by_model_id[int(raw_model["id"])] = rows
            print(
                f"  OK Routes {index:>2}/{len(raw_models)} "
                f"{raw_model.get('sku_name')}: {len(rows)}"
            )
    finally:
        session.close()

    prices, suppliers, stability = normalize_catalog(
        raw_models,
        models,
        rows_by_model_id,
        supplier_directory,
        fetched_at,
    )
    if not prices:
        raise RuntimeError("No verified prices were normalized; refusing to publish")

    outputs = {
        "meta.json": {
            "version": "3.0.0",
            "data_updated_at": fetched_at,
            "source_name": "Oken",
            "source_url": OKEN_SITE,
            "total_models": len(models),
            "total_suppliers": len(suppliers),
            "source_total_models": source_model_count,
            "excluded_models": len(excluded_models),
        },
        "models.json": {"updated_at": fetched_at, "models": models},
        "prices.json": {"updated_at": fetched_at, "prices": prices},
        "suppliers.json": {"updated_at": fetched_at, "suppliers": suppliers},
        "stability.json": {"updated_at": fetched_at, "stability": stability},
        # Compatibility file only. Verified monitoring lives in stability.json;
        # synthetic direct probes are intentionally disabled.
        "monitor.json": {"updated_at": fetched_at, "records": []},
    }

    if dry_run:
        print("\n  [DRY RUN] Verified snapshot:")
        for filename, value in outputs.items():
            size = len(json.dumps(value, ensure_ascii=False).encode("utf-8"))
            print(f"    {filename:<18} {size:>10,} bytes")
        return 0

    for filename, value in outputs.items():
        _write_json_atomic(os.path.join(FRONTEND_DATA_DIR, filename), value)

    print(f"\n  OK Output: {FRONTEND_DATA_DIR}")
    print(f"     models:    {len(models)}")
    print(f"     prices:    {len(prices)}")
    print(f"     suppliers: {len(suppliers)}")
    print(f"     stability: {len(stability)}")
    return 0
