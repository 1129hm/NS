# 定期タスク一覧

NSが担っている定期実行タスクの現状（2026-08-04 更新時点）。増減があったら都度ここを更新する（月1回の棚卸しの起点にする）。

## 全体構成

Claude Routine（claude.ai/code/routines）はクラウドサンドボックスで動くため、`api.chatwork.com`や`api.line.me`への直接アクセスができない。そのため、Chatworkとのやり取りはすべて **Google Driveを中継地点** にして行う方式に統一されている。

```
Claude Routine ──(Driveの送信待ち/受信箱フォルダを読み書き)──> Google Drive
                                                                    │
                                              15分おきにポーリング  │
                                                                    ▼
                                          GitHub Actions「Chatwork Relay」
                                          (scripts/chatwork_relay.py)
                                                                    │
                                          送信先room_idに応じてトークンを切替 │
                                                                    ▼
                                                    Chatwork(下記3アカウント参照)
```

LINEだけは例外で、`NS LINE会話`のみ専用のCloudflare Worker（`ns-line-relay.m-hidetoshi1129.workers.dev`）経由で直接やり取りする、独立した経路。

### 三幸さんが持つ3つのChatworkアカウント(2026-08-04時点で整理)

NS関連の通知・会話には、三幸さんの3つのChatworkアカウントが登場する。それぞれ役割が違うので混同しないこと。

| アカウント | ログインメール | 役割 |
|---|---|---|
| 三幸秀稔 | h.miyuki@ponola-inc.com | 普段使っている本人アカウント。経理・情報チャネル等の業務ルームのメンバー。**通知の受け手** |
| 1129 | m.hidetoshi1129@gmail.com | NSの一般的な右腕業務(メール下書き完了・予定通知・Chatwork会話・経理/労務チェック・月末まとめ)専用の送り手アカウント |
| 株NS | h.miyuki1129@icloud.com | 株関連レポート(kabu-check-*)専用の送り手アカウント |

「1129」「株NS」それぞれが三幸秀稔と1対1DMを持っており(room_id 443042144 / 443123712、これはどちらの側から見ても同じ番号)、`chatwork_relay.py`はこの2つのroom_id宛てだけ、相手アカウント自身のトークンで送信する(三幸秀稔からは新着メッセージとして届く)。それ以外の業務ルーム(経理・情報チャネル等)は、これまで通り三幸秀稔アカウントのトークンで読み書きする。

**経緯**: 当初は三幸秀稔アカウント自身のトークンで「1129」宛てに送信していたため、三幸秀稔から見ると「自分が送ったメッセージ」にしか見えず、通知に気づきにくい状態だった(2026-08-03に三幸さんが「1129」に初めてログインし、メッセージが溜まっていることに気づいて発覚)。

## GitHub Actions（このリポジトリのワークフロー）

| ワークフロー | 実行タイミング | 内容 |
|---|---|---|
| Morning Brief (`morning_brief.yml`) | 手動実行のみ(2026-07-28に自動配信を停止) | ニュース要約をChatwork「【情報チャネル】」へ配信(`main.py`/`send_chatwork.py`)。GitHub Actionsの`schedule`が数時間〜半日単位で遅延する問題が見つかり、Claude Routine版`news-info-channel-0700-jst`に置き換えたため停止 |
| Stock News (`stock_news.yml`) | 手動実行のみ(2026-07-23に自動配信を停止) | 株ニュースをChatworkへ。Claude Routine版`kabu-check-*`と内容・時間帯が重複していたため停止 |
| Chatwork Relay (`chatwork_relay.yml`) | 15分おき | Drive⇔Chatworkの中継(受信ミラー・経理スナップショット・送信・古いファイル掃除)。他のほぼ全ルーティンの基盤 |

> 補足: GitHub Actionsの`schedule`トリガーは混雑状況により実行が大きく遅延することがある(実測で数時間〜半日程度)。時間の正確さが重要な定期配信は、Claude Routine側に寄せる方針とする(実測ではおよそ10〜15分程度のズレに収まっている)。

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

GitHub Secrets(リポジトリ Settings → Secrets and variables → Actions)に登録:
- `CHATWORK_API_TOKEN`: 三幸秀稔アカウント自身のトークン(経理・情報チャネル等の業務ルーム用)
- `CHATWORK_API_TOKEN_1129`: 1129アカウントのトークン(三幸秀稔への一般通知用)
- `CHATWORK_API_TOKEN_KABUNS`: 株NSアカウントのトークン(三幸秀稔への株レポート用)
- `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `LINE_CHANNEL_ACCESS_TOKEN`(現在未使用、morning_brief.ymlの旧LINE直送機能用に残置)

## 棚卸しメモ

- 2026-08-04: 通知の送信元アカウントを整理。「1129」「株NS」それぞれ専用のChatworkトークンを取得し、三幸秀稔への1対1DM(room_id 443042144/443123712)はそのアカウント自身のトークンで送信するよう`chatwork_relay.py`を修正。kabu-check-*3本の送信先を株NSとのDM(443123712)に変更
- 2026-07-22: NS Email Triageを新規作成(LINE直送方式)
- 2026-07-23〜24: 別セッションでの作業により、Chatwork連携・株式レポート・経理/労務チェック・LINE会話機能などが追加。通知の主経路がLINEからChatworkへ移行
- 2026-07-23: 棚卸しを実施。以下を解消
  - 株ニュースの二重送信(`stock_news.yml`の自動配信を停止し、Claude Routine版`kabu-check-*`に一本化)
  - テスト用ルーティン`NS_TEST_delete_me`(Chatworkトークンが平文で残存)と`接続調査_webhook`を削除、Chatworkトークンをローテーション
- 2026-07-28: 「情報チャネル」へのニュースが実質届いていない(数時間〜半日遅延)問題を調査。GitHub Actionsの`schedule`遅延が原因と判明し、`news-info-channel-0700-jst`(Claude Routine)に置き換え、`morning_brief.yml`の自動配信を停止
- 最終更新: 2026-08-04
- 次回棚卸し目安: 2026-09-04ごろ(月1回、稼働中タスクの重複・放置がないか確認)
