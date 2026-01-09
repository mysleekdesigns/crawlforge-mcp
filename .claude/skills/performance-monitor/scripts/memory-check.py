#!/usr/bin/env python3
"""
Memory Usage Monitor for CrawlForge MCP Server

Monitors memory usage patterns and detects potential memory leaks.
Usage: python3 memory-check.py [--duration SECONDS] [--threshold MB]
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent.parent.parent


def get_node_memory(pid: int) -> dict:
    """Get memory usage of a Node.js process."""
    try:
        # Use ps to get memory info
        result = subprocess.run(
            ["ps", "-o", "rss=,vsz=", "-p", str(pid)],
            capture_output=True,
            text=True
        )

        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split()
            if len(parts) >= 2:
                return {
                    "rss_kb": int(parts[0]),
                    "vsz_kb": int(parts[1]),
                    "rss_mb": round(int(parts[0]) / 1024, 2),
                    "vsz_mb": round(int(parts[1]) / 1024, 2),
                }
    except Exception:
        pass

    return {"rss_kb": 0, "vsz_kb": 0, "rss_mb": 0, "vsz_mb": 0}


def start_server() -> subprocess.Popen:
    """Start the MCP server process."""
    project_root = get_project_root()
    server_path = project_root / "server.js"

    if not server_path.exists():
        raise FileNotFoundError("server.js not found")

    process = subprocess.Popen(
        ["node", str(server_path)],
        cwd=str(project_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "NODE_ENV": "test"}
    )

    # Wait for server to start
    time.sleep(2)

    if process.poll() is not None:
        raise RuntimeError("Server failed to start")

    return process


def monitor_memory(duration: int, threshold_mb: int, verbose: bool = False) -> dict:
    """Monitor memory usage over time."""
    results = {
        "status": "pending",
        "duration_seconds": duration,
        "threshold_mb": threshold_mb,
        "samples": [],
        "analysis": {},
        "warnings": []
    }

    print(f"Starting server for memory monitoring...")

    try:
        server = start_server()
        pid = server.pid
        print(f"  Server started (PID: {pid})")
        print("")

        start_time = time.time()
        sample_interval = max(1, duration // 20)  # ~20 samples

        print(f"Monitoring for {duration} seconds...")
        print("")

        while time.time() - start_time < duration:
            memory = get_node_memory(pid)

            if memory["rss_mb"] > 0:
                sample = {
                    "timestamp": round(time.time() - start_time, 1),
                    "rss_mb": memory["rss_mb"],
                    "vsz_mb": memory["vsz_mb"]
                }
                results["samples"].append(sample)

                if verbose:
                    print(f"  {sample['timestamp']}s: RSS={memory['rss_mb']}MB, VSZ={memory['vsz_mb']}MB")

            time.sleep(sample_interval)

        # Stop server
        server.terminate()
        server.wait(timeout=5)

    except FileNotFoundError as e:
        results["status"] = "error"
        results["error"] = str(e)
        return results
    except Exception as e:
        results["status"] = "error"
        results["error"] = str(e)
        return results

    # Analyze results
    if results["samples"]:
        rss_values = [s["rss_mb"] for s in results["samples"]]

        results["analysis"] = {
            "initial_mb": rss_values[0],
            "final_mb": rss_values[-1],
            "min_mb": min(rss_values),
            "max_mb": max(rss_values),
            "avg_mb": round(sum(rss_values) / len(rss_values), 2),
            "growth_mb": round(rss_values[-1] - rss_values[0], 2),
            "sample_count": len(rss_values)
        }

        # Check for issues
        if results["analysis"]["max_mb"] > threshold_mb:
            results["warnings"].append(f"Memory exceeded threshold ({results['analysis']['max_mb']}MB > {threshold_mb}MB)")

        if results["analysis"]["growth_mb"] > 50:
            results["warnings"].append(f"Significant memory growth detected ({results['analysis']['growth_mb']}MB)")

        # Determine status
        if results["warnings"]:
            results["status"] = "warning"
        else:
            results["status"] = "pass"
    else:
        results["status"] = "error"
        results["error"] = "No samples collected"

    return results


def main():
    parser = argparse.ArgumentParser(description="Monitor CrawlForge MCP Server memory usage")
    parser.add_argument("--duration", "-d", type=int, default=30, help="Monitoring duration in seconds")
    parser.add_argument("--threshold", "-t", type=int, default=512, help="Memory threshold in MB")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    print("=== CrawlForge Memory Monitor ===")
    print(f"Duration: {args.duration}s")
    print(f"Threshold: {args.threshold}MB")
    print("")

    results = monitor_memory(args.duration, args.threshold, args.verbose)

    if results["status"] == "error":
        print(f"Error: {results.get('error', 'Unknown error')}")
        sys.exit(1)

    print("")
    print("=== Memory Analysis ===")
    if "analysis" in results:
        analysis = results["analysis"]
        print(f"  Initial: {analysis['initial_mb']}MB")
        print(f"  Final: {analysis['final_mb']}MB")
        print(f"  Min: {analysis['min_mb']}MB")
        print(f"  Max: {analysis['max_mb']}MB")
        print(f"  Average: {analysis['avg_mb']}MB")
        print(f"  Growth: {analysis['growth_mb']}MB")
        print(f"  Samples: {analysis['sample_count']}")

    if results["warnings"]:
        print("")
        print("=== Warnings ===")
        for warning in results["warnings"]:
            print(f"  - {warning}")

    print("")
    if results["status"] == "pass":
        print("Result: PASS - Memory usage within acceptable limits")
    elif results["status"] == "warning":
        print("Result: WARNING - Memory usage concerns detected")
    else:
        print("Result: FAIL - Memory monitoring failed")

    if args.json:
        print("")
        print(json.dumps(results, indent=2))

    sys.exit(0 if results["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
