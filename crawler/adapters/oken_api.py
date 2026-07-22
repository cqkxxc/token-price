"""Verified Oken data adapter.

Every published quote and stability value comes directly from Oken's public
model-supplier endpoint. Missing fields are left unknown; this module contains
no random discounts, guessed currencies, or synthetic health checks.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from collections import Counter, defaultdict
from typing import Any
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import COMPANIES, company_key, guess_series

OKEN_API = "https://gateway.oken.ai/v4/services/jiazhi-aipolymerization/api/v1"
PAGE_SIZE = 200
TIMEOUT_SECONDS = 30
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "AIModelPriceCompareCrawler/2.0 (+https://oken.ai/zh)",
}
PRICING_METHODS = {
    1: ("per_token", "token"),
    2: ("per_call", "call"),
    3: ("per_image", "image"),
    4: ("per_second", "second"),
}
DISPLAY_TOKENS = {
    "gpt": "GPT",
    "glm": "GLM",
    "claude": "Claude",
    "deepseek": "DeepSeek",
    "kimi": "Kimi",
    "minimax": "MiniMax",
    "doubao": "Doubao",
    "grok": "Grok",
}


def create_session() -> requests.Session:
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.headers.update(HEADERS)
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def _request_data(
    session: requests.Session,
    path: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = session.get(
        f"{OKEN_API}{path}", params=params, timeout=TIMEOUT_SECONDS
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 0:
        message = payload.get("msg") or payload.get("message") or payload
        raise RuntimeError(f"Oken API {path} failed: {message}")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"Oken API {path} returned an invalid data object")
    return data


def fetch_models(session: requests.Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    expected_total: int | None = None
    page = 1
    while True:
        data = _request_data(
            session,
            "/models",
            {"page": page, "page_size": PAGE_SIZE},
        )
        batch = data.get("list", [])
        if not isinstance(batch, list):
            raise RuntimeError("Oken models response does not contain a list")
        try:
            page_total = int(data["total"])
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError("Oken models response has no valid total") from error
        if page_total < 0:
            raise RuntimeError("Oken models response has a negative total")
        if expected_total is None:
            expected_total = page_total
        elif page_total != expected_total:
            raise RuntimeError(
                f"Oken model total changed during pagination: "
                f"{expected_total} -> {page_total}"
            )

        if not batch:
            if len(rows) != expected_total:
                raise RuntimeError(
                    f"Oken model pagination stopped at {len(rows)}/{expected_total}"
                )
            break
        rows.extend(batch)
        if len(rows) > expected_total:
            raise RuntimeError(
                f"Oken model pagination returned {len(rows)} rows for total "
                f"{expected_total}"
            )
        if len(rows) == expected_total:
            break
        page += 1

    model_ids = [row.get("id") for row in rows]
    if any(model_id is None for model_id in model_ids):
        raise RuntimeError("Oken model catalog contains a row without an id")
    if len({str(model_id) for model_id in model_ids}) != len(model_ids):
        raise RuntimeError("Oken model pagination returned duplicate ids")
    return rows


def fetch_supplier_directory(session: requests.Session) -> list[dict[str, Any]]:
    """Optional URL enrichment; quote identity never depends on this endpoint."""
    rows = _request_data(session, "/detection/suppliers").get("list", [])
    return rows if isinstance(rows, list) else []


def fetch_model_suppliers(
    session: requests.Session, model: dict[str, Any]
) -> list[dict[str, Any]]:
    model_id = model.get("id")
    pricing_method = model.get("pricing_method")
    if model_id is None or pricing_method is None:
        raise RuntimeError(f"Model is missing id/pricing_method: {model}")

    rows: list[dict[str, Any]] = []
    expected_total: int | None = None
    page = 1
    while True:
        data = _request_data(
            session,
            "/suppliers",
            {
                "sku_id": model_id,
                "pricing_method": pricing_method,
                "page": page,
                "page_size": PAGE_SIZE,
            },
        )
        batch = data.get("list", [])
        if not isinstance(batch, list):
            raise RuntimeError(
                f"Invalid supplier list for model {model.get('sku_name')}"
            )
        try:
            page_total = int(data["total"])
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError(
                f"Invalid supplier total for model {model.get('sku_name')}"
            ) from error
        if page_total < 0:
            raise RuntimeError(
                f"Negative supplier total for model {model.get('sku_name')}"
            )
        if expected_total is None:
            expected_total = page_total
        elif page_total != expected_total:
            raise RuntimeError(
                f"Supplier total changed during pagination for "
                f"{model.get('sku_name')}: {expected_total} -> {page_total}"
            )

        if not batch:
            if len(rows) != expected_total:
                raise RuntimeError(
                    f"Supplier pagination stopped at {len(rows)}/{expected_total} "
                    f"for model {model.get('sku_name')}"
                )
            return rows
        rows.extend(batch)
        if len(rows) > expected_total:
            raise RuntimeError(
                f"Supplier pagination returned {len(rows)} rows for total "
                f"{expected_total} on model {model.get('sku_name')}"
            )
        if len(rows) == expected_total:
            return rows
        page += 1


def _display_name(slug: str) -> str:
    def format_token(token: str) -> str:
        if token in DISPLAY_TOKENS:
            return DISPLAY_TOKENS[token]
        if re.fullmatch(r"[a-z]\d+(?:\.\d+)?", token):
            return token.upper()
        return token.capitalize()

    return " ".join(format_token(token) for token in slug.split("-"))


def _model_slug(value: Any) -> str:
    """Convert an upstream SKU key into one deterministic URL-safe segment."""
    text = str(value or "").strip().lower()
    slug = re.sub(r"[^a-z0-9.]+", "-", text)
    return re.sub(r"-{2,}", "-", slug).strip(".-")


def normalize_models(
    raw_models: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    publishable_rows = []
    models = []
    excluded = []
    for raw in raw_models:
        source_slug = str(raw.get("sku_name") or "").strip().lower()
        slug = _model_slug(source_slug)
        if not slug:
            excluded.append({"id": raw.get("id"), "slug": None, "reason": "missing sku_name"})
            continue
        company_name = str(raw.get("company") or "").strip()
        company_slug = company_key(company_name)
        if not company_slug:
            excluded.append({"id": raw.get("id"), "slug": slug, "reason": "missing company"})
            continue
        company = COMPANIES.get(
            company_slug,
            {
                "slug": company_slug,
                "name": company_name,
                "name_zh": company_name,
                "logo_color": "#94a3b8",
            },
        )
        official = raw.get("official_price_info") or {}
        pricing = PRICING_METHODS.get(raw.get("pricing_method"))
        if pricing is None:
            excluded.append({
                "id": raw.get("id"),
                "slug": slug,
                "reason": f"unsupported pricing_method {raw.get('pricing_method')!r}",
            })
            continue
        if not isinstance(official, dict):
            excluded.append({"id": raw.get("id"), "slug": slug, "reason": "invalid official_price_info"})
            continue
        official_source_raw = str(official.get("source") or "").strip()
        if not official_source_raw:
            excluded.append({
                "id": raw.get("id"),
                "slug": slug,
                "reason": "missing official price source",
            })
            continue
        source_company = COMPANIES.get(company_key(official_source_raw))
        official_source = (
            source_company["name_zh"] or source_company["name"]
            if source_company
            else official_source_raw
        )
        pricing_method, _ = pricing
        official_input = _number(official.get("input_price"))
        official_output = _number(official.get("output_price"))
        if pricing_method == "per_token":
            if official_input is None or official_output is None:
                excluded.append({
                    "id": raw.get("id"),
                    "slug": slug,
                    "reason": "incomplete official token price",
                })
                continue
        else:
            unit_price = official_input if official_input is not None else official_output
            if unit_price is None:
                excluded.append({
                    "id": raw.get("id"),
                    "slug": slug,
                    "reason": "missing official unit price",
                })
                continue
            official_input = unit_price
            official_output = 0
        if official_input + official_output <= 0:
            excluded.append({
                "id": raw.get("id"),
                "slug": slug,
                "reason": "official price is zero",
            })
            continue
        publish_date_text = str(raw.get("publish_at") or "").strip().split("T", 1)[0]
        publish_date = publish_date_text or None
        canonical_id = f"{company_slug}-{slug}"
        tags = raw.get("sku_tags")
        models.append(
            {
                "slug": slug,
                "display_name": _display_name(slug),
                "canonical_id": canonical_id,
                "company": {
                    "slug": company["slug"],
                    "name": company["name"],
                    "name_zh": company["name_zh"],
                    "logo_color": company["logo_color"],
                },
                "series": guess_series(canonical_id),
                "capabilities": list(dict.fromkeys(tags)) if isinstance(tags, list) else [],
                "pricing_method": pricing_method,
                # Oken currently has no normalized context-window field.
                "context_window": None,
                # official_price_info is already CNY-normalized by Oken.
                "official_input_price": official_input,
                "official_output_price": official_output,
                "official_currency": "CNY",
                "official_price_source": official_source,
                "publish_date": publish_date,
                "description": str(raw.get("model_desc") or "").strip(),
                "supplier_count": 0,
                "has_online_supplier": False,
            }
        )
        publishable_rows.append(raw)

    model_slugs = [model["slug"] for model in models]
    if len(set(model_slugs)) != len(model_slugs):
        duplicates = sorted(
            slug for slug, count in Counter(model_slugs).items() if count > 1
        )
        raise RuntimeError(f"URL slug collision after normalization: {duplicates}")
    canonical_ids = [model["canonical_id"] for model in models]
    if len(set(canonical_ids)) != len(canonical_ids):
        duplicates = sorted(
            value for value, count in Counter(canonical_ids).items() if count > 1
        )
        raise RuntimeError(f"Canonical model id collision: {duplicates}")
    return publishable_rows, models, excluded


def normalize_catalog(
    raw_models: list[dict[str, Any]],
    models: list[dict[str, Any]],
    rows_by_model_id: dict[int, list[dict[str, Any]]],
    supplier_directory: list[dict[str, Any]],
    fetched_at: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    directory_urls = _directory_urls(supplier_directory)
    suppliers_acc: dict[str, dict[str, Any]] = {}
    prices: list[dict[str, Any]] = []
    stability: list[dict[str, Any]] = []
    model_order = {model["canonical_id"]: index for index, model in enumerate(models)}

    official_source_candidates: dict[str, set[str]] = defaultdict(set)
    for raw, model in zip(raw_models, models, strict=True):
        source_name = model["official_price_source"]
        source_key = _normalize_name(source_name)
        for row in rows_by_model_id.get(int(raw["id"]), []):
            if not (
                _is_official(row)
                and _official_source_matches(row, source_name)
                and _quote_matches_official(row, model)
            ):
                continue
            stable_slug = _stable_supplier_slug(row)
            if stable_slug:
                official_source_candidates[source_key].add(stable_slug)
    official_source_slugs = {
        source_key: (
            next(iter(candidates))
            if len(candidates) == 1
            else _official_source_slug(source_key)
        )
        for source_key, candidates in official_source_candidates.items()
    }

    for raw, model in zip(raw_models, models, strict=True):
        upstream_id = int(raw["id"])
        canonical_id = model["canonical_id"]
        company_slug = model["company"]["slug"]
        pricing_method, unit = PRICING_METHODS.get(
            raw.get("pricing_method"), ("per_token", "token")
        )

        official_rows = []
        selected: dict[tuple[str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
        for row in rows_by_model_id.get(upstream_id, []):
            if _is_official(row):
                official_rows.append(row)
                continue
            quote = _route_quote(row, pricing_method)
            if quote is None:
                continue
            key = (_supplier_slug(row), _route(row))
            current = selected.get(key)
            rank = (_quote_total(quote, pricing_method), str(row.get("id") or ""))
            if current is None or rank < (
                _quote_total(current[1], pricing_method),
                str(current[0].get("id") or ""),
            ):
                selected[key] = (row, quote)

        official_source_name = model["official_price_source"]
        official_source_key = _normalize_name(official_source_name)
        matching_official_rows = [
            row for row in official_rows
            if _official_source_matches(row, official_source_name)
            and _quote_matches_official(row, model)
        ]
        if official_rows and not matching_official_rows:
            mismatched_ids = [str(row.get("id") or "unknown") for row in official_rows]
            raise RuntimeError(
                "No Oken official benchmark row exactly matches "
                f"official_price_info for {canonical_id}: {mismatched_ids}"
            )
        matching_supplier_slugs = {
            slug
            for row in matching_official_rows
            if (slug := _stable_supplier_slug(row)) is not None
        }
        if len(matching_supplier_slugs) > 1:
            raise RuntimeError(
                "Oken official benchmark rows disagree on supplier identity for "
                f"{canonical_id}: {sorted(matching_supplier_slugs)}"
            )
        official_row = None
        if matching_official_rows:
            official_row = max(
                matching_official_rows,
                key=lambda row: (
                    _normalize_datetime(row.get("response_at")) or "",
                    str(row.get("id") or ""),
                ),
            )
        official_supplier_slug = official_source_slugs.get(
            official_source_key,
            _official_source_slug(official_source_key),
        )
        prices.append(
            {
                "canonical_id": canonical_id,
                "supplier_slug": official_supplier_slug,
                "supplier_name": official_source_name,
                "supplier_type": "official",
                "route": "官方参考价",
                "unit": unit,
                "currency": "CNY",
                "input_price": model["official_input_price"],
                "output_price": model["official_output_price"],
                "cache_read_price": None,
                "is_active": True,
                "fetched_at": fetched_at,
            }
        )
        official_supplier = _supplier_accumulator(
            suppliers_acc, official_supplier_slug, official_source_name
        )
        official_supplier["models"].add(canonical_id)

        if official_row:
            _merge_supplier_facts(official_supplier, official_row, directory_urls)
            record = _stability_record(
                official_row,
                model,
                official_supplier_slug,
                "官方参考价",
                supplier_name=official_source_name,
            )
            if record:
                stability.append(record)
                official_supplier["stability"].append(record)

        for (supplier_slug, route), (row, quote) in sorted(selected.items()):
            supplier_name = _supplier_name(row)
            prices.append(
                {
                    "canonical_id": canonical_id,
                    "supplier_slug": supplier_slug,
                    "supplier_name": supplier_name,
                    "supplier_type": _normalized_supplier_type(row),
                    "route": route,
                    "unit": unit,
                    "currency": "CNY",
                    "input_price": quote["input_price"],
                    "output_price": quote["output_price"],
                    "cache_read_price": quote["cache_read_price"],
                    "is_active": True,
                    "fetched_at": fetched_at,
                }
            )
            supplier = _supplier_accumulator(
                suppliers_acc, supplier_slug, supplier_name
            )
            supplier["models"].add(canonical_id)
            _merge_supplier_facts(supplier, row, directory_urls)
            record = _stability_record(
                row, model, supplier_slug, route
            )
            if record:
                stability.append(record)
                supplier["stability"].append(record)

    active_by_model: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for price in prices:
        if price["is_active"]:
            active_by_model[price["canonical_id"]].append(price)
    for model in models:
        active = active_by_model[model["canonical_id"]]
        model["supplier_count"] = len({item["supplier_slug"] for item in active})
        model["has_online_supplier"] = any(
            item["supplier_type"] != "official" for item in active
        )

    supplier_rows = [
        _finalize_supplier(slug, value) for slug, value in suppliers_acc.items()
    ]
    supplier_rows.sort(key=lambda item: (item["name"].casefold(), item["slug"]))
    prices.sort(
        key=lambda item: (
            model_order[item["canonical_id"]],
            item["supplier_type"] != "official",
            item["supplier_slug"],
            item["route"],
        )
    )
    stability.sort(
        key=lambda item: (
            item["canonical_id"], item["supplier_slug"], item["route"]
        )
    )
    return prices, supplier_rows, stability


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return round(parsed, 6)


def _minimum(values: Any) -> float | None:
    if not isinstance(values, list):
        return None
    parsed = [_number(value) for value in values]
    valid = [value for value in parsed if value is not None]
    return min(valid) if valid else None


def _route_quote(row: dict[str, Any], pricing_method: str) -> dict[str, Any] | None:
    if pricing_method == "per_token":
        input_price = _minimum(row.get("min_input_price"))
        output_price = _minimum(row.get("min_output_price"))
        # A zero must be an upstream value, never a stand-in for an unknown
        # side of a token quote. Incomplete route rows are not published.
        if input_price is None or output_price is None:
            return None
        return {
            "input_price": input_price,
            "output_price": output_price,
            "cache_read_price": _minimum(row.get("min_cache_price")),
        }
    count_price = _minimum(row.get("min_count_price"))
    if count_price is None:
        count_price = _minimum(row.get("min_input_price"))
    if count_price is None:
        return None
    return {
        "input_price": count_price,
        "output_price": 0,
        "cache_read_price": None,
    }


def _quote_total(quote: dict[str, Any], pricing_method: str) -> float:
    if pricing_method == "per_token":
        return quote["input_price"] + quote["output_price"]
    return quote["input_price"] or quote["output_price"]


def _quote_matches_official(row: dict[str, Any], model: dict[str, Any]) -> bool:
    # Oken can label an official supplier row with a different pricing_method
    # while still returning the exact input/output arrays for the model (for
    # example gpt-image-2 is model method 1 but its official row says method 2).
    # The normalized quote shape and exact official prices are the reliable
    # contract here; the row-level method is only routing metadata.
    if model["pricing_method"] == "per_token":
        input_price = _minimum(row.get("min_input_price"))
        output_price = _minimum(row.get("min_output_price"))
        # Only official_price_info may prove that an omitted side is exactly
        # zero. Ordinary route quotes still reject incomplete token pricing.
        if input_price is None and model["official_input_price"] == 0:
            input_price = 0
        if output_price is None and model["official_output_price"] == 0:
            output_price = 0
        if input_price is None or output_price is None:
            return False
        quote = {"input_price": input_price, "output_price": output_price}
    else:
        quote = _route_quote(row, model["pricing_method"])
        if quote is None:
            return False
    return (
        abs(quote["input_price"] - model["official_input_price"]) <= 1e-6
        and abs(quote["output_price"] - model["official_output_price"]) <= 1e-6
    )


def _is_official(row: dict[str, Any]) -> bool:
    value = row.get("is_official")
    if value is True or value == 1:
        return True
    return isinstance(value, str) and value.strip().casefold() in {"1", "true"}


def _normalized_supplier_type(row: dict[str, Any]) -> str:
    raw_type = row.get("supplier_type")
    try:
        type_code = int(raw_type)
    except (TypeError, ValueError):
        type_code = None
    by_code = {
        0: "direct",
        2: "cloud",
        3: "aggregator",
        4: "relay",
    }
    if type_code in by_code:
        return by_code[type_code]

    type_text = _normalize_name(row.get("supplier_type_text"))
    if "模型官网" in type_text or "官方" in type_text:
        return "direct"
    if "云服务" in type_text:
        return "cloud"
    if "聚合" in type_text:
        return "aggregator"
    if "中转" in type_text:
        return "relay"
    return "other"


def _supplier_name(row: dict[str, Any]) -> str:
    return str(
        row.get("manufacturer_name")
        or row.get("shop_name")
        or row.get("supplier_type_text")
        or "未知供应商"
    ).strip()


def _supplier_slug(row: dict[str, Any]) -> str:
    stable_id = row.get("shop_id") or row.get("manufacturer_id")
    if stable_id not in (None, ""):
        return f"supplier-{stable_id}"
    digest = hashlib.sha256(_supplier_name(row).casefold().encode("utf-8")).hexdigest()
    return f"supplier-{digest[:12]}"


def _stable_supplier_slug(row: dict[str, Any]) -> str | None:
    stable_id = row.get("shop_id") or row.get("manufacturer_id")
    return f"supplier-{stable_id}" if stable_id not in (None, "") else None


def _official_source_slug(source_name: str) -> str:
    digest = hashlib.sha256(_normalize_name(source_name).encode("utf-8")).hexdigest()
    return f"official-source-{digest[:12]}"


def _official_source_matches(row: dict[str, Any], source_name: str) -> bool:
    expected = _normalize_name(source_name)
    return expected in {
        _normalize_name(row.get("shop_name")),
        _normalize_name(row.get("manufacturer_name")),
    }


def _route(row: dict[str, Any]) -> str:
    name = str(row.get("group_name") or "default").strip() or "default"
    group_id = row.get("group_id")
    return f"{name} · #{group_id}" if group_id not in (None, "") else name


def _normalize_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def _valid_url(value: Any) -> str | None:
    text = str(value or "").strip()
    parsed = urlparse(text)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return text.rstrip("/")
    return None


def _directory_urls(rows: list[dict[str, Any]]) -> dict[str, str | None]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        name = _normalize_name(row.get("shop_name"))
        url = _valid_url(row.get("base_url"))
        if name and url:
            grouped[name].add(url)
    # Ambiguous names remain unknown rather than choosing an arbitrary endpoint.
    return {
        name: next(iter(urls)) if len(urls) == 1 else None
        for name, urls in grouped.items()
    }


def _normalize_datetime(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        # Oken response_at is an offset-less Asia/Shanghai timestamp.
        parsed = parsed.replace(tzinfo=dt.timezone(dt.timedelta(hours=8)))
    return parsed.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sample_count(response_text: Any) -> int | None:
    match = re.search(r"(?:共)?监控\s*([\d,]+)\s*次", str(response_text or ""))
    return int(match.group(1).replace(",", "")) if match else None


def _status(uptime: float) -> str:
    if uptime <= 0:
        return "offline"
    return "online" if uptime >= 95 else "degraded"


def _stability_record(
    row: dict[str, Any],
    model: dict[str, Any],
    supplier_slug: str,
    route: str,
    supplier_name: str | None = None,
) -> dict[str, Any] | None:
    uptime = _number(row.get("stability"))
    latency = _number(row.get("response_time"))
    checked_at = _normalize_datetime(row.get("response_at"))
    response_text = str(row.get("response_text") or "").strip()
    samples = _sample_count(response_text)
    if uptime is None or latency is None or checked_at is None or samples is None:
        return None
    return {
        "supplier_slug": supplier_slug,
        "supplier_name": supplier_name or (
            model["company"]["name_zh"]
            if supplier_slug == model["company"]["slug"]
            else _supplier_name(row)
        ),
        "canonical_id": model["canonical_id"],
        "model_slug": model["slug"],
        "route": route,
        "uptime_7d": uptime,
        "avg_latency_ms": latency,
        "samples_7d": samples,
        "last_checked_at": checked_at,
        "status": _status(uptime),
        "last_response_time_ms": latency,
        "last_http_status": None,
        "last_error": None,
        "response_text": response_text,
    }


def _supplier_accumulator(
    suppliers: dict[str, dict[str, Any]], slug: str, name: str
) -> dict[str, Any]:
    if slug not in suppliers:
        suppliers[slug] = {
            "names": Counter(),
            "urls": set(),
            "payment_methods": set(),
            "invoice_values": set(),
            "models": set(),
            "stability": [],
        }
    suppliers[slug]["names"][name] += 1
    return suppliers[slug]


def _merge_supplier_facts(
    supplier: dict[str, Any],
    row: dict[str, Any],
    directory_urls: dict[str, str | None],
) -> None:
    for raw_name in (row.get("shop_name"), row.get("manufacturer_name")):
        url = directory_urls.get(_normalize_name(raw_name))
        if url:
            supplier["urls"].add(url)
    pay_type = str(row.get("pay_type") or "").strip()
    details = row.get("manufacturer_desc") or {}
    payment_method = str(details.get("payment_method") or "").strip()
    if pay_type:
        supplier["payment_methods"].add(pay_type)
    if payment_method:
        supplier["payment_methods"].add(payment_method)
    invoice = str(details.get("support_invoice") or "").strip()
    if invoice in {"是", "否"}:
        supplier["invoice_values"].add(invoice)


def _finalize_supplier(slug: str, supplier: dict[str, Any]) -> dict[str, Any]:
    names: Counter = supplier["names"]
    name = sorted(names, key=lambda value: (-names[value], value.casefold()))[0]
    records = supplier["stability"]
    uptimes = [record["uptime_7d"] for record in records]
    latencies = [record["avg_latency_ms"] for record in records]
    uptime = round(sum(uptimes) / len(uptimes), 2) if uptimes else None
    latency = round(sum(latencies) / len(latencies)) if latencies else None
    invoice_values = supplier["invoice_values"]
    has_invoice = (
        True if "是" in invoice_values else False if invoice_values == {"否"} else None
    )
    model_count = len(supplier["models"])
    return {
        "slug": slug,
        "name": name,
        "description": "",
        "payment_methods": sorted(supplier["payment_methods"]),
        "has_invoice": has_invoice,
        "status": _status(uptime) if uptime is not None else "unknown",
        "uptime_7d": uptime,
        "avg_latency_ms": latency,
        "last_checked_at": max(
            (record["last_checked_at"] for record in records), default=None
        ),
        "available_models": model_count,
        "total_models": model_count,
    }
