#!/usr/bin/env bash
# .github/rulesets/*.json を GitHub のリポジトリに入れる。同じ名前のルールがあれば置き換える。
# ファイル名とルールの name をそろえておく（master.json の name は "master"）。
# 使い方: scripts/apply-rulesets.sh（gh でログインし、origin が GitHub を向いていること）
set -euo pipefail

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
for f in .github/rulesets/*.json; do
  name="$(basename "$f" .json)"
  id="$(gh api "repos/$repo/rulesets" -q ".[] | select(.name == \"$name\") | .id")"
  if [[ -n "$id" ]]; then
    gh api -X PUT "repos/$repo/rulesets/$id" --input "$f" >/dev/null
    echo "置き換えた: $name"
  else
    gh api -X POST "repos/$repo/rulesets" --input "$f" >/dev/null
    echo "足した: $name"
  fi
done
