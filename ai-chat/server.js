// Small server: serves the static site from ./public and proxies chat
// messages to Claude so the API key never reaches the browser.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

const SYSTEM_PROMPT = `You are "Nour", a friendly AI shown to the user as an animated talking face on a website.
Your replies are read aloud by a text-to-speech voice, so:
- Keep answers short and conversational: 1 to 3 sentences unless the user asks for detail.
- Never use markdown, lists, emojis, code blocks or special symbols.
- Reply in the same language and dialect the user writes in (Moroccan Darija, Arabic, French or English).
Latency-sensitive; begin your visible answer immediately.`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// The SDK is loaded lazily so the static site still works without
// `npm install` or an API key; the page then uses its offline replies.
let client = null;
async function getClient() {
  if (client) return client;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic();
  return client;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 100_000) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error("Body too large");
  }
  return JSON.parse(data || "{}");
}

function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  // The conversation must start with a user turn.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: "bad_request" });
  }
  const messages = cleanHistory(body.messages);
  if (!messages.length || messages.at(-1).role !== "user") {
    return sendJson(res, 400, { error: "bad_request" });
  }

  let anthropic;
  try {
    anthropic = await getClient();
  } catch {
    return sendJson(res, 503, { error: "sdk_missing" });
  }

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    });

    if (response.stop_reason === "refusal") {
      return sendJson(res, 200, { reply: "سمح ليا، ما نقدرش نجاوب على هاد السؤال." });
    }
    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return sendJson(res, 200, { reply });
  } catch (err) {
    console.error("Claude API error:", err?.status ?? "", err?.message ?? err);
    const status = err?.status === 401 ? 503 : 502;
    return sendJson(res, status, { error: "upstream_error" });
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => {
    console.log(`AI face chat running on http://localhost:${PORT}`);
  });
