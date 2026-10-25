#!/usr/bin/env bash
# master へ入れる変更で、版（app/package.json の version）が上がっているかを確かめる。
# デスクトップと web は同じ app/ を使うので、版はここ 1 つ。
# 使い方: scripts/check-version.sh <比べる先の ref>（例: origin/master）
set -euo pipefail

base="${1:?比べる先の ref を渡す}"
manifest='app/package.json'
semver='^[0-9]+\.[0-9]+\.[0-9]+$'
version_of() { node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version ?? ""'; }

new="$(version_of < "$manifest")"
old='0.0.0'
if git cat-file -e "$base:$manifest" 2>/dev/null; then
  old="$(git show "$base:$manifest" | version_of)"
fi

if ! [[ "$new" =~ $semver ]]; then
  echo "$manifest の version が X.Y.Z の形ではない: '$new'" >&2
  exit 1
fi
if [[ "$new" == "$old" ]] || [[ "$(printf '%s\n%s\n' "$old" "$new" | sort -V | tail -n1)" != "$new" ]]; then
  echo "$manifest の version を $old より上げる（今は $new）" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$new" >/dev/null; then
  echo "タグ v$new はもうある" >&2
  exit 1
fi
echo "v$old → v$new"
