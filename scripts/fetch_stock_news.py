"""
株式市場の動向を要約するスクリプト。
三幸さんの株式投資の学習(少額から着実に学びながら増やす方針)をサポートするため、
1日数回(朝・日中・夜)、主要指数・注目セクターの値動きとその背景を調べて要約する。

必要な環境変数:
  ANTHROPIC_API_KEY : Anthropic APIキー(console.anthropic.comで発行)
"""

import os
from anthropic import Anthropic

MODEL = "claude-sonnet-5"

PROMPT = """あなたは株式投資を学び始めた三幸さんの学習パートナーです。
三幸さんは少額(10万円程度)から始めて、ニュースやYouTubeをリサーチしながら
値動きのパターンを学び、安全に・高望みせずコツコツ資産を増やしていきたいと
考えています。

web検索を使って、直近数時間以内の株式市場の動きを調べ、以下の内容を
まとめてください。

- 日経平均・TOPIX・NYダウ・S&P500・Nasdaqなど主要指数の値動きと、その背景
- 特に値動きが大きかった注目セクター・銘柄と、その理由
- 三幸さんが値動きのパターンを学ぶ上で参考になりそうな視点や気づき

出力形式のルール:
- 見出しをつけて、箇条書きで簡潔にまとめる(3〜6項目程度)
- 各項目は事実ベースで、なぜその値動きが起きたのかの背景まで書く
- 各項目の末尾に、必ず「出典: 記事の実際のURL」を記載する(Chatworkに貼ると
  URLがそのまま自動でリンクになるため、記事本文で見つけた実際のURLをそのまま
  書くこと。マークダウンのリンク記法は使わない)
- 特定銘柄の売買を推奨するような書き方はしない。あくまで値動きと背景を解説する
  学習用の情報として扱う
- 直近で大きな動きが特になければ「大きな動きなし」と書く
- 前置きや後書きの挨拶文は不要。まとめだけを出力する
- 日本語で出力する
"""


def fetch_stock_news_summary() -> str:
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    response = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[{"role": "user", "content": PROMPT}],
    )

    text_blocks = [block.text for block in response.content if block.type == "text"]
    return "\n".join(text_blocks).strip()


if __name__ == "__main__":
    print(fetch_stock_news_summary())
