# Changelog

## [0.5.0] - 2026-03-23

### Added

- Live-edit streaming: stream agent replies by editing a single Open WebUI message in place as agent output accumulates — made possible by Open WebUI's lack of character limits and native message-edit support. Enable via `channels.open-webui.streaming.block.enabled: true`.
- Plugin-provided `blockStreamingCoalesceDefaults` (`minChars: 1500`, `idleMs: 1000`) tune how the channel core coalesces agent block chunks before each edit. Override via `channels.open-webui.streaming.block.coalesce`.
- Tool-kind payloads close the active stream cleanly before posting the tool message as a standalone reply, preserving the live-edit message in its last state.

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
