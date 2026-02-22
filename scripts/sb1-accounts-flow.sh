#!/usr/bin/env bash
set -euo pipefail

API_BASE="https://api.sparebank1.no"
CLIENT_ID_DEFAULT="1f3f4108-6ad2-4b3f-a15b-ee4f1c236e84"
FININST_DEFAULT="fid-sor-norge"
REDIRECT_URI_DEFAULT="https://localhost"

client_id="${SB1_CLIENT_ID:-$CLIENT_ID_DEFAULT}"
fininst="${SB1_FININST:-$FININST_DEFAULT}"
redirect_uri="${SB1_REDIRECT_URI:-$REDIRECT_URI_DEFAULT}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Missing dependency: jq" >&2
  exit 1
fi

if [[ -n "${SB1_CLIENT_SECRET:-}" ]]; then
  client_secret="${SB1_CLIENT_SECRET}"
else
  read -r -s -p "Client secret: " client_secret
  echo
fi

if [[ -n "${SB1_REDIRECTED_URL:-}" ]]; then
  redirected_url="${SB1_REDIRECTED_URL}"
else
  state="$(date +%s)"
  encoded_redirect_uri="$(jq -rn --arg v "$redirect_uri" '$v|@uri')"
  auth_url="${API_BASE}/oauth/authorize?client_id=${client_id}&state=${state}&redirect_uri=${encoded_redirect_uri}&finInst=${fininst}&response_type=code"

  echo "Opening browser for BankID authentication..."
  if command -v open >/dev/null 2>&1; then
    open "$auth_url" >/dev/null 2>&1 || true
  fi
  echo "If browser did not open, use this URL:"
  echo "$auth_url"

  read -r -p "Paste full redirect URL: " redirected_url
fi
code="$(printf '%s' "$redirected_url" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"
state_from_redirect="$(printf '%s' "$redirected_url" | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')"

if [[ -z "$code" || -z "$state_from_redirect" ]]; then
  echo "Could not parse code/state from redirect URL." >&2
  exit 1
fi

attempt_redirect_uris=("$redirect_uri")
if [[ "$redirect_uri" == */ ]]; then
  attempt_redirect_uris+=("${redirect_uri%/}")
else
  attempt_redirect_uris+=("${redirect_uri}/")
fi

token_json=""
access_token=""
used_redirect_uri=""

for attempt_uri in "${attempt_redirect_uris[@]}"; do
  token_json="$(curl -s --request POST "${API_BASE}/oauth/token" \
    --header "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "client_id=${client_id}" \
    --data-urlencode "client_secret=${client_secret}" \
    --data-urlencode "code=${code}" \
    --data-urlencode "grant_type=authorization_code" \
    --data-urlencode "state=${state_from_redirect}" \
    --data-urlencode "redirect_uri=${attempt_uri}")"

  access_token="$(printf '%s' "$token_json" | jq -r '.access_token // empty')"
  if [[ -n "$access_token" ]]; then
    used_redirect_uri="$attempt_uri"
    break
  fi
done

echo "$token_json" | jq .

if [[ -z "$access_token" ]]; then
  echo "No access token returned." >&2
  echo "Tried redirect_uri values: ${attempt_redirect_uris[*]}" >&2
  echo "Most likely causes:" >&2
  echo "1) The code is expired or already used (get a fresh redirect URL)." >&2
  echo "2) Client secret is not exact (copy/paste plain text, no extra characters)." >&2
  echo "3) Redirect URI mismatch in client settings." >&2
  exit 2
fi

echo "Token issued using redirect_uri=${used_redirect_uri}"

echo "Fetching accounts..."
curl -s "${API_BASE}/personal/banking/accounts?includeNokAccounts=true" \
  -H "Authorization: Bearer ${access_token}" \
  -H "Accept: application/vnd.sparebank1.v5+json; charset=utf-8" | jq .
