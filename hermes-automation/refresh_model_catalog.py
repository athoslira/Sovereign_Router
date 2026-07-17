#!/usr/bin/env python3
"""Fetch the public OpenRouter model catalog without printing credentials.

Run this from a Hermes scheduled task (or any scheduler) every 15 days. The
generated JSON is suitable for review or for serving behind an authenticated
internal endpoint; it never promotes a model into Sovereign auto-routing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MODELS_URL = "https://openrouter.ai/api/v1/models"


def number(value: object) -> float | None:
    return value if isinstance(value, (int, float)) else None


def normalize(payload: object) -> dict[str, object]:
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    models: list[dict[str, object]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            continue
        architecture = row.get("architecture") if isinstance(row.get("architecture"), dict) else {}
        pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
        supported = row.get("supported_parameters") if isinstance(row.get("supported_parameters"), list) else []
        models.append({
            "id": row["id"],
            "name": row.get("name") if isinstance(row.get("name"), str) else row["id"],
            "context_length": number(row.get("context_length")),
            "input_modalities": [item for item in architecture.get("input_modalities", []) if isinstance(item, str)],
            "output_modalities": [item for item in architecture.get("output_modalities", []) if isinstance(item, str)],
            "supports_tools": "tools" in supported,
            "pricing": {
                "input": number(pricing.get("prompt")),
                "output": number(pricing.get("completion")),
                "cache_read": number(pricing.get("input_cache_read")),
            },
        })
    return {
        "schema_version": 1,
        "fetched_at": int(time.time() * 1000),
        "source": "OpenRouter /api/v1/models",
        "models": sorted(models, key=lambda model: str(model["name"]).lower()),
        "policy": "Catalog discovery never auto-authorizes models. Sovereign Router settings remain the source of routing permission.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Sovereign Router's model intelligence catalog.")
    parser.add_argument("--output", required=True, type=Path, help="Destination JSON file")
    args = parser.parse_args()
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY is required.", file=sys.stderr)
        return 2
    request = Request(MODELS_URL, headers={"Authorization": f"Bearer {api_key}", "X-OpenRouter-Title": "Sovereign Router"})
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except HTTPError as error:
        print(f"OpenRouter catalog request failed ({error.code}).", file=sys.stderr)
        return 1
    except URLError:
        print("Could not reach OpenRouter to refresh the catalog.", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(normalize(payload), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Catalog refreshed: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
