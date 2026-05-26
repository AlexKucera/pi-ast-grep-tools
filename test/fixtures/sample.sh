#!/usr/bin/env bash
# Sample Bash fixture for smoke tests

set -euo pipefail

# Common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log_info() {
  echo "[INFO] $*"
}

log_error() {
  echo "[ERROR] $*" >&2
}

is_command_available() {
  command -v "$1" >/dev/null 2>&1
}

validate_path() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    log_error "File not found: $path"
    return 1
  fi
  return 0
}

main() {
  log_info "Starting script from ${SCRIPT_DIR}"

  if is_command_available "git"; then
    log_info "Git is available"
  else
    log_error "Git is not installed"
    exit 1
  fi

  validate_path "${BASH_SOURCE[0]}"
  log_info "All checks passed"
}

main "$@"
