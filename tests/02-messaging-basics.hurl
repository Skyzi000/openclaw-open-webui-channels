# =============================================================================
# Suite 2: Basic Messaging — Post & Retrieve
# =============================================================================
# Verifies both accounts can post and read messages in their channels.
#
# Usage:
#   hurl --variables-file tests/env.vars --test tests/02-messaging-basics.hurl
# =============================================================================


# --- Auth both accounts ---
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


# --- Butler: Post message to butler channel ---
POST {{base_url}}/api/v1/channels/{{butler_channel_id}}/messages/post
Authorization: Bearer {{butler_token}}
Content-Type: application/json
{
  "content": "[TEST] Butler posting to own channel",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
butler_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.content" == "[TEST] Butler posting to own channel"
jsonpath "$.channel_id" == "{{butler_channel_id}}"
jsonpath "$.user_id" == "{{butler_user_id}}"


# --- Butler: Read back message ---
GET {{base_url}}/api/v1/channels/{{butler_channel_id}}/messages/{{butler_msg_id}}
Authorization: Bearer {{butler_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "{{butler_msg_id}}"
jsonpath "$.content" == "[TEST] Butler posting to own channel"


# --- Researcher: Post message to researcher channel ---
POST {{base_url}}/api/v1/channels/{{researcher_channel_id}}/messages/post
Authorization: Bearer {{researcher_token}}
Content-Type: application/json
{
  "content": "[TEST] Researcher posting to own channel",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
researcher_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.content" == "[TEST] Researcher posting to own channel"
jsonpath "$.channel_id" == "{{researcher_channel_id}}"
jsonpath "$.user_id" == "{{researcher_user_id}}"


# --- Researcher: Read back message ---
GET {{base_url}}/api/v1/channels/{{researcher_channel_id}}/messages/{{researcher_msg_id}}
Authorization: Bearer {{researcher_token}}
HTTP 200
[Asserts]
jsonpath "$.id" == "{{researcher_msg_id}}"


# --- Both accounts post to shared channel ---
POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{butler_token}}
Content-Type: application/json
{
  "content": "[TEST] Butler in shared channel",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
butler_shared_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.user_id" == "{{butler_user_id}}"


POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{researcher_token}}
Content-Type: application/json
{
  "content": "[TEST] Researcher in shared channel",
  "data": {},
  "meta": {}
}
HTTP 200
[Captures]
researcher_shared_msg_id: jsonpath "$.id"
[Asserts]
jsonpath "$.user_id" == "{{researcher_user_id}}"


# --- Cross-read: Butler reads Researcher's message in shared channel ---
GET {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/{{researcher_shared_msg_id}}
Authorization: Bearer {{butler_token}}
HTTP 200
[Asserts]
jsonpath "$.content" == "[TEST] Researcher in shared channel"


# --- Reply: Butler replies to Researcher's message ---
POST {{base_url}}/api/v1/channels/{{shared_channel_id}}/messages/post
Authorization: Bearer {{butler_token}}
Content-Type: application/json
{
  "content": "[TEST] Butler replying to Researcher",
  "reply_to_id": "{{researcher_shared_msg_id}}",
  "data": {},
  "meta": {}
}
HTTP 200
[Asserts]
jsonpath "$.reply_to_id" == "{{researcher_shared_msg_id}}"
jsonpath "$.user_id" == "{{butler_user_id}}"
