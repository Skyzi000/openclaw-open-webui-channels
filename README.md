# OpenClaw Open WebUI Channels Plugin

[🇯🇵 日本語版はこちら](README.ja.md)

A plugin that connects OpenClaw to Open WebUI Channels. Enables OpenClaw to act as a user within Open WebUI and engage in bidirectional communication in channels.

## Features

- 🔌 **Real-time Connection**: Instant message sending and receiving via REST API and Socket.IO
- 💬 **Bidirectional Messaging**: Supports both sending from OpenClaw and receiving from channels
- 📎 **Media Support**: Upload and download files and media
- 🧵 **Thread Support**: Handle threads and replies
- 👍 **Reactions**: Add and remove reactions on messages
- ⌨️ **Typing Indicator**: Display when OpenClaw is composing a reply
- ⚡ **Live-edit Streaming**: Agent replies appear incrementally by editing a single message in place as output accumulates. Enable with `channels.open-webui.streaming.block.enabled: true`
- 📊 **Rich Rendering**: Take advantage of Open WebUI's excellent Markdown support — tables, syntax-highlighted code blocks, LaTeX math, and more render beautifully compared to platforms like Discord

## Requirements

- OpenClaw
- Open WebUI with Channels feature enabled

## Installation

### Recommended: Ask OpenClaw

Tell OpenClaw:

```
https://github.com/skyzi000/openclaw-open-webui-channels
I want to use this plugin
```

OpenClaw will automatically clone the repository and install it.

### Manual Installation (Reference)

```bash
# Clone the repository
git clone https://github.com/skyzi000/openclaw-open-webui-channels.git

# Install to OpenClaw
openclaw plugins install ./openclaw-open-webui-channels
```

## Setup

### 1. Open WebUI Preparation

Create a dedicated bot user account on Open WebUI for this plugin:

1. Access Open WebUI
2. Add a new user via Admin Panel > Users > "+" button (e.g., `openclaw-bot@yourdomain.com`)
   - Open WebUI typically has email verification disabled, so non-existent email addresses work fine
3. Invite/add the created bot user to the channels you want OpenClaw to connect to
4. Note down the email address and password

> **💡 Tip**: Strongly recommended to create a dedicated bot account for OpenClaw rather than using a personal account.

### 2. OpenClaw Configuration

#### Method A: Ask OpenClaw (Recommended)

After installing the plugin, tell OpenClaw in a **secure chat environment** (WebUI, TUI, etc.):

```
I want to connect to Open WebUI Channels
```

OpenClaw will ask for the necessary information. Provide:

- **Base URL**: Open WebUI URL (e.g., `http://your-server:3000`)
- **Email**: Bot user email address
- **Password**: Bot user password
- **Channel IDs** (optional): Specific channel IDs to monitor (monitors all channels if omitted)

OpenClaw will automatically update the configuration file (`~/.openclaw/openclaw.json` in the `channels.open-webui` section) and restart as needed.

> **🔒 Security**: Contains authentication credentials, so configure in a secure chat environment that is not intercepted.

#### Method B: Manual Configuration

You can also directly edit `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "open-webui": {
      "enabled": true,
      "baseUrl": "http://your-server:3000",
      "email": "openclaw-bot@yourdomain.com",
      "password": "your-password",
      "channelIds": [],
      "requireMention": true
    }
  }
}
```

After configuration, restart OpenClaw:

```bash
openclaw gateway restart
```

### 3. Verification

After setup is complete, **mention the bot user by its username** in the connected Open WebUI channel (e.g., `@OpenClaw` if you named the user "OpenClaw") and send a message. If OpenClaw responds, the connection is successful.

## ⚠️ Important Notice

Sender control (allow lists, etc.) is not yet implemented. Anyone with access to the connected Open WebUI channel can send instructions to OpenClaw. Use this plugin only in channels accessible to trusted users.

## Usage

Once setup is complete, OpenClaw will monitor messages in the specified channels and respond to mentions.

### Basic Usage

- **Chat with OpenClaw**: Mention OpenClaw in the channel to talk
- **File Sending**: OpenClaw can send and receive images and files
- **Thread Support**: Conversations within threads are properly handled

## Troubleshooting

If you encounter issues, tell OpenClaw via another channel (WebUI, TUI, etc.):

```
The Open WebUI Channels plugin isn't working. Debug it
```

OpenClaw will automatically check logs and configuration to diagnose and fix the problem.

## License

MIT License - See [LICENSE](LICENSE) for details.

## Author

[Skyzi000](https://github.com/skyzi000)'s OpenClaw - This plugin was written by OpenClaw

## Links

- [GitHub Repository](https://github.com/skyzi000/openclaw-open-webui-channels)
- [Issues & Feature Requests](https://github.com/skyzi000/openclaw-open-webui-channels/issues)
- [OpenClaw Official Documentation](https://docs.openclaw.ai/)
