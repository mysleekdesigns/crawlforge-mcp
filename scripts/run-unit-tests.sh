#!/usr/bin/env bash
#
# Runs the unit suite with ONE NODE PROCESS PER TEST FILE.
#
# WHY PER-FILE — do not "simplify" this back into a single glob run:
#
#     node --test --test-force-exit 'tests/unit/**/*.test.js'
#
# That form has two failure modes, and no single-process invocation can avoid
# both at once:
#
#   1. WITH --test-force-exit, the runner can tear the process down before the
#      later suites have reported. The run then exits 0 having silently skipped
#      them. This is not hypothetical: during the 4.1 SDK migration a
#      force-exit glob run omitted three whole suites while reporting 0
#      failures. A gate that reports success while skipping tests is worse than
#      no gate at all.
#
#   2. WITHOUT --test-force-exit, the run HANGS FOREVER on
#      tests/unit/d2-reliability.test.js. That file imports
#      StealthBrowserManager, which leaves an open Playwright handle, so the
#      runner never exits even after every test has passed. See CLAUDE.md,
#      "Note: the script includes --test-force-exit".
#
# One process per file resolves both. force-exit can then only ever end a
# process whose tests have already finished, and every file's exit code is
# checked on its own. The file and test counts printed at the end make a
# dropped suite visible as a count change instead of an invisible pass.
#
# --test-force-exit MUST come BEFORE the file path. Placed after it, node
# silently ignores the flag and the d2-reliability hang returns.

set -uo pipefail

cd "$(dirname "$0")/.."

# Matched by the existing npm script; kept here so every caller (CI included)
# gets the same environment from one definition.
export CRAWLFORGE_CREATOR_SECRET=
export CACHE_ENABLE_DISK=false

# Pull "<n>" from a summary line, tolerating both reporters: node's spec
# reporter prints "ℹ tests 10", the TAP reporter prints "# tests 10".
#
# Two traps here, both found by watching a deliberately broken test:
#   - `NF >= 2` is load-bearing. Without it awk hits $(NF-1) == $(-1) on the
#     blank lines in a failure diff and dies with "out of range field -1",
#     so a FAILING file silently counted as 0 tests and 0 failures.
#   - Match the summary line's exact shape, not "second-to-last field". Under
#     --test-force-exit the summary is flushed BEFORE the failure detail, and
#     matching loosely lets an assertion message that happens to end in
#     "pass <n>" be counted as the summary.
summary_count() {
  awk -v key="$1" '
    NF == 3 && ($1 == "\342\204\271" || $1 == "#") && $2 == key && $3 ~ /^[0-9]+$/ { n = $3 }
    END { print n + 0 }
  ' "$2"
}

files=()
while IFS= read -r f; do
  files+=("$f")
done < <(find tests/unit -name '*.test.js' | sort)

if [ "${#files[@]}" -eq 0 ]; then
  echo "ERROR: no unit test files found under tests/unit — check the path." >&2
  exit 1
fi

out="$(mktemp -t crawlforge-unit-XXXXXX)"
trap 'rm -f "$out"' EXIT

total_tests=0
total_pass=0
total_fail=0
failed_files=()

for f in "${files[@]}"; do
  if node --test --test-force-exit "$f" >"$out" 2>&1; then
    status="ok  "
  else
    status="FAIL"
    failed_files+=("$f")
  fi

  n_tests=$(summary_count tests "$out")
  n_pass=$(summary_count pass "$out")
  n_fail=$(summary_count fail "$out")
  total_tests=$((total_tests + n_tests))
  total_pass=$((total_pass + n_pass))
  total_fail=$((total_fail + n_fail))

  printf '%s %-70s %4d tests\n' "$status" "$f" "$n_tests"

  # Only a failing file's output is worth the scrollback.
  [ "$status" = "FAIL" ] && cat "$out"
done

echo
echo "──────────────────────────────────────────────────────────────"
echo "files run:    ${#files[@]}"
echo "files failed: ${#failed_files[@]}"
echo "tests:        ${total_tests} (${total_pass} passed, ${total_fail} failed)"

if [ "${#failed_files[@]}" -gt 0 ]; then
  echo
  echo "Failing files:"
  for f in "${failed_files[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

exit 0
