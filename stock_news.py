"""
株式市場の動向を1日数回(朝・日中・夜)配信するエントリーポイント。
1. 株式ニュース要約を取得
2. Chatworkの「1129」(三幸さん個人チャット)に送信
"""

import datetime
from scripts.fetch_stock_news import fetch_stock_news_summary
from scripts.send_chatwork import send_chatwork_message, PERSONAL_ROOM_ID


def build_message() -> str:
    jst = datetime.timezone(datetime.timedelta(hours=9))
    now_str = datetime.datetime.now(jst).strftime("%Y年%m月%d日(%a) %H:%M")

    news = fetch_stock_news_summary()

    return f"【{now_str} 株式マーケット情報】\n\n{news}"


def main() -> None:
    message = build_message()
    send_chatwork_message(message, room_id=PERSONAL_ROOM_ID)
    print("送信完了")
    print(message)


if __name__ == "__main__":
    main()
