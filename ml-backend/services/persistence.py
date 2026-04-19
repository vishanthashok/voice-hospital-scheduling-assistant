"""
Append-only JSONL logs + FHIR bundle file writes (local disk, hackathon / demo).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

_BASE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data"))
TRIAGE_HISTORY_PATH = os.path.join(_BASE, "triage_history.jsonl")
AUDIT_LOG_PATH = os.path.join(_BASE, "audit_log.jsonl")
AUDIT_JSON_SNAPSHOT_PATH = os.path.join(_BASE, "audit_log.json")
MAX_AUDIT_JSON_SNAPSHOT = 500
FHIR_LATEST_DIR = os.path.join(_BASE, "fhir_records", "latest")
FHIR_ARCHIVE_DIR = os.path.join(_BASE, "fhir_records", "archive")


def ensure_data_dirs() -> None:
    """Create data/, fhir_records/latest, fhir_records/archive."""
    os.makedirs(_BASE, exist_ok=True)
    os.makedirs(FHIR_LATEST_DIR, exist_ok=True)
    os.makedirs(FHIR_ARCHIVE_DIR, exist_ok=True)


def _append_jsonl(path: str, row: Dict[str, Any]) -> None:
    ensure_data_dirs()
    line = json.dumps(row, ensure_ascii=False, default=str) + "\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(line)


def append_triage_history(row: Dict[str, Any]) -> None:
    """One line per /predict/risk outcome."""
    _append_jsonl(TRIAGE_HISTORY_PATH, row)


def append_audit_event(row: Dict[str, Any]) -> None:
    """Hospital-style audit trail (JSONL + rolling JSON snapshot for quick inspection)."""
    _append_jsonl(AUDIT_LOG_PATH, row)
    _mirror_audit_json_snapshot(row)


def _mirror_audit_json_snapshot(row: Dict[str, Any]) -> None:
    ensure_data_dirs()
    path = AUDIT_JSON_SNAPSHOT_PATH
    existing: list = []
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = []
    if not isinstance(existing, list):
        existing = []
    existing.append(row)
    existing = existing[-MAX_AUDIT_JSON_SNAPSHOT:]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def save_fhir_bundle_file(
    patient_id: str,
    bundle: Dict[str, Any],
) -> Dict[str, str]:
    """
    Write latest bundle for patient + timestamped archive copy.
    Returns paths relative to ml-backend/data.
    """
    ensure_data_dirs()
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_pid = "".join(c if c.isalnum() or c in "-_" else "_" for c in patient_id)[:80]
    latest_path = os.path.join(FHIR_LATEST_DIR, f"{safe_pid}.json")
    arch_name = f"{safe_pid}_{ts}.json"
    archive_path = os.path.join(FHIR_ARCHIVE_DIR, arch_name)

    text = json.dumps(bundle, indent=2, ensure_ascii=False)
    with open(latest_path, "w", encoding="utf-8") as f:
        f.write(text)
    with open(archive_path, "w", encoding="utf-8") as f:
        f.write(text)

    rel_latest = os.path.relpath(latest_path, _BASE).replace("\\", "/")
    rel_arch = os.path.relpath(archive_path, _BASE).replace("\\", "/")
    return {"latest": rel_latest, "archive": rel_arch}


def read_latest_fhir_bundle(patient_id: str) -> Optional[Dict[str, Any]]:
    ensure_data_dirs()
    safe_pid = "".join(c if c.isalnum() or c in "-_" else "_" for c in patient_id)[:80]
    latest_path = os.path.join(FHIR_LATEST_DIR, f"{safe_pid}.json")
    if not os.path.isfile(latest_path):
        return None
    with open(latest_path, encoding="utf-8") as f:
        return json.load(f)
