"""
LINE Messaging APIでテキストメッセージをブロードキャスト送信するスクリプト。
このBotを友だち追加している全員(=三幸さんご自身のみを想定)に送信されるため、
個別のユーザーIDを調べる必要がない。

必要な環境変数:
  LINE_CHANNEL_ACCESS_TOKEN : LINE Developersコンソールで発行するチャネルアクセストークン
"""

import os
import requests

BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"

# LINEの1メッセージあたりの文字数上限に合わせて分割する目安
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


def send_line_message(text: str) -> None:
    token = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]

    messages = [{"type": "text", "text": chunk} for chunk in _split_text(text)]

    # LINEの1回の配信で送れるメッセージは最大5件まで
    for i in range(0, len(messages), 5):
        batch = messages[i : i + 5]
        resp = requests.post(
            BROADCAST_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"messages": batch},
            timeout=30,
        )
        resp.raise_for_status()


if __name__ == "__main__":
    send_line_message("テスト送信です。この文章が届けば設定は成功です。")
