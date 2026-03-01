# =============================================================================
# Suite 1: Authentication & Channel Discovery
# =============================================================================
# Verifies both accounts can authenticate and see their channels.
#
# Usage:
#   hurl --variables-file tests/env.vars --test tests/01-auth-and-channels.hurl
# =============================================================================


# --- Butler: Authenticate ---
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
butler_name: jsonpath "$.name"
[Asserts]
jsonpath "$.token" isString
jsonpath "$.id" isString


# --- Researcher: Authenticate ---
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
researcher_name: jsonpath "$.name"
[Asserts]
jsonpath "$.token" isString
jsonpath "$.id" isString


# --- Butler: List channels ---
GET {{base_url}}/api/v1/channels/
Authorization: Bearer {{butler_token}}
HTTP 200
[Asserts]
jsonpath "$" count >= 1


# --- Researcher: List channels ---
GET {{base_url}}/api/v1/channels/
Authorization: Bearer {{researcher_token}}
HTTP 200
[Asserts]
jsonpath "$" count >= 1
