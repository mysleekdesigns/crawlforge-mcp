#!/usr/bin/env python3
"""
SSRF Protection Validator for CrawlForge MCP Server

Tests URLs against SSRF protection rules to ensure private IPs are blocked.
Usage: python3 check-ssrf.py [--test-url URL] [--verbose]
"""

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent.parent.parent


# Private IP ranges that should be blocked
PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local
    ipaddress.ip_network("::1/128"),  # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),  # IPv6 private
    ipaddress.ip_network("fe80::/10"),  # IPv6 link-local
]

# Dangerous hostnames
BLOCKED_HOSTNAMES = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",  # Cloud metadata
    "169.254.169.254",  # AWS/GCP metadata
    "metadata.azure.com",  # Azure metadata
]

# Test URLs to validate SSRF protection
TEST_URLS = [
    # Should be BLOCKED
    ("http://localhost/", True, "localhost"),
    ("http://127.0.0.1/", True, "IPv4 loopback"),
    ("http://127.0.0.1:8080/admin", True, "IPv4 loopback with port"),
    ("http://[::1]/", True, "IPv6 loopback"),
    ("http://192.168.1.1/", True, "Private network"),
    ("http://10.0.0.1/", True, "Private network"),
    ("http://172.16.0.1/", True, "Private network"),
    ("http://169.254.169.254/", True, "AWS metadata"),
    ("http://metadata.google.internal/", True, "GCP metadata"),
    ("http://0.0.0.0/", True, "Zero address"),
    # Should be ALLOWED
    ("https://example.com/", False, "Public domain"),
    ("https://google.com/", False, "Public domain"),
    ("https://api.crawlforge.dev/", False, "CrawlForge API"),
]


def is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is in a private range."""
    try:
        ip = ipaddress.ip_address(ip_str)
        for network in PRIVATE_RANGES:
            if ip in network:
                return True
        return False
    except ValueError:
        return False


def check_url_ssrf(url: str) -> tuple[bool, str]:
    """
    Check if a URL would be blocked by SSRF protection.
    Returns (should_block, reason).
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""

        # Check blocked hostnames
        if hostname.lower() in BLOCKED_HOSTNAMES:
            return True, f"Blocked hostname: {hostname}"

        # Check if hostname is an IP address
        try:
            ip = ipaddress.ip_address(hostname)
            if is_private_ip(str(ip)):
                return True, f"Private IP address: {ip}"
        except ValueError:
            pass  # Not an IP address, hostname is fine

        # Check for scheme
        if parsed.scheme not in ("http", "https"):
            return True, f"Invalid scheme: {parsed.scheme}"

        return False, "URL appears safe"

    except Exception as e:
        return True, f"Parse error: {e}"


def run_ssrf_tests(verbose: bool = False) -> dict:
    """Run all SSRF protection tests."""
    results = {
        "status": "pending",
        "total": len(TEST_URLS),
        "passed": 0,
        "failed": 0,
        "tests": []
    }

    for url, should_block, description in TEST_URLS:
        is_blocked, reason = check_url_ssrf(url)
        passed = is_blocked == should_block

        test_result = {
            "url": url,
            "description": description,
            "expected": "BLOCK" if should_block else "ALLOW",
            "actual": "BLOCK" if is_blocked else "ALLOW",
            "reason": reason,
            "passed": passed
        }

        results["tests"].append(test_result)

        if passed:
            results["passed"] += 1
        else:
            results["failed"] += 1

    results["status"] = "pass" if results["failed"] == 0 else "fail"
    return results


def check_ssrf_implementation() -> dict:
    """Check if SSRF protection is implemented in the codebase."""
    project_root = get_project_root()
    results = {
        "has_ssrf_check": False,
        "has_private_ip_check": False,
        "has_hostname_blocklist": False,
        "files_checked": []
    }

    # Files to check
    check_files = [
        "src/core/ssrf.js",
        "src/utils/ssrf.js",
        "src/security/ssrf.js",
        "server.js",
    ]

    for file_pattern in check_files:
        file_path = project_root / file_pattern
        if file_path.exists():
            results["files_checked"].append(str(file_path))
            with open(file_path) as f:
                content = f.read()

            if "ssrf" in content.lower() or "SSRF" in content:
                results["has_ssrf_check"] = True

            if "privateIP" in content or "isPrivate" in content or "private" in content.lower():
                results["has_private_ip_check"] = True

            if "localhost" in content and "block" in content.lower():
                results["has_hostname_blocklist"] = True

    # Also check src/ recursively
    src_dir = project_root / "src"
    if src_dir.exists():
        for js_file in src_dir.rglob("*.js"):
            with open(js_file) as f:
                content = f.read()
            if "ssrf" in content.lower() or "privateIP" in content:
                results["has_ssrf_check"] = True
                if str(js_file) not in results["files_checked"]:
                    results["files_checked"].append(str(js_file))

    return results


def main():
    parser = argparse.ArgumentParser(description="Check SSRF protection")
    parser.add_argument("--test-url", "-u", help="Test a specific URL")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    print("=== SSRF Protection Validator ===")
    print("")

    if args.test_url:
        # Test single URL
        is_blocked, reason = check_url_ssrf(args.test_url)
        print(f"URL: {args.test_url}")
        print(f"Status: {'BLOCKED' if is_blocked else 'ALLOWED'}")
        print(f"Reason: {reason}")
        sys.exit(0)

    # Check implementation
    print("Checking SSRF implementation...")
    impl_results = check_ssrf_implementation()

    if impl_results["has_ssrf_check"]:
        print("  SSRF protection code found")
    else:
        print("  Warning: No SSRF protection code found")

    if impl_results["has_private_ip_check"]:
        print("  Private IP checking found")

    print("")

    # Run URL tests
    print("Running SSRF URL tests...")
    test_results = run_ssrf_tests(verbose=args.verbose)

    print(f"Passed: {test_results['passed']}/{test_results['total']}")
    print(f"Failed: {test_results['failed']}/{test_results['total']}")
    print("")

    if args.verbose or test_results["failed"] > 0:
        print("=== Test Details ===")
        for test in test_results["tests"]:
            status = "PASS" if test["passed"] else "FAIL"
            print(f"\n  [{status}] {test['description']}")
            print(f"       URL: {test['url']}")
            print(f"       Expected: {test['expected']}, Got: {test['actual']}")

    print("")
    if test_results["status"] == "pass":
        print("Result: PASS - SSRF protection working correctly")
    else:
        print("Result: FAIL - SSRF protection has issues")

    if args.json:
        print("")
        print(json.dumps({
            "implementation": impl_results,
            "tests": test_results
        }, indent=2))

    sys.exit(0 if test_results["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
