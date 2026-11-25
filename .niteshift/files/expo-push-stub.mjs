#!/usr/bin/env node
// Local stand-in for Expo's push endpoint (`EXPO_PUSH_URL`). The sandbox DB is
// a copy of prod with real push tokens, so the backend service points here by
// default (.niteshift/files/backend.sh) and nothing ever reaches exp.host.
// Answers every message with an `ok` ticket and appends each one, one JSON
// line, to $EXPO_PUSH_STUB_LOG (default /tmp/expo-push-stub.jsonl).
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 8790);
const log = process.env.EXPO_PUSH_STUB_LOG || "/tmp/expo-push-stub.jsonl";

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let messages = [];
    try {
      const parsed = JSON.parse(body || "[]");
      messages = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const at = new Date().toISOString();
    for (const message of messages) appendFileSync(log, `${JSON.stringify({ at, ...message })}\n`);
    console.log(`${at} ${req.method} ${req.url} ${messages.length} message(s)`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: messages.map((_, i) => ({ status: "ok", id: `stub-${Date.now()}-${i}` })),
      }),
    );
  });
}).listen(port, "127.0.0.1", () => console.log(`expo push stub on :${port}, logging to ${log}`));
