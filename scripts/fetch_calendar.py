"""
Googleカレンダーから「今日の予定」を取得するスクリプト。
OAuth2のリフレッシュトークン方式を使う(一度だけ手元でトークンを取得しておけば、
以降はGitHub Actions上で自動更新して使える)。

必要な環境変数:
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REFRESH_TOKEN
  GOOGLE_CALENDAR_ID   (通常は "primary" でOK)
"""

import os
import datetime
import requests

TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"


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


def fetch_today_events_summary() -> str:
    access_token = _get_access_token()
    calendar_id = os.environ.get("GOOGLE_CALENDAR_ID", "primary")

    # 日本時間の「今日」の範囲を計算(JST = UTC+9)
    jst = datetime.timezone(datetime.timedelta(hours=9))
    now_jst = datetime.datetime.now(jst)
    start_of_day = now_jst.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + datetime.timedelta(days=1)

    resp = requests.get(
        CALENDAR_API_URL.format(calendar_id=calendar_id),
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "timeMin": start_of_day.isoformat(),
            "timeMax": end_of_day.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
        },
        timeout=30,
    )
    resp.raise_for_status()
    events = resp.json().get("items", [])

    if not events:
        return "本日の予定はありません。"

    lines = []
    for ev in events:
        start = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date")
        summary = ev.get("summary", "(タイトルなし)")
        # 時刻部分だけ取り出す(終日予定の場合はそのまま)
        time_label = start
        if start and "T" in start:
            time_label = start.split("T")[1][:5]
        lines.append(f"- {time_label} {summary}")

    return "\n".join(lines)


if __name__ == "__main__":
    print(fetch_today_events_summary())
