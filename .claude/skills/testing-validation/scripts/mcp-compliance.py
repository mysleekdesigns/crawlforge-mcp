#!/usr/bin/env python3
"""
MCP Protocol Compliance Checker

Validates that the CrawlForge MCP Server follows MCP protocol specifications.
Usage: python3 mcp-compliance.py [--verbose] [--json]
"""

import argparse
import json
import re
import sys
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent.parent.parent


def check_sdk_usage(content: str) -> dict:
    """Check for proper MCP SDK usage."""
    checks = {
        "imports_sdk": False,
        "uses_server_class": False,
        "uses_stdio_transport": False,
    }

    if "@modelcontextprotocol/sdk" in content:
        checks["imports_sdk"] = True

    if "McpServer" in content or "Server" in content:
        checks["uses_server_class"] = True

    if "StdioServerTransport" in content:
        checks["uses_stdio_transport"] = True

    return checks


def check_tool_registration(content: str) -> dict:
    """Check tool registration patterns."""
    checks = {
        "uses_register_tool": False,
        "has_descriptions": False,
        "has_input_schemas": False,
        "tool_count": 0,
    }

    if "registerTool" in content or "server.tool" in content:
        checks["uses_register_tool"] = True

    # Count tool registrations
    tool_pattern = r'registerTool\s*\(\s*["\'](\w+)["\']'
    tools = re.findall(tool_pattern, content)
    checks["tool_count"] = len(tools)

    # Check for descriptions
    desc_pattern = r'description:\s*["\'][^"\']+["\']'
    if re.search(desc_pattern, content):
        checks["has_descriptions"] = True

    # Check for input schemas (Zod)
    if "z." in content or "inputSchema" in content:
        checks["has_input_schemas"] = True

    return checks


def check_response_format(content: str) -> dict:
    """Check response format compliance."""
    checks = {
        "uses_content_array": False,
        "uses_text_type": False,
        "has_error_handling": False,
    }

    # Check for content array format
    if '"content"' in content and '"type"' in content:
        checks["uses_content_array"] = True

    if '"text"' in content:
        checks["uses_text_type"] = True

    if "isError" in content or "catch" in content:
        checks["has_error_handling"] = True

    return checks


def check_lifecycle(content: str) -> dict:
    """Check server lifecycle management."""
    checks = {
        "has_graceful_shutdown": False,
        "handles_sigint": False,
        "handles_sigterm": False,
        "cleans_up_resources": False,
    }

    if "SIGINT" in content:
        checks["handles_sigint"] = True

    if "SIGTERM" in content:
        checks["handles_sigterm"] = True

    if "gracefulShutdown" in content or "cleanup" in content or "destroy" in content:
        checks["has_graceful_shutdown"] = True
        checks["cleans_up_resources"] = True

    return checks


def run_compliance_check(verbose: bool = False) -> dict:
    """Run full MCP compliance check."""
    project_root = get_project_root()
    server_path = project_root / "server.js"

    results = {
        "status": "pending",
        "score": 0,
        "max_score": 0,
        "checks": {},
        "issues": [],
        "recommendations": []
    }

    if not server_path.exists():
        results["status"] = "error"
        results["issues"].append("server.js not found")
        return results

    with open(server_path, 'r') as f:
        content = f.read()

    # Run all checks
    sdk_checks = check_sdk_usage(content)
    tool_checks = check_tool_registration(content)
    response_checks = check_response_format(content)
    lifecycle_checks = check_lifecycle(content)

    results["checks"] = {
        "sdk_usage": sdk_checks,
        "tool_registration": tool_checks,
        "response_format": response_checks,
        "lifecycle": lifecycle_checks
    }

    # Calculate score
    all_checks = []
    all_checks.extend(sdk_checks.values())
    all_checks.extend([v for k, v in tool_checks.items() if k != "tool_count"])
    all_checks.extend(response_checks.values())
    all_checks.extend(lifecycle_checks.values())

    bool_checks = [c for c in all_checks if isinstance(c, bool)]
    results["max_score"] = len(bool_checks)
    results["score"] = sum(1 for c in bool_checks if c)

    # Generate issues and recommendations
    if not sdk_checks["imports_sdk"]:
        results["issues"].append("Not using official MCP SDK")

    if not sdk_checks["uses_stdio_transport"]:
        results["issues"].append("Not using stdio transport")

    if tool_checks["tool_count"] < 19:
        results["recommendations"].append(f"Only {tool_checks['tool_count']} tools registered (expected 19)")

    if not lifecycle_checks["has_graceful_shutdown"]:
        results["issues"].append("Missing graceful shutdown handling")

    if not response_checks["uses_content_array"]:
        results["issues"].append("Response format may not be MCP compliant")

    # Determine status
    percentage = (results["score"] / results["max_score"] * 100) if results["max_score"] > 0 else 0
    results["percentage"] = round(percentage, 1)

    if percentage >= 90:
        results["status"] = "pass"
    elif percentage >= 70:
        results["status"] = "warning"
    else:
        results["status"] = "fail"

    return results


def main():
    parser = argparse.ArgumentParser(description="Check MCP protocol compliance")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    print("=== MCP Protocol Compliance Check ===")
    print("")

    results = run_compliance_check(verbose=args.verbose)

    if results["status"] == "error":
        print(f"Error: {results['issues'][0]}")
        sys.exit(1)

    print(f"Score: {results['score']}/{results['max_score']} ({results['percentage']}%)")
    print(f"Status: {results['status'].upper()}")
    print("")

    if args.verbose:
        print("=== Detailed Checks ===")
        for category, checks in results["checks"].items():
            print(f"\n{category}:")
            for check, value in checks.items():
                if isinstance(value, bool):
                    status = "PASS" if value else "FAIL"
                    print(f"  {check}: {status}")
                else:
                    print(f"  {check}: {value}")

    if results["issues"]:
        print("")
        print("=== Issues ===")
        for issue in results["issues"]:
            print(f"  - {issue}")

    if results["recommendations"]:
        print("")
        print("=== Recommendations ===")
        for rec in results["recommendations"]:
            print(f"  - {rec}")

    if args.json:
        print("")
        print("=== JSON Output ===")
        print(json.dumps(results, indent=2))

    sys.exit(0 if results["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
