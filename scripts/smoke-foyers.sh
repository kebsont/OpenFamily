#!/usr/bin/env bash
# Smoke test of the "foyers" fork on a running stack (CI or a local install):
# one owner, ONE login, two households, one member in each.
#   API_BASE=http://localhost:3001 bash scripts/smoke-foyers.sh
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
RUN="${RUN_ID:-$(date +%s)-$RANDOM}"
PASS='FoyerTest123!'
CODE=""; BODY=""

# call METHOD PATH TOKEN [JSON] → sets CODE and BODY, never exits on HTTP errors.
call() {
    local method="$1" path="$2" token="$3" body="${4:-}" tmp
    tmp="$(mktemp)"
    local args=(-sS -o "$tmp" -w "%{http_code}" -X "$method" "$API_BASE$path" -H "Content-Type: application/json")
    [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
    [[ -n "$body" ]] && args+=(-d "$body")
    CODE=$(curl "${args[@]}")
    BODY="$(cat "$tmp")"; rm -f "$tmp"
}
fail() { echo "[FAIL] $*" >&2; exit 1; }
expect() { # expect CODE "description"
    [[ "$CODE" == "$1" ]] || fail "$2: HTTP $CODE (expected $1) $BODY"
    echo "  ✓ $2"
}
check() { # check JQ_EXPR "description"
    echo "$BODY" | jq -e "$1" >/dev/null || fail "$2: $BODY"
    echo "  ✓ $2"
}
register() { # register EMAIL NAME [INVITE] → prints token
    local invite="${3:-}" payload
    payload=$(jq -nc --arg e "$1" --arg n "$2" --arg p "$PASS" --arg i "$invite" \
        '{email:$e, name:$n, password:$p} + (if $i == "" then {} else {inviteToken:$i} end)')
    call POST /api/auth/register "" "$payload"
    [[ "$CODE" == 200 ]] || fail "register $1: HTTP $CODE $BODY"
    echo "$BODY" | jq -r '.data.token'
}
invite() { # invite OWNER_TOKEN → prints invite token
    call POST /api/invites "$1" '{"role":"parent"}'
    [[ "$CODE" == 200 ]] || fail "invite: HTTP $CODE $BODY"
    echo "$BODY" | jq -r '.data.token'
}
items() { call GET /api/shopping "$1" ""; echo "$BODY" | jq -c '[.data[].name] | sort'; }
same() { [[ "$1" == "$2" ]] || fail "$3: got $1"; echo "  ✓ $3"; }

HEAD_EMAIL="chef-$RUN@example.com"

echo "[1] One login, a second household created from it"
K1=$(register "$HEAD_EMAIL" "Chef")
call POST /api/linked-accounts/households "$K1" '{"label":"Foyer 2","currentLabel":"Foyer 1"}'
expect 200 "household 2 created from the same account"
K2_ID=$(echo "$BODY" | jq -r '.data.created')
check '[.data.accounts[].email] | unique == ["'"$HEAD_EMAIL"'"]' "both households show his real e-mail"
call POST /api/linked-accounts/switch "$K1" "{\"userId\":\"$K2_ID\"}"; expect 200 "switch to household 2"
K2=$(echo "$BODY" | jq -r '.data.token')

echo "[2] One member in each household"
INV1=$(invite "$K1")
INV2=$(invite "$K2")
W1=$(register "membre1-$RUN@example.com" "Membre 1" "$INV1")
W2=$(register "membre2-$RUN@example.com" "Membre 2" "$INV2")
call POST /api/shopping "$W1" '{"name":"Riz foyer 1","category":"Alimentation"}'; expect 200 "member 1 adds to household 1"
call POST /api/shopping "$W2" '{"name":"Lait foyer 2","category":"Alimentation"}'; expect 200 "member 2 adds to household 2"

echo "[3] Isolation"
same "$(items "$W1")" '["Riz foyer 1"]' "member 1 sees only household 1"
same "$(items "$W2")" '["Lait foyer 2"]' "member 2 sees only household 2"
same "$(items "$K2")" '["Lait foyer 2"]' "owner, in household 2, sees household 2"
call GET /api/invites/members "$W2" ""
check '[.data[].email] | sort == (["'"$HEAD_EMAIL"'", "membre2-'"$RUN"'@example.com"] | sort)' "member 2 sees him with his real e-mail, nothing of household 1"

echo "[4] Nobody else gains access"
call GET /api/linked-accounts "$W1" ""; check '.data.accounts == []' "member 1 has no switcher"
call POST /api/linked-accounts/switch "$W1" "{\"userId\":\"$K2_ID\"}"; expect 403 "member 1 cannot switch to household 2"
call DELETE "/api/linked-accounts/$K2_ID" "$K1"; expect 400 "household 2 cannot be unlinked from his login"

echo "[5] Linking two separate accounts still works"
X1=$(register "autre1-$RUN@example.com" "Autre")
register "autre2-$RUN@example.com" "Autre" >/dev/null
call POST /api/linked-accounts "$X1" "{\"email\":\"autre2-$RUN@example.com\",\"password\":\"wrong-password\"}"
expect 400 "wrong password refused without signing out"
call POST /api/linked-accounts "$X1" "{\"email\":\"autre2-$RUN@example.com\",\"password\":\"$PASS\"}"
expect 200 "accounts linked"

echo "[6] A removed member loses access immediately"
call GET /api/auth/me "$W1" ""; W1_ID=$(echo "$BODY" | jq -r '.data.user.id')
call DELETE "/api/invites/members/$W1_ID" "$K1"; expect 200 "owner removes member 1 from household 1"
same "$(items "$W1")" '[]' "her old session no longer reaches household 1"

echo "Foyers smoke test passed."
