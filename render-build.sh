#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist
cp -R outputs/. dist/

replace_config() {
  local name="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    return
  fi

  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&|\\]/\\&/g')"
  sed -i "s|window.${name} = \"[^\"]*\";|window.${name} = \"${escaped}\";|" dist/index.html
}

replace_config "KAKAO_MAP_API_KEY" "${KAKAO_MAP_API_KEY:-}"
replace_config "SUPABASE_URL" "${SUPABASE_URL:-}"
replace_config "SUPABASE_PUBLISHABLE_KEY" "${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}"
replace_config "GOOGLE_SHEETS_WEB_APP_URL" "${GOOGLE_SHEETS_WEB_APP_URL:-}"
replace_config "SURVEY_SESSION_CODE" "${SURVEY_SESSION_CODE:-}"
