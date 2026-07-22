"""
Googleカレンダーのリフレッシュトークンを取得するためのスクリプト。
これは自分のMacで「一度だけ」実行するもの。GitHub Actions側では使わない。

事前準備:
  1. Google Cloud Console (https://console.cloud.google.com) でプロジェクトを作成
  2. 「APIとサービス」→「ライブラリ」で Google Calendar API を有効化
  3. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」
     → アプリケーションの種類は「デスクトップアプリ」を選択
  4. 作成後にダウンロードできる JSON ファイルを
     このファイルと同じフォルダに `credentials.json` という名前で置く

実行方法(ターミナルで):
  pip install google-auth-oauthlib
  python setup/get_refresh_token.py

実行するとブラウザが開き、Googleアカウントでのログインと権限の許可を求められる。
許可すると、ターミナルに「リフレッシュトークン」が表示されるので、それを
GitHub Secretsの GOOGLE_REFRESH_TOKEN に登録する。
credentials.json の中の client_id / client_secret も、それぞれ
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET として登録する。
"""

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]


def main():
    flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
    # ローカルでブラウザを自動的に開いて認証する
    creds = flow.run_local_server(port=0)

    print("\n" + "=" * 60)
    print("取得できました。以下をそれぞれGitHub Secretsに登録してください。")
    print("=" * 60)
    print(f"GOOGLE_CLIENT_ID     = {creds.client_id}")
    print(f"GOOGLE_CLIENT_SECRET = {creds.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN = {creds.refresh_token}")
    print("=" * 60)


if __name__ == "__main__":
    main()
