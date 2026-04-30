#!/usr/bin/env bash
# Rewrites symlinks whose target matches ../../../nanoclaw-private/<rest>
# into absolute targets $PRIVATE_REPO/<rest>, so Docker agent containers can
# follow them (bind mount often cannot resolve sibling-relative paths correctly).
#
# Usage:
#   export PRIVATE_REPO="/absolute/path/to/nanoclaw-private"
#   ./retarget-private-symlinks.sh /absolute/path/to/nanoclaw/groups/some-folder
#
# Optional: second arg overrides PRIVATE_REPO.
set -euo pipefail

dir=${1:?usage: retarget-private-symlinks.sh <group-or-directory> [PRIVATE_REPO_ABS]}
repo_root="${PRIVATE_REPO:-${2:-}}"
if [[ -z "$repo_root" ]]; then
  echo "error: set PRIVATE_REPO or pass absolute path to nanoclaw-private as second argument" >&2
  exit 1
fi

if [[ ! -d "$dir" ]]; then
  echo "error: not a directory: $dir" >&2
  exit 1
fi
if [[ ! -d "$repo_root" ]]; then
  echo "error: PRIVATE_REPO not a directory: $repo_root" >&2
  exit 1
fi
repo_root=$(cd "$repo_root" && pwd)

fixed=0
while IFS= read -r -d '' link; do
  t=$(readlink "$link")
  case "$t" in
    ../../../nanoclaw-private/*)
      rest="${t#../../../nanoclaw-private/}"
      ln -sfn "$repo_root/$rest" "$link"
      echo "fixed $(basename "$link") -> $repo_root/$rest"
      fixed=$((fixed + 1))
      ;;
  esac
done < <(find "$dir" -maxdepth 1 -type l -print0 2>/dev/null || true)

echo "done: $fixed symlink(s) in $dir"
