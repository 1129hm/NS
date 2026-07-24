"""
毎朝の配信をまとめて実行するエントリーポイント。
1. ニュース要約を取得
2. 今日のカレンダー予定を取得
3. LINEに1通のメッセージとして送信
"""

import datetime
from scripts.fetch_news import fetch_news_summary
from scripts.fetch_calendar import fetch_today_events_summary
from scripts.send_chatwork import send_chatwork_message


def build_message() -> str:
    jst = datetime.timezone(datetime.timedelta(hours=9))
    today_str = datetime.datetime.now(jst).strftime("%Y年%m月%d日(%a)")

    news = fetch_news_summary()
    schedule = fetch_today_events_summary()

    return (
        f"【{today_str} 朝のブリーフィング】\n\n"
        f"■本日の予定\n{schedule}\n\n"
        f"■ニュースまとめ\n{news}"
    )


def main() -> None:
    message = build_message()
    send_chatwork_message(message)
    print("送信完了")
    print(message)


if __name__ == "__main__":
    main()
