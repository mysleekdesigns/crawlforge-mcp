#!/usr/bin/env python3
"""
Validate Zod schemas against MCP specification.

Parses server.js to extract tool schemas and validates they conform to MCP requirements.
Usage: python3 validate-schema.py [--tool TOOL_NAME] [--verbose]
"""

import argparse
import json
import re
import sys
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent.parent.parent


def extract_tool_schemas(server_content: str) -> dict:
    """Extract tool schemas from server.js content."""
    tools = {}

    # Pattern to match server.registerTool calls
    # This is a simplified extraction - real parsing would need AST
    register_pattern = r'server\.registerTool\(\s*["\'](\w+)["\']\s*,\s*\{([^}]+description[^}]+)\}'

    matches = re.finditer(register_pattern, server_content, re.DOTALL)

    for match in matches:
        tool_name = match.group(1)
        tool_config = match.group(2)

        # Extract description
        desc_match = re.search(r'description:\s*["\']([^"\']+)["\']', tool_config)
        description = desc_match.group(1) if desc_match else "No description"

        tools[tool_name] = {
            "name": tool_name,
            "description": description,
            "has_schema": "inputSchema" in tool_config or "z." in tool_config,
        }

    return tools


def validate_tool_schema(tool_name: str, tool_info: dict) -> list[str]:
    """Validate a single tool schema against MCP requirements."""
    issues = []

    # MCP requires description
    if not tool_info.get("description") or tool_info["description"] == "No description":
        issues.append(f"Missing or empty description")

    # MCP requires input schema
    if not tool_info.get("has_schema"):
        issues.append(f"Missing inputSchema (Zod validation)")

    # Description should be meaningful (at least 10 chars)
    if len(tool_info.get("description", "")) < 10:
        issues.append(f"Description too short (should be descriptive)")

    return issues


def validate_all_schemas(verbose: bool = False) -> dict:
    """Validate all tool schemas in server.js."""
    project_root = get_project_root()
    server_path = project_root / "server.js"

    if not server_path.exists():
        return {
            "status": "error",
            "message": "server.js not found"
        }

    with open(server_path, 'r') as f:
        content = f.read()

    tools = extract_tool_schemas(content)

    results = {
        "status": "pending",
        "total_tools": len(tools),
        "valid": 0,
        "invalid": 0,
        "tools": {},
        "issues": []
    }

    # Expected tools (19 total)
    expected_tools = [
        "fetch_url", "extract_text", "extract_links", "extract_metadata",
        "scrape_structured", "search_web", "crawl_deep", "map_site",
        "extract_content", "process_document", "summarize_content", "analyze_content",
        "batch_scrape", "scrape_with_actions", "deep_research",
        "track_changes", "generate_llms_txt", "stealth_mode", "localization"
    ]

    # Check for missing tools
    found_tools = set(tools.keys())
    expected_set = set(expected_tools)

    missing = expected_set - found_tools
    if missing:
        results["issues"].append(f"Missing tools: {', '.join(sorted(missing))}")

    extra = found_tools - expected_set
    if extra and verbose:
        results["issues"].append(f"Extra tools found: {', '.join(sorted(extra))}")

    # Validate each tool
    for tool_name, tool_info in tools.items():
        issues = validate_tool_schema(tool_name, tool_info)

        if issues:
            results["invalid"] += 1
            results["tools"][tool_name] = {
                "valid": False,
                "issues": issues
            }
        else:
            results["valid"] += 1
            results["tools"][tool_name] = {
                "valid": True
            }

    # Determine overall status
    if results["invalid"] == 0 and not missing:
        results["status"] = "pass"
    elif results["invalid"] > 0 or missing:
        results["status"] = "fail"

    return results


def main():
    parser = argparse.ArgumentParser(description="Validate MCP tool schemas")
    parser.add_argument("--tool", "-t", help="Validate specific tool only")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    print("=== MCP Schema Validator ===")
    print("")

    results = validate_all_schemas(verbose=args.verbose)

    if results["status"] == "error":
        print(f"Error: {results['message']}")
        sys.exit(1)

    if args.tool:
        # Single tool validation
        if args.tool in results["tools"]:
            tool_result = results["tools"][args.tool]
            if tool_result["valid"]:
                print(f"Tool '{args.tool}': VALID")
            else:
                print(f"Tool '{args.tool}': INVALID")
                for issue in tool_result.get("issues", []):
                    print(f"  - {issue}")
            sys.exit(0 if tool_result["valid"] else 1)
        else:
            print(f"Tool '{args.tool}' not found")
            sys.exit(1)

    # Full validation report
    print(f"Total tools found: {results['total_tools']}")
    print(f"Valid: {results['valid']}")
    print(f"Invalid: {results['invalid']}")
    print("")

    if results["issues"]:
        print("Global Issues:")
        for issue in results["issues"]:
            print(f"  - {issue}")
        print("")

    if results["invalid"] > 0 or args.verbose:
        print("Tool Details:")
        for tool_name, tool_result in sorted(results["tools"].items()):
            status = "VALID" if tool_result["valid"] else "INVALID"
            print(f"  {tool_name}: {status}")
            if not tool_result["valid"]:
                for issue in tool_result.get("issues", []):
                    print(f"    - {issue}")

    print("")
    if results["status"] == "pass":
        print("Result: PASS - All schemas valid")
    else:
        print("Result: FAIL - Schema validation issues found")

    if args.json:
        print("")
        print(json.dumps(results, indent=2))

    sys.exit(0 if results["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
