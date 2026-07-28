# 定期タスク一覧

NSが担っている定期実行タスクの現状（2026-07-28 更新時点）。増減があったら都度ここを更新する（月1回の棚卸しの起点にする）。

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
                                                                    ▼
                                                              Chatwork「1129」
```

LINEだけは例外で、`NS LINE会話`のみ専用のCloudflare Worker（`ns-line-relay.m-hidetoshi1129.workers.dev`）経由で直接やり取りする、独立した経路。

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
| NS 朝の予定通知 | 毎日 7:00(JST) | 当日のGoogleカレンダー予定を通知 | Chatwork「1129」 |
| news-info-channel-0700-jst | 毎日 7:00(JST) | 人材/人事労務/AI/建設/不動産/政治などのニュース要約(旧Morning Brief) | Chatwork「【情報チャネル】」 |
| kabu-check-morning-7am-jst | 平日 7:00(JST) | 米国市況・為替の朝レポート(初心者向け、翌日3択予想付き) | Chatwork「1129」 |
| kabu-check-jpclose-1530-jst | 平日 15:30(JST) | 日経平均終値レポート(理解度チェッククイズ付き) | Chatwork「1129」 |
| kabu-check-usopen-2300-jst | 平日 23:00(JST) | 米国市場寄り付き速報 | Chatwork「1129」 |

### 判断・対話系(右腕業務。下書き作成・仮予定登録まで。送信・確定は三幸さんが行う)

| ルーティン名 | 実行タイミング | 内容 |
|---|---|---|
| NS Email Triage | 平日 9:00〜19:00(JST)、毎時 | 未読メールを確認し、返信が必要そうなものだけGmail下書きを作成。`NS/確認済み`ラベルで二重処理を防止。新規下書きがある時だけChatworkに通知 |
| NS Chatwork会話 | 毎日 9:00〜19:00(JST)、毎時 | Chatwork「1129」への新着メッセージに反応し、日程確認・メール下書き・仮予定登録をして返信 |
| NS LINE会話 | LINEでメッセージを送るたびに起動(Webhookトリガー。cronは年1回のダミー) | LINEアプリからの話しかけに対応。Chatwork系とは独立した経路(Cloudflare Worker経由) |

### 経理・労務系(集計・指摘のみ。送金や書類編集などの実行操作はしない)

| ルーティン名 | 実行タイミング | 内容 |
|---|---|---|
| NS 入出金・労務チェック | 平日 9:00〜19:00(JST)、毎時 | Chatwork3ルーム+Driveのバックオフィスフォルダを確認し、入出金情報や労務書類の記入漏れがあれば通知(なければ通知なし) |
| NS 月末締め入出金まとめ | 毎月25〜31日 9:00(JST)に判定 → 月末2営業日前だけ実行 | Chatwork「経理」ルームと請求書PDFを照合し、出金予定・入金予定をCSVにまとめて報告 |

## 権限拡張の方針

1. 情報収集・通知系 ✅ 完了
2. 確認・整理系(メール下書き・Chatwork/LINE対話・日程調整) ✅ 進行中
3. 判断が絡む系(経理データ集計、請求書管理) — 金額を扱うため、当面は「NSが下書き・集計を作り、三幸さんが最終確認して実行する」形に留める(送金など実行系は行わない)

## 棚卸しメモ

- 2026-07-22: NS Email Triageを新規作成(LINE直送方式)
- 2026-07-23〜24: 別セッションでの作業により、Chatwork連携・株式レポート・経理/労務チェック・LINE会話機能などが追加。通知の主経路がLINEからChatworkへ移行
- 2026-07-23: 棚卸しを実施。以下を解消
  - 株ニュースの二重送信(`stock_news.yml`の自動配信を停止し、Claude Routine版`kabu-check-*`に一本化)
  - テスト用ルーティン`NS_TEST_delete_me`(Chatworkトークンが平文で残存)と`接続調査_webhook`を削除、Chatworkトークンをローテーション
- 2026-07-28: 「情報チャネル」へのニュースが実質届いていない(数時間〜半日遅延)問題を調査。GitHub Actionsの`schedule`遅延が原因と判明し、`news-info-channel-0700-jst`(Claude Routine)に置き換え、`morning_brief.yml`の自動配信を停止
- 最終更新: 2026-07-28
- 次回棚卸し目安: 2026-08-28ごろ(月1回、稼働中タスクの重複・放置がないか確認)
