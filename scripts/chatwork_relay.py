"""
ChatworkとGoogle Driveの間を中継するスクリプト。

Claude Routineの実行環境からはapi.chatwork.comへの直接アクセスが
組織ポリシーでブロックされているため、判断はClaude Routine(Google Driveの
読み書きまで)、Chatworkとの実際のやり取りはこのスクリプト(GitHub Actions上、
ネットワーク制限なし)が担う、という役割分担にしている。

やること:
  1. 受信ミラー: 監視対象ルームの新着メッセージ(NS自身の返信は除く)を
     Google Driveの受信箱フォルダに1件ずつ保存する(force=0の差分取得)。
     Claude Routine側はこのフォルダをポーリングして内容を読み取る。
  2. 経理ルームのスナップショット: 「経理」ルームの直近メッセージを
     まるごと1ファイルに保存し直す(force=1、月末締めルーティン用)。
  3. 送信: Google Driveの送信待ちフォルダにあるファイルをChatworkに投稿し、
     投稿できたファイルは削除する。Claude Routine側はここに返信ファイルを置く。
  4. 掃除: 受信箱の古いファイル(2日以上前)を削除し、肥大化を防ぐ。

必要な環境変数:
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REFRESH_TOKEN   (Driveスコープ付きで取得したもの)
  CHATWORK_API_TOKEN
"""

import os
import json
import datetime
import requests

TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_API_URL = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"

OUTBOX_FOLDER_ID = "14v1e48XwXAe18OB-6CNjf8BSuqWYJ4IZ"  # Chatwork送信待ち（NS用）
INBOX_FOLDER_ID = "1f7OgjQ7OClu6OYKBh-Iptcxay3DOwijN"  # Chatwork受信箱（NS用）
SNAPSHOT_FOLDER_ID = "1OOBa8kiJ6wcD3ophYR52z9wm2EwKsz8v"  # Chatworkスナップショット（NS用）

# 差分ミラー対象ルーム(NS Chatwork会話 / NS 入出金・労務チェックが利用)
WATCHED_ROOMS = {
    "443042144": "1129",
    "434768609": "売上管理用（閲覧用）",
    "434443620": "経理",
    "434443830": "成果報告",
}

# 全件スナップショット対象ルーム(NS 月末締め入出金まとめが利用)
KEIRI_ROOM_ID = "434443620"
KEIRI_SNAPSHOT_NAME = "keiri_snapshot.json"

NS_PREFIX = "【NS】"
INBOX_RETENTION_DAYS = 2

# 注意: ChatworkのforceパラメータはAPIトークン単位の共有カーソルを使っている。
# force=1(スナップショット取得)を呼ぶとforce=0の差分カーソルも進んでしまうため、
# このスクリプト以外(手動curlなど)で同じトークンのforce=0/1を呼ぶと、
# 次回のforce=0差分取得で新着メッセージを取りこぼす。デバッグ時は要注意。


def _get_access_token() -> str:
    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": os.environ["GOOGLE_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _list_folder_files(access_token: str, folder_id: str, extra_query: str = ""):
    q = f"'{folder_id}' in parents and trashed = false"
    if extra_query:
        q += f" and {extra_query}"
    resp = requests.get(
        DRIVE_API_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"q": q, "fields": "files(id, name, createdTime)"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("files", [])


def _download_file(access_token: str, file_id: str) -> str:
    resp = requests.get(
        f"{DRIVE_API_URL}/{file_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"alt": "media"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.text


def _delete_file(access_token: str, file_id: str) -> None:
    resp = requests.delete(
        f"{DRIVE_API_URL}/{file_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    resp.raise_for_status()


def _upload_json_file(access_token: str, folder_id: str, name: str, data) -> None:
    metadata = {"name": name, "parents": [folder_id], "mimeType": "application/json"}
    content = json.dumps(data, ensure_ascii=False)

    resp = requests.post(
        DRIVE_UPLOAD_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"uploadType": "multipart"},
        files={
            "metadata": (None, json.dumps(metadata), "application/json"),
            "file": (name, content, "application/json"),
        },
        timeout=30,
    )
    resp.raise_for_status()


def _get_chatwork_messages(room_id: str, force: int = 0):
    token = os.environ["CHATWORK_API_TOKEN"]
    resp = requests.get(
        f"https://api.chatwork.com/v2/rooms/{room_id}/messages",
        headers={"X-ChatWorkToken": token},
        params={"force": force},
        timeout=30,
    )
    resp.raise_for_status()
    if resp.status_code == 204 or not resp.text:
        # force=0で新着が0件のときChatworkは204(本文なし)を返す
        return []
    return resp.json()


def _post_to_chatwork(room_id: str, body: str) -> None:
    token = os.environ["CHATWORK_API_TOKEN"]
    resp = requests.post(
        f"https://api.chatwork.com/v2/rooms/{room_id}/messages",
        headers={"X-ChatWorkToken": token},
        data={"body": body},
        timeout=30,
    )
    resp.raise_for_status()


def relay_inbound_mirror(access_token: str) -> int:
    """監視対象ルームの新着メッセージ(NS自身の返信を除く)を受信箱に保存する。"""
    total = 0
    for room_id in WATCHED_ROOMS:
        messages = _get_chatwork_messages(room_id, force=0)
        new_messages = [m for m in messages if not m.get("body", "").startswith(NS_PREFIX)]

        for m in new_messages:
            ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%f")
            name = f"inbox_{room_id}_{m.get('message_id')}_{ts}.json"
            _upload_json_file(
                access_token,
                INBOX_FOLDER_ID,
                name,
                {
                    "room_id": room_id,
                    "room_name": WATCHED_ROOMS[room_id],
                    "message_id": m.get("message_id"),
                    "account_name": m.get("account", {}).get("name"),
                    "body": m.get("body"),
                    "send_time": m.get("send_time"),
                },
            )
            print(f"受信箱に保存: {name}")
            total += 1

    return total


def relay_keiri_snapshot(access_token: str) -> None:
    """経理ルームの直近メッセージ全件を1ファイルに保存し直す(月末締め用)。"""
    messages = _get_chatwork_messages(KEIRI_ROOM_ID, force=1)

    existing = _list_folder_files(
        access_token, SNAPSHOT_FOLDER_ID, extra_query=f"name = '{KEIRI_SNAPSHOT_NAME}'"
    )
    for f in existing:
        _delete_file(access_token, f["id"])

    _upload_json_file(access_token, SNAPSHOT_FOLDER_ID, KEIRI_SNAPSHOT_NAME, messages)
    print(f"経理ルームのスナップショットを更新({len(messages)}件)")


def relay_outbound(access_token: str) -> int:
    """送信待ちフォルダにあるファイルをChatworkに投稿し、削除する。"""
    files = _list_folder_files(access_token, OUTBOX_FOLDER_ID)

    for f in files:
        content = _download_file(access_token, f["id"])
        data = json.loads(content)
        room_id = str(data["room_id"])
        body = data["body"]

        _post_to_chatwork(room_id, body)
        _delete_file(access_token, f["id"])
        print(f"送信完了: {f['name']} -> room {room_id}")

    return len(files)


def cleanup_old_inbox_files(access_token: str) -> int:
    """受信箱の古いファイル(INBOX_RETENTION_DAYS日以上前)を削除する。"""
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        days=INBOX_RETENTION_DAYS
    )
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S")
    files = _list_folder_files(
        access_token, INBOX_FOLDER_ID, extra_query=f"createdTime < '{cutoff_str}'"
    )
    for f in files:
        _delete_file(access_token, f["id"])
    return len(files)


def main() -> None:
    access_token = _get_access_token()

    inbound_count = relay_inbound_mirror(access_token)
    relay_keiri_snapshot(access_token)
    outbound_count = relay_outbound(access_token)
    cleaned_count = cleanup_old_inbox_files(access_token)

    print(
        f"受信ミラー: {inbound_count}件, 送信: {outbound_count}件, "
        f"受信箱の古いファイル削除: {cleaned_count}件"
    )


if __name__ == "__main__":
    main()
