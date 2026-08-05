/**
 * ns-line-relay
 *
 * 元々はLINE中継専用のWorkerだったが、2026-08-05にChatwork中継の機能も統合した。
 *
 * 【経緯・重要】
 * 1. Chatwork中継用に別ドメインの新Worker(ns-chatwork-relay)を立て、Claude Routineから
 *    直接curlで呼ぶ設計を試みたが、Claude Routineの実行環境(組織のegressポリシーで
 *    アウトバウンド接続先ドメインが許可リスト制)が、外部の任意ドメインへの接続を
 *    一切許可していないことが判明(この`ns-line-relay`自身への接続も403で拒否された)。
 *    つまり「ルーティンが直接Cloudflare Workerを呼ぶ」設計は、この実行環境では不可能。
 * 2. 一方、Cloudflare Worker自身からChatwork/Google Drive APIを呼ぶのは問題なく成功する。
 * 3. そのため、**Google Driveを中継地点にする元の設計に戻し、GitHub Actionsが担っていた
 *    「Driveをポーリングして Chatworkへ配送する」役割だけを、このWorkerの
 *    Cron Trigger(scheduled ハンドラ)に置き換えた**。GitHub Actionsからは
 *    2026-08-03頃からChatwork APIアクセスが403で拒否されるようになっていたため。
 *
 * 最終構成:
 *   Claude Routine ──(Google Drive MCPで読み書き)──> Google Drive
 *                                                          │
 *                                    Cron Trigger(数分おき) │
 *                                                          ▼
 *                                    このWorkerのscheduledハンドラ
 *                                                          │
 *                                                          ▼
 *                                                    Chatwork API
 *
 * LINEの部分(fetchハンドラ、Webhook・/push)は元の設計のまま変更なし。
 *
 * デプロイ場所: Cloudflareダッシュボード(m.hidetoshi1129@gmail.comのアカウント)
 * URL: https://ns-line-relay.m-hidetoshi1129.workers.dev
 * Cron Trigger: Settings > Triggers で設定(例: 5分おき `*\/5 * * * *`)
 *
 * 必要なsecret(Cloudflareダッシュボードの Settings > Variables and Secrets):
 *   LINE_ACCESS_TOKEN         LINE用(既存)
 *   LINE_CHANNEL_SECRET       LINE用(既存、Webhook署名検証用)
 *   ROUTINE_URL / ROUTINE_TOKEN  LINE用(既存、Claude Routineの起動用)
 *   CHATWORK_API_TOKEN        三幸秀稔アカウント(経理・情報チャネル等の業務ルーム用)
 *   CHATWORK_API_TOKEN_1129   1129アカウント(三幸秀稔への一般通知の送信元)
 *   CHATWORK_API_TOKEN_KABUNS 株NSアカウント(三幸秀稔への株レポートの送信元)
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN  Drive読み書き用
 *
 * 変更したら、Cloudflareダッシュボードの Edit code に貼り直してデプロイすること
 * (このリポジトリからの自動デプロイはまだ設定していない)。
 */

const OUTBOX_FOLDER_ID = "14v1e48XwXAe18OB-6CNjf8BSuqWYJ4IZ"; // Chatwork送信待ち（NS用）
const INBOX_FOLDER_ID = "1f7OgjQ7OClu6OYKBh-Iptcxay3DOwijN"; // Chatwork受信箱（NS用）
const SNAPSHOT_FOLDER_ID = "1OOBa8kiJ6wcD3ophYR52z9wm2EwKsz8v"; // Chatworkスナップショット（NS用）

// 差分ミラー対象ルーム(NS Chatwork会話 / NS 入出金・労務チェックが利用)
const WATCHED_ROOMS = {
  "443042144": "1129",
  "434768609": "売上管理用（閲覧用）",
  "434443620": "経理",
  "434443830": "成果報告"
};

const KEIRI_ROOM_ID = "434443620";
const KEIRI_SNAPSHOT_NAME = "keiri_snapshot.json";
const NS_PREFIX = "【NS】";
const INBOX_RETENTION_DAYS = 2;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/push") {
      return handlePushRelay(request, env);
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
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRelayCycle(env));
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

/* ---- ここから下がChatwork⇔Drive中継(Cron Trigger)用に追加した部分(2026-08-05) ---- */

const CW_TOKEN_ENV_BY_KEY = {
  main: "CHATWORK_API_TOKEN",
  "1129": "CHATWORK_API_TOKEN_1129",
  kabuns: "CHATWORK_API_TOKEN_KABUNS"
};

function resolveChatworkToken(env, key) {
  const envKey = CW_TOKEN_ENV_BY_KEY[key] || CW_TOKEN_ENV_BY_KEY.main;
  return env[envKey];
}

function tokenKeyForRoom(roomId) {
  if (roomId === "443042144") return "1129"; // 1129とのDM
  if (roomId === "443123712") return "kabuns"; // 株NSとのDM
  return "main"; // それ以外(経理・情報チャネル等)は三幸秀稔自身のトークン
}

async function getDriveAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const data = await res.json();
  return data.access_token;
}

async function listFolderFiles(driveToken, folderId, extraQuery) {
  let q = `'${folderId}' in parents and trashed = false`;
  if (extraQuery) q += ` and ${extraQuery}`;
  const params = new URLSearchParams({ q, fields: "files(id, name, createdTime)" });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${driveToken}` }
  });
  const data = await res.json();
  return data.files || [];
}

async function downloadFile(driveToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${driveToken}` }
  });
  return await res.text();
}

async function deleteFile(driveToken, fileId) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${driveToken}` }
  });
}

async function uploadJsonFile(driveToken, folderId, name, data) {
  const metadata = { name, parents: [folderId], mimeType: "application/json" };
  const boundary = "cfworkerboundary" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${driveToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
}

async function getChatworkMessages(env, roomId, force) {
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages?force=${force}`, {
    headers: { "X-ChatWorkToken": env.CHATWORK_API_TOKEN }
  });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`chatwork get failed: ${res.status}`);
  return await res.json();
}

async function postToChatwork(env, roomId, body) {
  const token = resolveChatworkToken(env, tokenKeyForRoom(roomId));
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": token,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `body=${encodeURIComponent(body)}`
  });
  if (!res.ok) throw new Error(`chatwork post failed: ${res.status}`);
}

async function relayOutbound(env, driveToken) {
  const files = await listFolderFiles(driveToken, OUTBOX_FOLDER_ID);
  let sent = 0;
  for (const f of files) {
    try {
      const content = await downloadFile(driveToken, f.id);
      const data = JSON.parse(content);
      const roomId = String(data.room_id);
      await postToChatwork(env, roomId, data.body);
      await deleteFile(driveToken, f.id);
      sent++;
    } catch (e) {
      // このファイルは残して次回リトライ(他のファイルの処理は続行)
    }
  }
  return sent;
}

async function relayInboundMirror(env, driveToken) {
  let total = 0;
  for (const roomId of Object.keys(WATCHED_ROOMS)) {
    let messages;
    try {
      messages = await getChatworkMessages(env, roomId, 0);
    } catch (e) {
      continue;
    }
    const newMessages = messages.filter((m) => !(m.body || "").startsWith(NS_PREFIX));
    for (const m of newMessages) {
      const ts = new Date().toISOString().replace(/[-:.]/g, "");
      const name = `inbox_${roomId}_${m.message_id}_${ts}.json`;
      await uploadJsonFile(driveToken, INBOX_FOLDER_ID, name, {
        room_id: roomId,
        room_name: WATCHED_ROOMS[roomId],
        message_id: m.message_id,
        account_name: m.account && m.account.name,
        body: m.body,
        send_time: m.send_time
      });
      total++;
    }
  }
  return total;
}

async function relayKeiriSnapshot(env, driveToken) {
  let messages;
  try {
    messages = await getChatworkMessages(env, KEIRI_ROOM_ID, 1);
  } catch (e) {
    return;
  }
  const existing = await listFolderFiles(driveToken, SNAPSHOT_FOLDER_ID, `name = '${KEIRI_SNAPSHOT_NAME}'`);
  for (const f of existing) await deleteFile(driveToken, f.id);
  await uploadJsonFile(driveToken, SNAPSHOT_FOLDER_ID, KEIRI_SNAPSHOT_NAME, messages);
}

async function cleanupOldInboxFiles(driveToken) {
  const cutoff = new Date(Date.now() - INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split(".")[0];
  const files = await listFolderFiles(driveToken, INBOX_FOLDER_ID, `createdTime < '${cutoff}'`);
  for (const f of files) await deleteFile(driveToken, f.id);
  return files.length;
}

async function runRelayCycle(env) {
  const driveToken = await getDriveAccessToken(env);
  const outboundCount = await relayOutbound(env, driveToken);
  const inboundCount = await relayInboundMirror(env, driveToken);
  await relayKeiriSnapshot(env, driveToken);
  const cleanedCount = await cleanupOldInboxFiles(driveToken);
  console.log(
    `送信: ${outboundCount}件, 受信ミラー: ${inboundCount}件, 受信箱の古いファイル削除: ${cleanedCount}件`
  );
}
