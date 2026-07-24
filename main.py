"""
毎朝のニュース配信を実行するエントリーポイント。
1. ニュース要約を取得
2. Chatworkの「【情報チャネル】」に送信

(本日の予定は、Google Calendar/Gmailの権限をすでに持つClaude側の
ルーティン「NS 朝の予定メール」がGmail下書きとして作成する形に分離した)
"""

import datetime
from scripts.fetch_news import fetch_news_summary
from scripts.send_chatwork import send_chatwork_message, INFO_CHANNEL_ROOM_ID


def build_message() -> str:
    jst = datetime.timezone(datetime.timedelta(hours=9))
    today_str = datetime.datetime.now(jst).strftime("%Y年%m月%d日(%a)")

    news = fetch_news_summary()

    return f"【{today_str} 朝のニュースまとめ】\n\n{news}"


def main() -> None:
    message = build_message()
    send_chatwork_message(message, room_id=INFO_CHANNEL_ROOM_ID)
    print("送信完了")
    print(message)


if __name__ == "__main__":
    main()
