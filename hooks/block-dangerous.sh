#!/bin/bash
# Blocks destructive agent commands. Missing input is a deny.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/hooks/denied.log"

deny() {
  local rule="$1"
  mkdir -p "$ROOT/hooks"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rule" >> "$LOG"
  printf '%s\n' "{\"permission\":\"deny\",\"user_message\":\"Blocked: ${rule}\",\"agent_message\":\"Safety hook blocked this action (${rule}). Ask the user, then wait.\"}"
  exit 2
}

allow() {
  printf '%s\n' '{"permission":"allow"}'
  exit 0
}

json_string() {
  local key="$1"
  local blob="$2"
  printf '%s' "$blob" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -1
}

is_protected_path() {
  local raw="$1"
  [[ -z "$raw" ]] && return 1
  local path="$raw"
  if command -v realpath >/dev/null 2>&1; then
    local resolved
    resolved="$(realpath "$raw" 2>/dev/null || true)"
    [[ -n "$resolved" ]] && path="$resolved"
  fi
  case "$path" in
    *"/.git/"*|*"/.git"|*/hooks/*|*/.githooks/*|*/.cursor/hooks.json|*/.claude/settings.json|*/rules/always/safety.md|*/.env|*/.env.*)
      return 0
      ;;
  esac
  case "$raw" in
    .git|.git/*|hooks|hooks/*|.githooks|.githooks/*|.cursor/hooks.json|.claude/settings.json|rules/always/safety.md|.env|.env.*)
      return 0
      ;;
  esac
  return 1
}

command_denied() {
  local cmd="$1"
  local lower
  lower="$(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]')"

  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])(base64)[[:space:]]+(-d|--decode).*\|[[:space:]]*(ba)?sh([^[:alnum:]_]|$)'; then
    deny "base64-pipe"
  fi
  if printf '%s' "$lower" | grep -Eq 'python3?[[:space:]]+-c.*(os\.remove|rmtree|unlink)'; then
    deny "python-delete"
  fi
  if printf '%s' "$lower" | grep -Eq 'perl[[:space:]]+-e.*unlink'; then
    deny "perl-unlink"
  fi
  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])truncate([^[:alnum:]_]|$)'; then
    deny "truncate"
  fi
  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])shred([^[:alnum:]_]|$)'; then
    deny "shred"
  fi

  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])(delete[[:space:]]+from|deletemany|deleteone|updatemany|drop[[:space:]]+(table|database|schema|collection|index)|\.drop\(|\.remove\(|flushall|flushdb|truncate([[:space:]]|$))'; then
    deny "data-write"
  fi
  if printf '%s' "$lower" | grep -Eq 'update[[:space:]]+[a-z0-9_."]+[[:space:]]+set'; then
    deny "data-write"
  fi

  if printf '%s' "$lower" | grep -Eq '(^|[;&|([:space:]])(/bin/|/usr/bin/)?rm[[:space:]]+-[a-z]*r[a-z]*f'; then
    deny "rm-force"
  fi
  if printf '%s' "$lower" | grep -Eq '(^|[;&|([:space:]])(/bin/|/usr/bin/)?rm[[:space:]]+-[a-z]*f[a-z]*r'; then
    deny "rm-force"
  fi
  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])rm[[:space:]]+' \
    && printf '%s' "$lower" | grep -Eq '(^|[[:space:]])-r([[:space:]]|$)|--recursive' \
    && printf '%s' "$lower" | grep -Eq '(^|[[:space:]])-f([[:space:]]|$)|--force'; then
    deny "rm-force"
  fi
  if printf '%s' "$lower" | grep -Eq 'rimraf'; then
    deny "rimraf"
  fi
  if printf '%s' "$lower" | grep -Eq 'find[[:space:]].*-delete'; then
    deny "find-delete"
  fi
  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])(kill|pkill|killall)([^[:alnum:]_]|$)'; then
    deny "kill"
  fi
  if printf '%s' "$lower" | grep -Eq 'chmod[[:space:]]+-r'; then
    deny "chmod-recursive"
  fi
  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])mkfs([^[:alnum:]_]|$)'; then
    deny "mkfs"
  fi
  if printf '%s' "$lower" | grep -Eq 'dd[[:space:]].*of='; then
    deny "dd"
  fi
  if printf '%s' "$lower" | grep -Eq '(curl|wget).*\|[[:space:]]*(ba)?sh'; then
    deny "curl-pipe-sh"
  fi

  if printf '%s' "$lower" | grep -Eq 'core\.hookspath|--no-verify|--force-with-lease|push[[:space:]]+.*--force|(^|[[:space:]])git[[:space:]]+push[[:space:]]+.*[[:space:]]-f([[:space:]]|$)|reset[[:space:]]+--hard'; then
    deny "git-rewrite"
  fi
  if printf '%s' "$lower" | grep -Eq 'git[[:space:]]+config'; then
    deny "git-config"
  fi
  if printf '%s' "$lower" | grep -Eq 'git[[:space:]]+push[[:space:]].*[[:space:]]\+'; then
    deny "git-refspec"
  fi
  if printf '%s' "$lower" | grep -Eq 'git[[:space:]]+(checkout[[:space:]]+--|restore([[:space:]]|$))'; then
    deny "git-restore"
  fi
  if printf '%s' "$lower" | grep -Eq 'git[[:space:]]+clean([[:space:]]|$)'; then
    if ! printf '%s' "$lower" | grep -Eq '(^|[[:space:]])-n([[:space:]]|$)|--dry-run'; then
      deny "git-clean"
    fi
  fi

  if printf '%s' "$lower" | grep -Eq '(>|>>)[[:space:]]*(\.env|\.git/|hooks/|rules/always/|\.githooks/)'; then
    deny "redirect-protected"
  fi

  if printf '%s' "$lower" | grep -Eq '(^|[[:space:]])(pnpm|npm)[[:space:]]+(run|install|ci)([[:space:]]|$)'; then
    local pkg=""
    if [[ -n "${HOOK_PACKAGE_JSON:-}" && -f "$HOOK_PACKAGE_JSON" ]]; then
      pkg="$HOOK_PACKAGE_JSON"
    elif [[ -f package.json ]]; then
      pkg="package.json"
    elif [[ -f "$ROOT/package.json" ]]; then
      pkg="$ROOT/package.json"
    fi
    if [[ -n "$pkg" ]]; then
      local scripts
      scripts="$(sed -n '/"scripts"/,/}/p' "$pkg" | tr '[:upper:]' '[:lower:]')"
      if printf '%s' "$scripts" | grep -Eq 'rm[[:space:]]+-|find[[:space:]].*-delete|rimraf|delete[[:space:]]+from|drop[[:space:]]+table'; then
        deny "package-script"
      fi
    fi
  fi
}

# Read stdin to a temp file first. Huge Write payloads exceed bash ARG_MAX
# if kept in variables and passed to functions (failClosed -> false deny).
TMP_INPUT="$(mktemp)"
trap 'rm -f "$TMP_INPUT" "$TMP_INPUT.cmd" "$TMP_INPUT.meta"' EXIT
cat > "$TMP_INPUT" || true
if [[ ! -s "$TMP_INPUT" ]]; then
  deny "empty-input"
fi

python3 - "$TMP_INPUT" <<'PY'
import json, sys
path = sys.argv[1]
raw = open(path, "rb").read()
tool = file_path = path_value = command = ""
has_command_key = "no"
if raw.strip():
    try:
        data = json.loads(raw)
    except Exception:
        data = None
    if isinstance(data, dict):
        def dig(obj, *keys):
            cur = obj
            for k in keys:
                if not isinstance(cur, dict) or k not in cur:
                    return ""
                cur = cur[k]
            if cur is None or isinstance(cur, (dict, list)):
                return ""
            return str(cur)
        tool = dig(data, "tool_name") or dig(data, "toolName") or ""
        command = dig(data, "command") or dig(data, "tool_input", "command") or ""
        file_path = dig(data, "file_path") or dig(data, "tool_input", "file_path") or ""
        path_value = dig(data, "path") or dig(data, "tool_input", "path") or ""
        if "command" in data or (isinstance(data.get("tool_input"), dict) and "command" in data["tool_input"]):
            has_command_key = "yes"
open(path + ".meta", "w", encoding="utf-8").write("|".join([tool, file_path, path_value, has_command_key]))
open(path + ".cmd", "w", encoding="utf-8").write(command)
PY

IFS='|' read -r tool file_path path_value has_command_key < "$TMP_INPUT.meta"
command="$(cat "$TMP_INPUT.cmd")"
target="${file_path:-$path_value}"

tool_lower="$(printf '%s' "$tool" | tr '[:upper:]' '[:lower:]')"
if [[ "$tool_lower" == "delete" ]]; then
  deny "delete-tool"
fi

if is_protected_path "$target"; then
  deny "protected-path"
fi

if [[ -n "$command" ]]; then
  command_denied "$command"
  allow
fi

if [[ "$has_command_key" == "yes" ]]; then
  deny "empty-command"
fi

allow
