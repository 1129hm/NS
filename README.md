# Ponola 朝のブリーフィング自動配信

毎朝、①その日のGoogleカレンダーの予定 と ②人材紹介・人事労務・建設・不動産・
政治(トランプ動向含む)のニュース要約 を LINE に自動送信する仕組み。

GitHub Actionsが毎朝自動でこのリポジトリのコードを実行するので、PCの電源が
入っていなくても動作する。

## 全体の流れ

```
GitHub Actions (毎朝 日本時間7:00)
  → main.py 実行
    → scripts/fetch_calendar.py  … Googleカレンダーから今日の予定を取得
    → scripts/fetch_news.py      … Anthropic APIのweb検索でニュース要約を作成
    → scripts/send_line.py       … 上記をまとめてLINEにプッシュ送信
```

## 必要な準備(初回のみ)

### 1. Anthropic APIキー

1. https://console.anthropic.com にログイン(またはアカウント作成)
2. 「API Keys」からキーを発行
3. GitHubリポジトリの Secrets に `ANTHROPIC_API_KEY` として登録

### 2. LINE Messaging API

1. https://developers.line.biz/ja/ で LINE Developers アカウントを作成
2. 「プロバイダー」を作成 → その中に「Messaging API」チャネルを新規作成
   (これが通知専用の自分だけのLINE公式アカウントになる)
3. チャネル基本設定の「Messaging API設定」タブから
   **チャネルアクセストークン(長期)** を発行
   → GitHub Secrets に `LINE_CHANNEL_ACCESS_TOKEN` として登録
4. 発行したLINE公式アカウントのQRコードを、三幸さんご自身のLINEアプリで
   友だち追加する
5. 送信方式は「ブロードキャスト配信」(友だち全員に送る方式)を採用しているため、
   個別のユーザーIDを調べる必要はない。このBotを友だち追加しているのが
   三幸さんご自身だけであれば、実質的に個人向け通知として機能する

### 3. Googleカレンダー連携(OAuthリフレッシュトークン)

1. https://console.cloud.google.com で新規プロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **Google Calendar API** を有効化
3. 「認証情報」→「OAuthクライアントID」を作成(アプリケーションの種類:
   デスクトップアプリ)
   → `クライアントID` と `クライアントシークレット` を控える
4. 一度だけ手元でOAuth同意画面を通して **リフレッシュトークン** を取得する
   (このステップは一緒に進めます。取得用の小さなスクリプトを別途用意します)
5. GitHub Secrets に以下を登録:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `GOOGLE_CALENDAR_ID` (通常は `primary`)

### 4. GitHub Secretsへの登録方法(共通)

リポジトリページ → Settings → Secrets and variables → Actions →
「New repository secret」から、上記の名前で1つずつ登録する。

## 動作確認

1. リポジトリの「Actions」タブ → 「Morning Brief」を選択
2. 「Run workflow」ボタンで手動実行(`workflow_dispatch`が効いているため)
3. LINEにメッセージが届けば成功

## 配信時刻の変更

`.github/workflows/morning_brief.yml` 内の `cron: "0 22 * * *"` を変更する。
GitHub Actionsのcronは **UTC(協定世界時)** 基準のため、日本時間から9時間引いた
時刻を指定する(例: 日本時間8:00に送りたい場合は `0 23 * * *`)。

## ニュースのトピックを変更したい場合

`scripts/fetch_news.py` の `TOPICS` リストを編集する。
