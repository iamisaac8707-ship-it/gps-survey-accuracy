#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist
cp -R outputs/. dist/

if [[ -n "${KAKAO_MAP_API_KEY:-}" ]]; then
  sed -i "s/window.KAKAO_MAP_API_KEY = \"\";/window.KAKAO_MAP_API_KEY = \"${KAKAO_MAP_API_KEY}\";/" dist/index.html
fi
