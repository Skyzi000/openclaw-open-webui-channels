# OpenClaw Open WebUI Channels プラグイン

[🇬🇧 English](README.md)

OpenClawを、Open WebUIのチャンネルに接続するプラグインです。OpenClawがOpen WebUI上のユーザーとして振る舞い、チャンネル内で双方向のコミュニケーションを行えるようにします。

## 特徴

- 🔌 **リアルタイム接続**: REST APIとSocket.IOによる即座のメッセージ送受信
- 💬 **双方向メッセージング**: OpenClawからの送信とチャンネルからの受信の両方に対応
- 📎 **メディア対応**: ファイルやメディアのアップロード・ダウンロードをサポート
- 🧵 **スレッド対応**: スレッドやリプライでのやり取りをサポート
- 👍 **リアクション対応**: メッセージへのリアクションの追加・削除をサポート
- ⌨️ **タイピングインジケーター**: OpenClawが返信を作成中であることを表示
- ⚡ **ライブ編集ストリーミング**: エージェントの出力に合わせて単一メッセージを逐次編集更新します。`channels.open-webui.streaming.block.enabled: true` で有効化
- 📊 **リッチな表示**: Open WebUIの優れたMarkdownサポートを活用 — テーブル、シンタックスハイライト付きコードブロック、LaTeX数式などがDiscord等と比べて美しく表示されます

## 必要環境

- OpenClaw
- Channels機能が有効なOpen WebUI

## インストール

### 推奨: OpenClawに依頼する

OpenClawに以下のように伝えてください：

```
https://github.com/skyzi000/openclaw-open-webui-channels
このプラグインを使いたい
```

OpenClawが自動的にリポジトリをクローンしてインストールしてくれます。

### 手動でインストール（参考）

```bash
# リポジトリをクローン
git clone https://github.com/skyzi000/openclaw-open-webui-channels.git

# OpenClawにインストール
openclaw plugins install ./openclaw-open-webui-channels
```

## セットアップ

### 1. Open WebUI側の準備

Open WebUI上でこのプラグイン専用のボットユーザーアカウントを作成します：

1. Open WebUIにアクセス
2. 管理者パネル > ユーザー の「＋」ボタンで新規ユーザーを追加（例: `openclaw-bot@yourdomain.com`）
   - Open WebUIは通常メール認証が無効なので、実在しないメールアドレスでも構いません
3. 作成したボットユーザーを、OpenClawに接続させたいチャンネルに招待/追加
4. メールアドレスとパスワードをメモしておく

> **💡 ヒント**: 個人アカウントを使用せず、OpenClaw専用のボットアカウントを作成することを強く推奨します。

### 2. OpenClaw側の設定

#### 方法A: OpenClawに依頼（推奨）

プラグインをインストール後、**安全なチャット環境**（WebUI、TUI等）でOpenClawに以下のように伝えてください：

```
Open WebUIのChannelsに接続したい
```

OpenClawが必要な情報を順次質問してくるので、以下の情報を伝えます：

- **Base URL**: Open WebUIのURL（例: `http://your-server:3000`）
- **Email**: 作成したボットユーザーのメールアドレス
- **Password**: ボットユーザーのパスワード
- **Channel IDs**（オプション）: 監視したい特定のチャンネルID（省略すると全チャンネルを監視）

OpenClawが自動的に設定ファイル（`~/.openclaw/openclaw.json` の `channels.open-webui` セクション）を更新し、必要に応じて再起動します。

> **🔒 セキュリティ**: 認証情報を含むため、盗聴されないチャット環境で設定することを推奨します。

#### 方法B: 手動設定

`~/.openclaw/openclaw.json` を直接編集して設定することもできます：

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

設定後、OpenClawを再起動してください：

```bash
openclaw gateway restart
```

### 3. 動作確認

設定完了後、Open WebUIの接続したチャンネルで**作成したボットユーザーの名前をメンション**してメッセージを送信してみてください（例: ユーザー名を「OpenClaw」にした場合は `@OpenClaw`）。OpenClawが応答すれば接続成功です。

## ⚠️ 注意事項

現時点では送信者制御（許可リスト等）は未実装です。接続したOpen WebUIチャンネルにアクセスできるユーザーは誰でもOpenClawに指示を送ることができます。信頼できるユーザーのみがアクセスできるチャンネルで使用してください。

## 使い方

セットアップが完了すると、OpenClawは指定したチャンネルでメッセージを監視し、メンションに応答します。

### 基本的な使い方

- **OpenClawと会話**: チャンネル内でOpenClawをメンションして話しかける
- **ファイル送信**: OpenClawは画像やファイルを送信・受信できます
- **スレッド対応**: スレッド内での会話も適切に処理されます

## トラブルシューティング

問題が発生した場合は、OpenClawに別の経路（WebUI、TUI等）で以下のように伝えてください：

```
Open WebUIのChannelsプラグインが動かない。デバッグして
```

OpenClawが自動的にログや設定を確認し、問題を診断・修正してくれます。

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE)を参照してください。

## 作者

[Skyzi000](https://github.com/skyzi000)'s OpenClaw - このプラグインはOpenClawによって書かれました

## リンク

- [GitHubリポジトリ](https://github.com/skyzi000/openclaw-open-webui-channels)
- [問題報告・機能要望](https://github.com/skyzi000/openclaw-open-webui-channels/issues)
- [OpenClaw公式ドキュメント](https://docs.openclaw.ai/)
