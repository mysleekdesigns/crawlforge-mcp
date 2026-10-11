#!/usr/bin/env bash
# PreToolUse(Bash): blocks force-pushes, hook bypasses and blanket staging.
# Exit 2 denies the call; stderr is shown to Claude as the reason.

cmd=$(jq -r '.tool_input.command // ""')

deny() {
  echo "Blocked by .claude/hooks/block-unsafe-git.sh: $1" >&2
  exit 2
}

# Drop heredoc bodies and quoted strings (commit messages, echo text) so only
# the command words are checked, then split on shell separators.
words=$(printf '%s\n' "$cmd" | awk '
  delim != "" { if ($0 ~ "^[[:space:]]*" delim "[[:space:]]*$") delim = ""; next }
  { print }
  match($0, /<<-?[[:space:]]*["\x27]?[A-Za-z_][A-Za-z0-9_]*/) {
    d = substr($0, RSTART, RLENGTH); sub(/^<<-?[[:space:]]*["\x27]?/, "", d); delim = d
  }' | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g; s/(&&|\|\||;|\|)/\n/g")

while IFS= read -r part; do
  if [[ $part =~ (^|[[:space:]])git[[:space:]]+push([[:space:]]|$) ]] &&
     [[ $part =~ [[:space:]](--force([-=a-z]*)?|-f|\+[^[:space:]]+)([[:space:]]|$) ]]; then
    deny "never force-push. Push normally, or ask the user."
  fi
  if [[ $part =~ (^|[[:space:]])git[[:space:]] ]] && [[ $part =~ [[:space:]]--no-verify([[:space:]]|$) ]]; then
    deny "never skip git hooks with --no-verify. Fix what the hook reports."
  fi
  if [[ $part =~ (^|[[:space:]])git[[:space:]]+add[[:space:]] ]] &&
     [[ $part =~ [[:space:]](-A|--all|\.)([[:space:]]|$) ]]; then
    deny "stage files by name, not with git add -A / --all / '.'."
  fi
done <<< "$words"

exit 0
