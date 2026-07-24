"""
毎朝のニュース要約を作成するスクリプト。
Anthropic APIのweb検索ツールを使って、指定したトピックの最新ニュースを
検索・要約し、テキストとして返す。

必要な環境変数:
  ANTHROPIC_API_KEY : Anthropic APIキー(console.anthropic.comで発行)
"""

import os
from anthropic import Anthropic

# ニュースのトピック(必要に応じてここを編集すればカスタマイズできる)
TOPICS = [
    "人材紹介・人材派遣業界の最新動向",
    "人事・労務関連の法改正(直近1週間)",
    "AI(人工知能)業界の最新動向・生成AI関連ニュース",
    "人事・採用業務におけるAI活用/自動化(HR Tech)の最新ニュース",
    "建設業界の最新ニュース",
    "不動産業界の最新ニュース",
    "トランプ大統領の最新の動向",
    "日本および世界の政治の主要ニュース",
]

MODEL = "claude-sonnet-5"


def fetch_news_summary() -> str:
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    topics_text = "\n".join(f"- {t}" for t in TOPICS)

    prompt = f"""あなたは経営者向けの朝の情報アシスタントです。
以下のトピックについて、web検索を使って直近(できれば過去24〜48時間以内)の
重要なニュースを調べ、要約してください。

トピック:
{topics_text}

出力形式のルール:
- 各トピックごとに見出しをつけ、重要なニュースを2〜4件、箇条書きで簡潔にまとめる
- 各ニュースは1〜2行程度、事実ベースで簡潔に
- 各項目の末尾に、必ず「出典: 記事の実際のURL」を記載する(Chatworkに貼るとURLがそのまま自動でリンクになるため、記事本文で見つけた実際のURLをそのまま書くこと。マークダウンのリンク記法は使わない)
- 該当ニュースが特になければ「大きな動きなし」と書く
- 全体の前置きや後書きの挨拶文は不要。トピックの要約だけを出力する
- 日本語で出力する
"""

    response = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[{"role": "user", "content": prompt}],
    )

    # text ブロックだけを抜き出して結合する
    text_blocks = [block.text for block in response.content if block.type == "text"]
    return "\n".join(text_blocks).strip()


if __name__ == "__main__":
    print(fetch_news_summary())
