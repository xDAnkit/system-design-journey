#!/bin/bash
# Qoder PreToolUse adapter for hooks/block-dangerous.sh.
# Two things Qoder needs that the shared hook does not do:
#   1. Qoder names its delete tool DeleteFile. The hook looks for Delete.
#   2. Qoder reads stdout JSON as hookSpecificOutput.permissionDecision.
# The shared hook stays the single source of truth for the rules.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/hooks/block-dangerous.sh"
TMP="$(mktemp)"
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP" "$TMP_OUT"' EXIT

cat > "$TMP"

python3 - "$TMP" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    sys.exit(0)
if not isinstance(data, dict):
    sys.exit(0)
name = str(data.get("tool_name") or "")
if name.lower() in ("deletefile", "delete_file"):
    data["tool_name"] = "Delete"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
PY

"$HOOK" < "$TMP" > "$TMP_OUT" 2>/dev/null
code=$?
reason="$(sed -n 's/.*"user_message":"\([^"]*\)".*/\1/p' "$TMP_OUT" | head -1)"

if [[ "$code" -eq 2 ]]; then
  [[ -n "$reason" ]] || reason="Blocked by safety hook"
  printf '%s. Ask the user, then wait.\n' "$reason" >&2
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 2
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Safety hook passed"}}'
exit 0
