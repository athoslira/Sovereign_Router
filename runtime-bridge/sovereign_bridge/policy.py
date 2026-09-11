"""Deterministic, fail-closed policy for governed Hermes tool calls."""

from __future__ import annotations

from dataclasses import dataclass
import os
import re
from pathlib import Path, PurePosixPath
from typing import Any, Mapping


@dataclass(frozen=True)
class PolicyContext:
    allowed_roots: tuple[str, ...]
    planned_write_paths: tuple[str, ...]


@dataclass(frozen=True)
class ToolDecision:
    action: str
    reason: str
    rule_key: str


def _path(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip().replace("\\", "/")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    parts = PurePosixPath(candidate).parts
    if candidate.startswith("~") or ".." in parts:
        return None
    try:
        normalized = str(Path(candidate).resolve(strict=False))
    except (OSError, RuntimeError):
        return None
    return os.path.normcase(normalized.rstrip("/\\")).replace("\\", "/") or None


def _argument_path(args: Mapping[str, Any]) -> tuple[bool, str | None]:
    for key in ("path", "file_path", "filename", "output_path", "destination"):
        if key in args and isinstance(args[key], str):
            return True, _path(args[key])
    return False, None


def _inside(candidate: str, root: str) -> bool:
    normalized = _path(root)
    return bool(normalized and (candidate == normalized or candidate.startswith(normalized + "/")))


def decide_tool(tool_name: str, args: Mapping[str, Any] | None, context: PolicyContext) -> ToolDecision:
    tool = (tool_name or "unknown").strip().lower()
    values = args if isinstance(args, Mapping) else {}
    supplied, candidate = _argument_path(values)
    if supplied and candidate is None:
        return ToolDecision("deny", "The path is outside the approved workspace.", f"{tool}:unsafe-path")
    if candidate and not any(_inside(candidate, root) for root in context.allowed_roots):
        return ToolDecision("deny", "The path is outside the approved workspace.", f"{tool}:outside-root")
    command = values.get("command", "")
    if isinstance(command, str) and re.search(r"\b(?:rm\s+-rf|format|mkfs|diskpart|shutdown|reboot)\b", command, re.I):
        return ToolDecision("deny", "A destructive command was blocked by policy.", f"{tool}:destructive")
    if re.search(r"image_generate|video_generate|deploy|publish|send|upload|terminal|shell|exec|mcp|(?:get|read|fetch|open)_url|web_search", tool, re.I):
        return ToolDecision("ask", "This operation can create an external effect or incur cost.", f"{tool}:external-effect")
    if re.match(r"^(?:read|view|list|search|grep|glob|get)_", tool) or tool in {"read_file", "view_image"}:
        if candidate:
            return ToolDecision("allow", "Read-only access is inside the approved workspace.", f"{tool}:read")
        return ToolDecision("ask", "The read does not identify a path inside an approved workspace.", f"{tool}:unscoped-read")
    if re.match(r"^(?:write|patch|edit|create|append)_", tool) or tool in {"write_file", "patch"}:
        planned = {_path(path) for path in context.planned_write_paths}
        if candidate and candidate in planned:
            return ToolDecision("allow", "The write is part of the approved plan.", f"{tool}:planned-write")
        return ToolDecision("ask", "This write was not named in the approved plan.", f"{tool}:write")
    return ToolDecision("ask", "This tool is not covered by an automatic allow rule.", f"{tool}:unknown")
