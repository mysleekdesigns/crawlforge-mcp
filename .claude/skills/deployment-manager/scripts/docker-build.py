#!/usr/bin/env python3
"""
Docker Build Script for CrawlForge MCP Server

Builds and tags Docker images with validation.
Usage: python3 docker-build.py [--tag TAG] [--push] [--no-cache]
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent.parent.parent


def get_version() -> str:
    """Get version from package.json."""
    package_path = get_project_root() / "package.json"
    with open(package_path) as f:
        return json.load(f)["version"]


def run_command(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run a command and return the result."""
    print(f"  Running: {' '.join(cmd)}")
    return subprocess.run(cmd, check=check, capture_output=True, text=True)


def check_docker() -> bool:
    """Check if Docker is available."""
    try:
        result = run_command(["docker", "--version"], check=False)
        return result.returncode == 0
    except FileNotFoundError:
        return False


def check_dockerfile() -> bool:
    """Check if Dockerfile exists."""
    dockerfile = get_project_root() / "Dockerfile"
    return dockerfile.exists()


def build_image(tag: str, no_cache: bool = False) -> bool:
    """Build the Docker image."""
    project_root = get_project_root()

    cmd = ["docker", "build", "-t", tag, str(project_root)]
    if no_cache:
        cmd.insert(2, "--no-cache")

    try:
        result = run_command(cmd)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"  Build failed: {e.stderr}")
        return False


def push_image(tag: str) -> bool:
    """Push the Docker image to registry."""
    try:
        result = run_command(["docker", "push", tag])
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"  Push failed: {e.stderr}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Build CrawlForge MCP Server Docker image")
    parser.add_argument("--tag", "-t", help="Image tag (default: crawlforge-mcp-server:VERSION)")
    parser.add_argument("--push", "-p", action="store_true", help="Push image after building")
    parser.add_argument("--no-cache", action="store_true", help="Build without cache")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    results = {
        "status": "pending",
        "checks": {},
        "image": None,
        "version": None
    }

    print("=== CrawlForge Docker Build ===")
    print("")

    # Check Docker
    print("Checking Docker...")
    if not check_docker():
        print("  Docker not available")
        results["status"] = "error"
        results["checks"]["docker"] = False
        if args.json:
            print(json.dumps(results, indent=2))
        sys.exit(1)
    print("  Docker available")
    results["checks"]["docker"] = True

    # Check Dockerfile
    print("")
    print("Checking Dockerfile...")
    if not check_dockerfile():
        print("  Dockerfile not found")
        results["status"] = "error"
        results["checks"]["dockerfile"] = False
        if args.json:
            print(json.dumps(results, indent=2))
        sys.exit(1)
    print("  Dockerfile found")
    results["checks"]["dockerfile"] = True

    # Get version and tag
    version = get_version()
    results["version"] = version
    tag = args.tag or f"crawlforge-mcp-server:{version}"
    results["image"] = tag

    print("")
    print(f"Building image: {tag}")
    print(f"Version: {version}")
    print("")

    # Build
    print("Building Docker image...")
    if not build_image(tag, args.no_cache):
        print("  Build failed")
        results["status"] = "error"
        results["checks"]["build"] = False
        if args.json:
            print(json.dumps(results, indent=2))
        sys.exit(1)
    print("  Build successful")
    results["checks"]["build"] = True

    # Also tag as latest
    latest_tag = "crawlforge-mcp-server:latest"
    run_command(["docker", "tag", tag, latest_tag], check=False)

    # Push if requested
    if args.push:
        print("")
        print(f"Pushing image: {tag}")
        if not push_image(tag):
            print("  Push failed")
            results["status"] = "error"
            results["checks"]["push"] = False
            if args.json:
                print(json.dumps(results, indent=2))
            sys.exit(1)
        print("  Push successful")
        results["checks"]["push"] = True

    results["status"] = "success"

    print("")
    print("=== Build Complete ===")
    print(f"  Image: {tag}")
    print(f"  Also tagged: {latest_tag}")
    if args.push:
        print(f"  Pushed to registry")

    if args.json:
        print("")
        print(json.dumps(results, indent=2))

    sys.exit(0)


if __name__ == "__main__":
    main()
