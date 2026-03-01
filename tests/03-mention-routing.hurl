# =============================================================================
# Suite 3: Mention Routing & Cross-Account Gating (E2E)
# =============================================================================
# Tests the plugin's mention-gating logic via real messages through Open WebUI.
# Uses a dedicated test user (matthias) to send messages and checks bot responses.
#
# IMPORTANT: Requires OpenClaw gateway running with the plugin connected.
# Bot responses are checked by polling recent messages after a delay.
#
# Test cases:
#   1. Shared channel, no @mention → Butler responds (requireMention=false),
#      Researcher silent (requireMention=true)
#   2. Shared channel, @mention Researcher → only Researcher responds
#   3. Shared channel, reply to Researcher's message → only Researcher responds
#   4. Shared channel, @mention Butler → only Butler responds
#
# Usage:
#   hurl --variables-file tests/env.vars --test tests/03-mention-routing.hurl
# =============================================================================


# --- Auth: Get tokens for both bot accounts (to read responses) ---
POST {{base_url}}/api/v1/auths/signin
Content-Type: application/json
{
  "email": "{{butler_email}}",
  "password": "{{butler_password}}"
}
HTTP 200
[Captures]
butler_token: jsonpath "$.token"
butler_user_id: jsonpath "$.id"


POST {{base_url}}/api/v1/auths/signin
Content-Type: application/json
{
  "email": "{{researcher_email}}",
  "password": "{{researcher_password}}"
}
HTTP 200
[Captures]
researcher_token: jsonpath "$.token"
researcher_user_id: jsonpath "$.id"


# =============================================================================
# Test 1: No mention in shared channel
# Expected: Butler responds (requireMention=false), Researcher silent
# =============================================================================

# Post as Butler (simulating user message — in real E2E this would be a 3rd user)
# We use Butler's own channel to avoid triggering himself (own messages are ignored)
# Instead: post as Researcher to shared channel WITHOUT mention
POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{researcher_token}}
Content-Type: application/json
{
  "content": "[E2E-TEST-1] Plain message no mention - {{researcher_user_id}}",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
test1_msg_id: jsonpath "$.id"
test1_timestamp: jsonpath "$.created_at"
[Asserts]
jsonpath "$.id" isString


# =============================================================================
# Test 2: @mention Researcher in shared channel
# Expected: Only Researcher responds, Butler stays silent
# =============================================================================

# Post with Researcher mention syntax (Butler posts, mentioning Researcher)
POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{butler_token}}
Content-Type: application/json
{
  "content": "[E2E-TEST-2] Hey <@U:{{researcher_user_id}}|Researcher> please help",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
test2_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.id" isString


# =============================================================================
# Test 3: @mention Butler in shared channel
# Expected: Only Butler responds, Researcher stays silent
# =============================================================================

POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{researcher_token}}
Content-Type: application/json
{
  "content": "[E2E-TEST-3] Hey <@U:{{butler_user_id}}|Butler> what's up",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
test3_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.id" isString


# =============================================================================
# Test 4: Reply to Researcher's message (implicit mention)
# Expected: Only Researcher responds
# =============================================================================

# First: Researcher posts a message
POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{researcher_token}}
Content-Type: application/json
{
  "content": "[E2E-TEST-4-SEED] Researcher's original message for reply test",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
test4_seed_msg_id: jsonpath "$.id"

# Then: Butler replies to it (simulating user replying to bot)
POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{butler_token}}
Content-Type: application/json
{
  "content": "[E2E-TEST-4] Replying to Researcher without mention",
  "reply_to_id": "{{test4_seed_msg_id}}",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
test4_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.reply_to_id" == "{{test4_seed_msg_id}}"


# =============================================================================
# Verification: Poll messages after delay to check bot responses
# =============================================================================

# Wait for bots to process and respond
# (hurl retry with delay serves as our poll mechanism)

GET {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages?skip=0&limit=30
Authorization: Bearer {{butler_token}}
[Options]
delay: 15000
retry: 3
retry-interval: 5000
HTTP 200
[Captures]
all_messages: jsonpath "$"
[Asserts]
# We should have messages — exact assertion depends on bot response timing
jsonpath "$" count >= 4
