/**
 * ns-chatwork-relay
 *
 * Claude RoutineからChatwork APIへ直接アクセスできない(サンドボックス制限)ため、
 * また2026-08-03頃からGitHub Actions経由のアクセスもChatwork側から403 Forbiddenで
 * 拒否されるようになったため、Cloudflare Workerを中継役にした。
 *
 * デプロイ場所: Cloudflareダッシュボード(m.hidetoshi1129@gmail.comのアカウント)
 * URL: https://ns-chatwork-relay.m-hidetoshi1129.workers.dev
 * 姉妹Worker: ns-line-relay(同じアカウント、LINE用の中継。同じ設計思想)
 *
 * 必要なsecret(Cloudflareダッシュボードの Settings > Variables and Secrets):
 *   RELAY_SECRET             このWorker自体への認証用(Bearerトークン)
 *   CHATWORK_API_TOKEN        三幸秀稔アカウント(経理・情報チャネル等の業務ルーム用)
 *   CHATWORK_API_TOKEN_1129   1129アカウント(三幸秀稔への一般通知の送信元)
 *   CHATWORK_API_TOKEN_KABUNS 株NSアカウント(三幸秀稔への株レポートの送信元)
 *
 * エンドポイント:
 *   POST /send      { room_id, body, token_key } -> Chatworkへ投稿
 *   GET  /messages?room_id=...&force=0|1&token_key=... -> Chatworkの新着/全件取得
 *   token_keyは "main"(既定) | "1129" | "kabuns"
 *
 * 変更したら、Cloudflareダッシュボードの Edit code に貼り直してデプロイすること
 * (このリポジトリからの自動デプロイはまだ設定していない)。
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${env.RELAY_SECRET}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }
    if (request.method === "GET" && url.pathname === "/messages") {
      return handleMessages(request, env);
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
};

const TOKEN_ENV_BY_KEY = {
  main: "CHATWORK_API_TOKEN",
  "1129": "CHATWORK_API_TOKEN_1129",
  kabuns: "CHATWORK_API_TOKEN_KABUNS"
};

function resolveToken(env, key) {
  const envKey = TOKEN_ENV_BY_KEY[key] || TOKEN_ENV_BY_KEY.main;
  return env[envKey];
}

async function handleSend(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }

  const { room_id, body, token_key } = data;
  if (!room_id || !body) {
    return new Response(JSON.stringify({ error: "room_id and body required" }), { status: 400 });
  }

  const token = resolveToken(env, token_key);
  if (!token) {
    return new Response(JSON.stringify({ error: "invalid token_key" }), { status: 400 });
  }

  const cwRes = await fetch(`https://api.chatwork.com/v2/rooms/${room_id}/messages`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": token,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `body=${encodeURIComponent(body)}`
  });

  const resultText = await cwRes.text();
  return new Response(resultText, {
    status: cwRes.status,
    headers: { "Content-Type": "application/json" }
  });
}

async function handleMessages(request, env) {
  const url = new URL(request.url);
  const room_id = url.searchParams.get("room_id");
  const force = url.searchParams.get("force") || "0";
  const token_key = url.searchParams.get("token_key") || "main";

  if (!room_id) {
    return new Response(JSON.stringify({ error: "room_id required" }), { status: 400 });
  }

  const token = resolveToken(env, token_key);
  if (!token) {
    return new Response(JSON.stringify({ error: "invalid token_key" }), { status: 400 });
  }

  const cwRes = await fetch(
    `https://api.chatwork.com/v2/rooms/${room_id}/messages?force=${force}`,
    { headers: { "X-ChatWorkToken": token } }
  );

  const resultText = await cwRes.text();
  return new Response(resultText, {
    status: cwRes.status,
    headers: { "Content-Type": "application/json" }
  });
}
