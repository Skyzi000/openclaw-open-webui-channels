# Changelog

## [0.5.0] - 2026-03-01

### Added

- **Multi-Account Support**: Configure multiple Open WebUI bot accounts per plugin instance, each with its own credentials, channel subscriptions, and settings. Backward-compatible with flat (single-account) config.
- **Per-Account `requireMention`**: Override `requireMention` at account level for fine-grained mention gating per bot.
- **Implicit Mention Detection**: Replying to a bot's message now counts as a mention, even without explicit @mention syntax.
- **Cross-Account Mention Gating**: When a message @mentions a specific bot, other bots in the same channel stay silent — even if they have `requireMention: false`.
- **Group Channel Context Injection**: In group channels, agents automatically receive delegation rules and a roster of available specialists with correct @mention syntax, enabling bot-to-bot delegation visible to all participants.
- **Mention Strip Patterns**: Added `mentions.stripPatterns` adapter to strip Open WebUI `<@U:USER_ID|Name>` syntax from message text before it reaches the agent.
- **HURL Integration Tests**: Test suites for auth, messaging basics, and E2E mention routing (`tests/`).

### Changed

- `listAccountIds` / `defaultAccountId` now read from `accounts` config object instead of returning hardcoded `"default"`.
- `setAccountEnabled` / `deleteAccount` operate per-account in multi-account mode.
- `resolveOpenWebUIAccount` falls back to first configured account when requested ID doesn't exist.

## [0.4.2] - 2026-02-18

### Fixed

- Stop leaking implicit `parentId` from thread context in handleAction send — Open WebUI hides messages with a `parent_id` that doesn't exist in the target channel
- Align package name (`@skyzi000/open-webui`) with plugin id for standard installation

## [0.4.1] - 2026-02-15

### Fixed

- Strip `open-webui:` prefix from channel target in sendText/sendMedia
- Use `createReplyDispatcherWithTyping` API for reply dispatch
- Throw when all media uploads fail with no text content to deliver

### Changed

- Point `docsPath` to GitHub README
- Remove metadata (`aliases`, `order`, `detailLabel`)

## [0.4.0] - 2026-02-12

### Added

- Dynamic `peer.kind` based on Open WebUI channel type (`standard` → channel, `group` → group, `dm` → dm)
- DM support: bypass `channelIds` filter and `requireMention` check (matching Discord plugin behavior)
- `ChatType` mapping (`direct` / `channel` / `group`)

### Breaking Changes

- **Session keys for Standard channels have changed.** `peer.kind` changed from the fixed value `"group"` to dynamic values (e.g. `"channel"`), so session history from v0.3.x will not carry over.

## [0.3.0] - 2026-02-11

### Added

- Thread session isolation: separate sessions per thread using `{channelId}:{parentId}`
- Thread parent context injection: inject parent message into agent context for threads
- Reaction support: add/remove reactions via `react` action
- Initial release: OpenClaw plugin for Open WebUI Channels integration
  - REST API & Socket.IO real-time communication
  - Bidirectional messaging with media support
  - Thread and typing indicator support
