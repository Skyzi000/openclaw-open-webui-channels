# Plan: Multi-Account & Mention Support for OpenWebUI Plugin

## Context
The OpenWebUI plugin currently supports only a single account (`listAccountIds: () => ["default"]`). Goals:
1. One dedicated Open WebUI user per OpenClaw agent → Multi-Account
2. Group channels where multiple bots are addressed via @mention

All changes affect **only the plugin** (`src/`). OpenClaw Core already supports both features natively.

---

## Step 1: Convert Config Structure to Multi-Account

**File:** `src/channel.ts`

Target config:
```yaml
channels:
  open-webui:
    # Base (shared) config
    baseUrl: "http://open-webui:8080"
    requireMention: true

    accounts:
      butler:
        email: "butler@local"
        password: "..."
        channelIds: ["uuid-1", "uuid-2"]
        name: "Butler"
      researcher:
        email: "researcher@local"
        password: "..."
        channelIds: ["uuid-2"]
        name: "Research Specialist"
```

Backward-compatible: Flat config (email/password at top level) → treated as `accounts.default`.

### Changes:
- `OpenWebUIAccountConfig` interface for per-account settings
- `resolveOpenWebUIAccount()`: Reads `channels.open-webui.accounts.<id>`, merges with base config
- `listAccountIds`: Reads keys from `accounts` object, fallback `["default"]`
- `defaultAccountId`: First configured account or `"default"`

---

## Step 2: Gateway Multi-Account Startup

**File:** `src/channel.ts`

Core calls `startAccount(ctx)` automatically per account ID. Already works because:
- `ctx.accountId` and `ctx.account` are set by Core
- `monitorOpenWebUIProvider()` receives the resolved account
- `socket.ts` connection pool keyed on `baseUrl:email` → separate connections per account
- `accountBotUserId` Map: Keyed per accountId
- `channelNameCache`: Keyed per `accountId:channelId`

---

## Step 3: Inbound Routing with Account ID

Already works:
- `ctxPayload.AccountId`: Already `account.accountId`
- `resolveAgentRoute()`: Already uses `accountId: account.accountId`

---

## Step 4: Mention Gating for Groups

### Changes:
- `mentions.stripPatterns` adapter: Strip `<@U:USER_ID|Name>` and `<@U:USER_ID>` syntax
- Implicit mention: Reply to bot's message → also counts as mention (fetches replied-to message, checks user_id)
- Plugin-side `requireMention` filtering remains (applies BEFORE dispatch)

---

## Step 5: Account Management

### Changes:
- `setAccountEnabled`: Set enabled/disabled per account (multi-account) or flat-config fallback
- `deleteAccount`: Delete per account; if last account → remove entire plugin config

---

## Step 6: Outbound Delivery

Already works — `sendText`/`sendMedia` receive `accountId` as parameter and use `resolveOpenWebUIAccount(cfg, accountId)`.

---

## Implemented In

| File | Change | Status |
|------|--------|--------|
| `src/channel.ts` | `OpenWebUIAccountConfig` interface | Done |
| `src/channel.ts` | `resolveOpenWebUIAccount()` → Multi-account config | Done |
| `src/channel.ts` | `listOpenWebUIAccountIds()` + `defaultOpenWebUIAccountId()` | Done |
| `src/channel.ts` | `mentions.stripPatterns` adapter | Done |
| `src/channel.ts` | Implicit mention (reply to bot) detection | Done |
| `src/channel.ts` | `setAccountEnabled` / `deleteAccount` per account | Done |
| `src/channel.ts` | `requireMention` overridable per account | Done |

No new files. No changes to `socket.ts`, `api.ts`, `runtime.ts`.

---

## Verification

1. **Config Test:** Flat config (backward-compatible) → Plugin starts with `default` account
2. **Multi-Account Test:** Configure two accounts → two Socket.IO connections, two bot user IDs in logs
3. **Mention Test:** Message without @mention in group channel → ignored. With @mention → processed
4. **Implicit Mention:** Reply to bot's message → processed (even without @mention)
5. **Cross-Account:** Message in channel where both bots are present, @mention only one → only that one responds
6. **Outbound:** Sub-agent delivery with correct `accountId` → correct bot posts

---

## Open / Future

### "Observe all, respond on mention" Mode
**Problem:** Currently `requireMention` filters messages completely — the agent never sees them. Desired: Agent reads along in the channel (all messages flow into session context) but only responds on @mention.

**Requires:** Core support for an `observeOnly`/`appendToSession` flag in the context payload that writes the message to session history without triggering an agent turn. Not implementable in the plugin alone without Core changes.

### Code Fix: `defaultAccountId` without hardcoded "default"
Core seems to internally expect `"default"` as account ID. `defaultOpenWebUIAccountId()` returns the first account, but Core may still query `"default"` directly. Investigate whether this is a Core issue or if the plugin can handle it.
