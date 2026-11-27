import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import {
  LOCAL_PUSH_HOST,
  LOCAL_PUSH_PATH,
  LOCAL_PUSH_PORT,
  localPushBatchSchema,
} from "../src/lib/localPush.js";

const directory = ".data/local-push";
const output = `${directory}/recorded.json`;
const temporary = `${directory}/recorded.tmp`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
rmSync(temporary, { force: true });
rmSync(output, { force: true });

type Entry = ReturnType<typeof localPushBatchSchema.parse>[number] & { recordedAt: string };
let entries: Entry[] = [];

createServer({ requestTimeout: 5000 }, async (req, res) => {
  if (req.method !== "POST" || req.url !== LOCAL_PUSH_PATH) {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.origin || req.headers["content-type"] !== "application/json") {
    res.writeHead(415).end();
    return;
  }

  let batch: ReturnType<typeof localPushBatchSchema.parse>;
  try {
    let body = "";
    for await (const part of req.setEncoding("utf8")) {
      body += part;
      if (body.length > 128 * 1024) {
        res.writeHead(413).end();
        return;
      }
    }
    batch = localPushBatchSchema.parse(JSON.parse(body));
  } catch {
    res.writeHead(400).end();
    return;
  }

  const recordedAt = new Date().toISOString();
  const next = [...entries, ...batch.map((message) => ({ ...message, recordedAt }))].slice(-1000);
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: "w" });
    renameSync(temporary, output);
    entries = next;
  } catch {
    res.writeHead(503).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: batch.map(() => ({ status: "ok" })) }));
}).listen(LOCAL_PUSH_PORT, LOCAL_PUSH_HOST, () => console.log("Local push recorder ready"));
