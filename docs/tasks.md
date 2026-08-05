# 定期タスク一覧

NSが担っている定期実行タスクの現状（2026-08-05 更新時点）。増減があったら都度ここを更新する（月1回の棚卸しの起点にする）。

## 全体構成

Claude Routine（claude.ai/code/routines）はクラウドサンドボックスで動くため、`api.chatwork.com`や`api.line.me`への直接アクセスができない。そのため、Chatwork・LINEとのやり取りは、どちらも **Cloudflare Workerを中継役にして直接curlで呼ぶ** 方式に統一されている(Google Drive・GitHub Actions経由の中継は2026-08-05に廃止)。

```
Claude Routine ──(Bashからcurlで直接呼ぶ)──> Cloudflare Worker ──> Chatwork / LINE API
```

- Chatwork用: `ns-chatwork-relay.m-hidetoshi1129.workers.dev` (`/send`, `/messages`)
- LINE用: `ns-line-relay.m-hidetoshi1129.workers.dev` (`/push`、Webhook受信)

どちらもCloudflareの同一アカウント(m.hidetoshi1129@gmail.com)上のWorker。コードは`cloudflare/`フォルダに保存(デプロイはCloudflareダッシュボードから手動)。

**経緯**: 当初はGoogle Drive経由(Claude RoutineがDriveに書き込み→GitHub Actionsが15分おきにポーリングしてChatworkへ)だったが、①GitHub Actionsのscheduleが数時間〜半日遅延する、②2026-08-03頃からGitHub ActionsからのChatwork APIアクセス自体が403 Forbiddenで拒否されるようになった、という2つの問題が発生。LINE中継(`ns-line-relay`)が既にCloudflare Worker経由で問題なく動いていたため、同じ方式に統一した。

### 三幸さんが持つ3つのChatworkアカウント(2026-08-04時点で整理)

NS関連の通知・会話には、三幸さんの3つのChatworkアカウントが登場する。それぞれ役割が違うので混同しないこと。

| アカウント | ログインメール | 役割 |
|---|---|---|
| 三幸秀稔 | h.miyuki@ponola-inc.com | 普段使っている本人アカウント。経理・情報チャネル等の業務ルームのメンバー。**通知の受け手** |
| 1129 | m.hidetoshi1129@gmail.com | NSの一般的な右腕業務(メール下書き完了・予定通知・Chatwork会話・経理/労務チェック・月末まとめ)専用の送り手アカウント |
| 株NS | h.miyuki1129@icloud.com | 株関連レポート(kabu-check-*)専用の送り手アカウント |

「1129」「株NS」それぞれが三幸秀稔と1対1DMを持っており(room_id 443042144 / 443123712、これはどちらの側から見ても同じ番号)、`ns-chatwork-relay` Workerはこの2つのroom_id宛てだけ、相手アカウント自身のトークン(`token_key`: `1129` / `kabuns`)で送信する(三幸秀稔からは新着メッセージとして届く)。それ以外の業務ルーム(経理・情報チャネル等)は、これまで通り三幸秀稔アカウントのトークン(`token_key`: `main`、省略時のデフォルト)で読み書きする。

**経緯**: 当初は三幸秀稔アカウント自身のトークンで「1129」宛てに送信していたため、三幸秀稔から見ると「自分が送ったメッセージ」にしか見えず、通知に気づきにくい状態だった(2026-08-03に三幸さんが「1129」に初めてログインし、メッセージが溜まっていることに気づいて発覚)。

## GitHub Actions（このリポジトリのワークフロー）

すべて手動実行(workflow_dispatch)のみで、自動配信は行っていない。

| ワークフロー | 停止理由 |
|---|---|
| Morning Brief (`morning_brief.yml`) | 2026-07-28停止。GitHub Actionsの`schedule`が数時間〜半日遅延する問題があり、Claude Routine版`news-info-channel-0700-jst`に置き換え |
| Stock News (`stock_news.yml`) | 2026-07-23停止。Claude Routine版`kabu-check-*`と内容・時間帯が重複していたため |
| Chatwork Relay (`chatwork_relay.yml`) | 2026-08-05停止。2026-08-03頃からGitHub ActionsのIPからのChatwork APIアクセスが403 Forbiddenで拒否されるようになり、中継が機能しなくなった。Cloudflare Worker(`ns-chatwork-relay`)経由の直接アクセスに置き換え |

> 補足: GitHub Actionsの`schedule`は混雑時の遅延に加え、2026-08-03頃からChatwork APIへのアクセス自体が403でブロックされる事象が発生した(原因未特定。GitHub Actionsの共有IPが何らかの理由でChatwork側に弾かれた可能性)。この経験から、**外部APIとの定期的なやり取りはGitHub Actionsではなく、Cloudflare Worker経由でClaude Routineから直接呼ぶ方式を基本とする**。

## Claude Routine（claude.ai/code/routines、10個）

### 通知系(読み取り専用レポート)

| ルーティン名 | 実行タイミング | 内容 | 送信先 |
|---|---|---|---|
| NS 朝の予定通知 | 毎日 7:00(JST) | 当日のGoogleカレンダー予定を通知 | 1129→三幸秀稔(DM) |
| news-info-channel-0700-jst | 毎日 7:00(JST) | 人材/人事労務/AI/建設/不動産/政治などのニュース要約(旧Morning Brief) | Chatwork「【情報チャネル】」(グループ) |
| kabu-check-morning-7am-jst | 平日 7:00(JST) | 米国市況・為替の朝レポート(初心者向け、翌日3択予想付き) | 株NS→三幸秀稔(DM) |
| kabu-check-jpclose-1530-jst | 平日 15:30(JST) | 日経平均終値レポート(理解度チェッククイズ付き) | 株NS→三幸秀稔(DM) |
| kabu-check-usopen-2300-jst | 平日 23:00(JST) | 米国市場寄り付き速報 | 株NS→三幸秀稔(DM) |

### 判断・対話系(右腕業務。下書き作成・仮予定登録まで。送信・確定は三幸さんが行う)

| ルーティン名 | 実行タイミング | 内容 |
|---|---|---|
| NS Email Triage | 平日 9:00〜19:00(JST)、毎時 | 未読メールを確認し、返信が必要そうなものだけGmail下書きを作成。`NS/確認済み`ラベルで二重処理を防止。新規下書きがある時だけ1129→三幸秀稔(DM)に通知 |
| NS Chatwork会話 | 毎日 9:00〜19:00(JST)、毎時 | 三幸秀稔から1129とのDMに届いた新着メッセージに反応し、日程確認・メール下書き・仮予定登録をして1129→三幸秀稔(DM)で返信 |
| NS LINE会話 | LINEでメッセージを送るたびに起動(Webhookトリガー。cronは年1回のダミー) | LINEアプリからの話しかけに対応。Chatwork系とは独立した経路(Cloudflare Worker経由) |

### 経理・労務系(集計・指摘のみ。送金や書類編集などの実行操作はしない)

| ルーティン名 | 実行タイミング | 内容 |
|---|---|---|
| NS 入出金・労務チェック | 平日 9:00〜19:00(JST)、毎時 | Chatwork3ルーム+Driveのバックオフィスフォルダを確認し、入出金情報や労務書類の記入漏れがあれば1129→三幸秀稔(DM)に通知(なければ通知なし) |
| NS 月末締め入出金まとめ | 毎月25〜31日 9:00(JST)に判定 → 月末2営業日前だけ実行 | Chatwork「経理」ルームと請求書PDFを照合し、出金予定・入金予定をCSVにまとめて1129→三幸秀稔(DM)に報告 |

## 権限拡張の方針

1. 情報収集・通知系 ✅ 完了
2. 確認・整理系(メール下書き・Chatwork/LINE対話・日程調整) ✅ 進行中
3. 判断が絡む系(経理データ集計、請求書管理) — 金額を扱うため、当面は「NSが下書き・集計を作り、三幸さんが最終確認して実行する」形に留める(送金など実行系は行わない)

## 秘密情報の登録場所(値はここに書かない)

**GitHub Secrets**(リポジトリ Settings → Secrets and variables → Actions。現在は`chatwork_relay.yml`が手動実行のみなので実質未使用、他の停止済みワークフロー用に残置):
- `CHATWORK_API_TOKEN` / `CHATWORK_API_TOKEN_1129` / `CHATWORK_API_TOKEN_KABUNS`
- `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `LINE_CHANNEL_ACCESS_TOKEN`

**Cloudflare Worker `ns-chatwork-relay` のsecret**(Cloudflareダッシュボード → 該当Worker → Settings → Variables and Secrets。**これが現在の本番経路**):
- `RELAY_SECRET`: このWorker自体への認証用トークン(Claude Routineのプロンプト内にも埋め込まれている)
- `CHATWORK_API_TOKEN` / `CHATWORK_API_TOKEN_1129` / `CHATWORK_API_TOKEN_KABUNS`: 上記GitHub Secretsと同じ値

**Cloudflare Worker `ns-line-relay` のsecret**: `LINE_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `ROUTINE_URL`, `ROUTINE_TOKEN`(既存、今回変更なし)

## 棚卸しメモ

- 2026-08-05: GitHub ActionsからのChatwork APIアクセスが403で拒否される問題を受け、Chatwork中継をGoogle Drive+GitHub Actions方式からCloudflare Worker(`ns-chatwork-relay`、LINE中継と同じ設計)経由の直接方式に全面移行。対象ルーティン9個すべてのプロンプトを更新し、`chatwork_relay.yml`の自動配信を停止。ルーティンからのGoogle Drive依存も、Chatwork中継目的だった分は不要になった(バックオフィス確認・請求書PDF読み取りなど本来の用途のみ残る)
- 2026-08-04: 通知の送信元アカウントを整理。「1129」「株NS」それぞれ専用のChatworkトークンを取得し、三幸秀稔への1対1DM(room_id 443042144/443123712)はそのアカウント自身のトークンで送信するよう修正。kabu-check-*3本の送信先を株NSとのDM(443123712)に変更
- 2026-07-22: NS Email Triageを新規作成(LINE直送方式)
- 2026-07-23〜24: 別セッションでの作業により、Chatwork連携・株式レポート・経理/労務チェック・LINE会話機能などが追加。通知の主経路がLINEからChatworkへ移行
- 2026-07-23: 棚卸しを実施。以下を解消
  - 株ニュースの二重送信(`stock_news.yml`の自動配信を停止し、Claude Routine版`kabu-check-*`に一本化)
  - テスト用ルーティン`NS_TEST_delete_me`(Chatworkトークンが平文で残存)と`接続調査_webhook`を削除、Chatworkトークンをローテーション
- 2026-07-28: 「情報チャネル」へのニュースが実質届いていない(数時間〜半日遅延)問題を調査。GitHub Actionsの`schedule`遅延が原因と判明し、`news-info-channel-0700-jst`(Claude Routine)に置き換え、`morning_brief.yml`の自動配信を停止
- 最終更新: 2026-08-05
- 次回棚卸し目安: 2026-09-05ごろ(月1回、稼働中タスクの重複・放置がないか確認)
