"""
Chatworkの「マイチャット」にテキストメッセージを送信するスクリプト。

必要な環境変数:
  CHATWORK_API_TOKEN : ChatworkのAPIトークン
"""

import os
import requests

MY_CHAT_ROOM_ID = "434416940"  # マイチャット
INFO_CHANNEL_ROOM_ID = "436582437"  # 【情報チャネル】
PERSONAL_ROOM_ID = "443042144"  # 「1129」(三幸秀稔との1対1)。
# 注意: stock_news.py(手動実行のみ、自動配信は停止済み)がこの定数を使うが、
# ここではCHATWORK_API_TOKEN(三幸秀稔自身のトークン)で送信するため、
# chatwork_relay.py経由(1129アカウントのトークンで送信)とは送信元が異なる。

# Chatworkの1メッセージあたりの文字数上限に合わせて分割する目安
MAX_LEN = 4500


def _split_text(text: str, max_len: int = MAX_LEN):
    chunks = []
    while len(text) > max_len:
        cut = text.rfind("\n", 0, max_len)
        if cut == -1:
            cut = max_len
        chunks.append(text[:cut])
        text = text[cut:]
    chunks.append(text)
    return chunks


def send_chatwork_message(text: str, room_id: str = MY_CHAT_ROOM_ID) -> None:
    token = os.environ["CHATWORK_API_TOKEN"]
    messages_url = f"https://api.chatwork.com/v2/rooms/{room_id}/messages"

    for chunk in _split_text(text):
        resp = requests.post(
            messages_url,
            headers={"X-ChatWorkToken": token},
            data={"body": f"【NS】{chunk}"},
            timeout=30,
        )
        resp.raise_for_status()


if __name__ == "__main__":
    send_chatwork_message("テスト送信です。この文章が届けば設定は成功です。")
