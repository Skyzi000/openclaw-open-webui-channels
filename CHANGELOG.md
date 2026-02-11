# Changelog

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
