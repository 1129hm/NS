/**
 * ns-line-relay
 *
 * 元々はLINE中継専用のWorkerだったが、2026-08-05にChatwork中継の機能も統合した。
 *
 * 経緯: Chatwork中継用に別ドメインの新Worker(ns-chatwork-relay)を立てたところ、
 * Claude Routineの実行環境(組織のegressポリシーでアウトバウンド接続先ドメインが
 * 許可リスト制になっている)が、その新しいドメインへの接続を403で拒否した。
 * 一方この`ns-line-relay`は元からLINE中継用に許可リストに入っていたため、
 * 同じドメイン(ns-line-relay.m-hidetoshi1129.workers.dev)にChatwork用の
 * エンドポイントを追加する形で対応した。
 *
 * デプロイ場所: Cloudflareダッシュボード(m.hidetoshi1129@gmail.comのアカウント)
 * URL: https://ns-line-relay.m-hidetoshi1129.workers.dev
 *
 * 必要なsecret(Cloudflareダッシュボードの Settings > Variables and Secrets):
 *   LINE_ACCESS_TOKEN         LINE用(既存)
 *   LINE_CHANNEL_SECRET       LINE用(既存、Webhook署名検証用)
 *   ROUTINE_URL / ROUTINE_TOKEN  LINE用(既存、Claude Routineの起動用)
 *   RELAY_SECRET              Chatwork用エンドポイントへの認証(Bearerトークン)
 *   CHATWORK_API_TOKEN        三幸秀稔アカウント(経理・情報チャネル等の業務ルーム用)
 *   CHATWORK_API_TOKEN_1129   1129アカウント(三幸秀稔への一般通知の送信元)
 *   CHATWORK_API_TOKEN_KABUNS 株NSアカウント(三幸秀稔への株レポートの送信元)
 *
 * エンドポイント:
 *   POST /push                 { userId, text } -> LINEへプッシュ送信(既存)
 *   POST /(Webhook)             LINEからのWebhook受信(既存、署名検証あり)
 *   POST /chatwork/send         { room_id, body, token_key } -> Chatworkへ投稿(要RELAY_SECRET認証)
 *   GET  /chatwork/messages?room_id=...&force=0|1&token_key=... -> Chatworkの新着/全件取得(要RELAY_SECRET認証)
 *   token_keyは "main"(既定) | "1129" | "kabuns"
 *
 * 変更したら、Cloudflareダッシュボードの Edit code に貼り直してデプロイすること
 * (このリポジトリからの自動デプロイはまだ設定していない)。
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/push") {
      return handlePushRelay(request, env);
    }

    if (url.pathname === "/chatwork/send" || url.pathname === "/chatwork/messages") {
      const auth = request.headers.get("authorization") || "";
      if (auth !== `Bearer ${env.RELAY_SECRET}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      if (request.method === "POST" && url.pathname === "/chatwork/send") {
        return handleChatworkSend(request, env);
      }
      if (request.method === "GET" && url.pathname === "/chatwork/messages") {
        return handleChatworkMessages(request, env);
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    const bodyText = await request.text();
    const signature = request.headers.get("x-line-signature") || "";

    const valid = await verifySignature(bodyText, signature, env.LINE_CHANNEL_SECRET);
    if (!valid) {
      return new Response("invalid signature", { status: 401 });
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      return new Response("OK", { status: 200 });
    }

    const events = body.events || [];

    for (const event of events) {
      if (event.type === "message" && event.message && event.message.type === "text") {
        const userId = event.source && event.source.userId;
        const text = event.message.text;
        if (userId && text) {
          const payload = {
            text: `【LINEメッセージ受信】\nuserId: ${userId}\nメッセージ本文: ${text}\n\n返信を送る際は、api.line.meへ直接アクセスせず、必ず以下のcurlコマンドでこの中継エンドポイントを呼び出してください:\ncurl -X POST https://ns-line-relay.m-hidetoshi1129.workers.dev/push -H "Content-Type: application/json" -d '{"userId":"${userId}","text":"<返信本文>"}'`
          };
          ctx.waitUntil(
            fetch(env.ROUTINE_URL, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.ROUTINE_TOKEN}`,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "experimental-cc-routine-2026-04-01",
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            })
          );
        }
      }
    }

    return new Response("OK", { status: 200 });
  }
};

async function handlePushRelay(request, env) {
  let data;
  try {
    data = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }
  const { userId, text } = data;
  if (!userId || !text) {
    return new Response(JSON.stringify({ error: "userId and text required" }), { status: 400 });
  }
  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.LINE_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: text }]
    })
  });
  const resultText = await lineRes.text();
  return new Response(resultText, { status: lineRes.status });
}

async function verifySignature(body, signature, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const bytes = new Uint8Array(sigBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const computed = btoa(binary);
  return computed === signature;
}

/* ---- ここから下がChatwork中継用に追加した部分(2026-08-05) ---- */

const CW_TOKEN_ENV_BY_KEY = {
  main: "CHATWORK_API_TOKEN",
  "1129": "CHATWORK_API_TOKEN_1129",
  kabuns: "CHATWORK_API_TOKEN_KABUNS"
};

function resolveChatworkToken(env, key) {
  const envKey = CW_TOKEN_ENV_BY_KEY[key] || CW_TOKEN_ENV_BY_KEY.main;
  return env[envKey];
}

async function handleChatworkSend(request, env) {
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

  const token = resolveChatworkToken(env, token_key);
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

async function handleChatworkMessages(request, env) {
  const url = new URL(request.url);
  const room_id = url.searchParams.get("room_id");
  const force = url.searchParams.get("force") || "0";
  const token_key = url.searchParams.get("token_key") || "main";

  if (!room_id) {
    return new Response(JSON.stringify({ error: "room_id required" }), { status: 400 });
  }

  const token = resolveChatworkToken(env, token_key);
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
