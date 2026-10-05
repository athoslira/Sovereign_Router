"""Local, dependency-free baseline for Sovereign Hub persistence and loopback API latency."""

from __future__ import annotations

import json
from pathlib import Path
import statistics
import sys
import tempfile
import time
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sovereign_bridge.server import BridgeServer
from sovereign_bridge.store import RuntimeStore


def measure(samples: int, action) -> dict[str, float]:
    values: list[float] = []
    for _ in range(samples):
        started = time.perf_counter()
        action()
        values.append((time.perf_counter() - started) * 1_000)
    ordered = sorted(values)
    return {
        "samples": float(samples),
        "p50_ms": round(statistics.median(values), 3),
        "p95_ms": round(ordered[min(samples - 1, int(samples * 0.95))], 3),
        "max_ms": round(max(values), 3),
    }


def main() -> None:
    with tempfile.TemporaryDirectory() as folder:
        store = RuntimeStore(Path(folder) / "runtime.db")
        counter = 0

        def create_task() -> None:
            nonlocal counter
            counter += 1
            store.create_hub_task(f"Benchmark task {counter}", "analysis")

        task = store.create_hub_task("Benchmark governed run", "automation")
        store.transition_hub_task(task["id"], "planned")
        run = store.create_hub_run(task["id"], "hermes")
        server = store.register_hub_mcp_server("Benchmark MCP", "stdio", "benchmark.mcp", [{"name": "read_status", "description": "Read status", "input_schema": {"type": "object"}, "read_only": True, "external_effect": False}])
        session = store.create_hub_mcp_session(run["id"], server["id"], ["read_status"])
        loopback = BridgeServer(store, "benchmark-" + ("x" * 24), port=0)
        running = loopback.start()
        base = f"http://127.0.0.1:{running.server_address[1]}"
        headers = {"Authorization": "Bearer benchmark-" + ("x" * 24)}
        try:
            metrics = {
                "task_create": measure(100, create_task),
                "mcp_decision": measure(100, lambda: store.decide_hub_mcp_tool(session["id"], "read_status")),
                "loopback_health": measure(50, lambda: urlopen(Request(base + "/v1/hub/health", headers=headers), timeout=2).read()),
                "loopback_task_list": measure(50, lambda: urlopen(Request(base + "/v1/hub/tasks", headers=headers), timeout=2).read()),
            }
            print(json.dumps(metrics, indent=2))
        finally:
            loopback.stop()


if __name__ == "__main__":
    main()
