#!/usr/bin/env python3
"""Fail-closed public deployment verifier for the multilingual catalog and M2M receipt.

The Modal secret is read only from ``MODAL_SHARED_SECRET`` and is never printed.
Run this only after Worker and Modal deployment; it does not create rooms or
send audio/video.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


FIXTURE_IDS = (
    "en-es-meeting-time", "es-en-meeting-time", "en-fr-signed-report",
    "en-de-station-river", "en-ja-room-time", "en-ar-room-time",
    "es-fr-report-meeting",
)


def fetch_json(url: str, *, secret: str | None = None,
               body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    request = urllib.request.Request(url, data=payload, headers=headers,
                                     method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(request, timeout=130) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("expected a JSON object")
    return data


def enabled_voice_ids(catalog: dict[str, Any]) -> list[str]:
    return sorted({voice["id"] for locale in catalog.get("locales", [])
                   for voice in locale.get("voice_profiles", [])})


def deployment_drift(worker: dict[str, Any], modal: dict[str, Any],
                     health: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if worker.get("revision") != modal.get("revision"):
        errors.append("catalog revision differs between Worker and Modal")
    worker_mt = worker.get("models", {}).get("mt", {}).get("revision")
    modal_mt = modal.get("models", {}).get("mt", {}).get("revision")
    if not worker_mt or worker_mt != modal_mt:
        errors.append("M2M model revision differs between Worker and Modal")
    if health.get("catalog_revision") != worker.get("revision"):
        errors.append("Modal health catalog revision differs from Worker")
    if health.get("mt_revision") != worker_mt:
        errors.append("Modal health M2M revision differs from Worker")
    if sorted(health.get("voice_profiles", [])) != enabled_voice_ids(worker):
        errors.append("Modal enabled voice profile set differs from Worker catalog")
    return errors


def verify_fixture_receipts(
    modal_base: str, secret: str, expected_mt_revision: str,
    *, request=fetch_json,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Run every fixed deployed-M2M receipt and fail closed on any weak result."""
    fixtures: list[dict[str, Any]] = []
    errors: list[str] = []
    for fixture_id in FIXTURE_IDS:
        try:
            receipt = request(f"{modal_base}/mt-receipt", secret=secret,
                              body={"fixture_id": fixture_id})
        except (OSError, urllib.error.HTTPError, json.JSONDecodeError, RuntimeError) as error:
            errors.append(f"fixture {fixture_id} request failed: {type(error).__name__}")
            continue
        matches = receipt.get("semantic_token_group_matches")
        model = receipt.get("model")
        matched = (isinstance(matches, list) and bool(matches)
                   and all(match is True for match in matches))
        fixture = {
            "id": fixture_id,
            "target": receipt.get("target_language"),
            "translation": receipt.get("translation"),
            "semantic_hints_matched": matched,
            "model": model,
        }
        fixtures.append(fixture)
        if receipt.get("fixture_id") != fixture_id:
            errors.append(f"fixture {fixture_id} returned a mismatched receipt id")
        if not isinstance(fixture["translation"], str) or not fixture["translation"].strip():
            errors.append(f"fixture {fixture_id} returned no translation")
        if (not isinstance(model, dict)
                or model.get("model") != "facebook/m2m100_418M"
                or model.get("revision") != expected_mt_revision):
            errors.append(f"fixture {fixture_id} model receipt differs from pinned M2M100")
        if not matched:
            errors.append(f"fixture {fixture_id} semantic hints did not match")
    return fixtures, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-url", required=True,
                        help="Worker origin, without /api/capabilities")
    parser.add_argument("--modal-url", required=True,
                        help="Modal HTTPS base URL, without endpoint suffix")
    args = parser.parse_args()
    secret = os.environ.get("MODAL_SHARED_SECRET")
    if not secret:
        print("MODAL_SHARED_SECRET must be set for the authenticated verification", file=sys.stderr)
        return 2

    worker_base = args.worker_url.rstrip("/")
    modal_base = args.modal_url.rstrip("/")
    try:
        worker = fetch_json(f"{worker_base}/api/capabilities")
        modal = fetch_json(f"{modal_base}/capabilities", secret=secret)
        health = fetch_json(f"{modal_base}/health", secret=secret)
    except (OSError, urllib.error.HTTPError, json.JSONDecodeError, RuntimeError) as error:
        print(f"deployment verification request failed: {type(error).__name__}", file=sys.stderr)
        return 2

    errors = deployment_drift(worker, modal, health)
    mt_revision = worker.get("models", {}).get("mt", {}).get("revision")
    result: dict[str, Any] = {
        "worker_catalog_revision": worker.get("revision"),
        "modal_catalog_revision": modal.get("revision"),
        "mt_revision": mt_revision,
        "voice_profiles": len(enabled_voice_ids(worker)),
        "drift_errors": errors,
    }
    if not errors:
        fixtures, fixture_errors = verify_fixture_receipts(
            modal_base, secret, str(mt_revision))
        result["fixtures"] = fixtures
        errors.extend(fixture_errors)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
