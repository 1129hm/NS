"""
Chatworkの「マイチャット」にテキストメッセージを送信するスクリプト。

必要な環境変数:
  CHATWORK_API_TOKEN : ChatworkのAPIトークン
"""

import os
import requests

ROOM_ID = "434416940"  # マイチャット
MESSAGES_URL = f"https://api.chatwork.com/v2/rooms/{ROOM_ID}/messages"

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


def send_chatwork_message(text: str) -> None:
    token = os.environ["CHATWORK_API_TOKEN"]

    for chunk in _split_text(text):
        resp = requests.post(
            MESSAGES_URL,
            headers={"X-ChatWorkToken": token},
            data={"body": f"【NS】{chunk}"},
            timeout=30,
        )
        resp.raise_for_status()


if __name__ == "__main__":
    send_chatwork_message("テスト送信です。この文章が届けば設定は成功です。")
