import { request } from "node:http";
import { z } from "zod";

export const LOCAL_PUSH_HOST = "127.0.0.1";
export const LOCAL_PUSH_PORT = 9911;
export const LOCAL_PUSH_PATH = "/push";
export const LOCAL_PUSH_URL = `http://${LOCAL_PUSH_HOST}:${LOCAL_PUSH_PORT}${LOCAL_PUSH_PATH}`;

export const localPushBatchSchema = z
  .array(
    z.object({
      category: z.enum(["play_reminder", "friend_request", "poke", "admin_message"]),
      recipientId: z.string(),
      title: z.string(),
      body: z.string(),
    }),
  )
  .min(1)
  .max(100);

export function localPushEndpoint(value: string): URL {
  const url = URL.parse(value);
  if (
    url?.protocol !== "http:" ||
    url.hostname !== LOCAL_PUSH_HOST ||
    url.username ||
    url.password
  ) {
    throw new Error("Local push requires an HTTP endpoint on 127.0.0.1");
  }
  return url;
}

// Connect directly, independent of proxy environment variables and global fetch
// configuration. The HTTP client doesn't follow redirects.
export function postLocalPush(url: URL, body: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        signal,
      },
      async (res) => {
        try {
          if (res.statusCode !== 200) {
            res.destroy();
            throw new Error(`Local push recorder returned status ${res.statusCode}`);
          }
          let payload = "";
          for await (const part of res.setEncoding("utf8")) {
            payload += part;
            if (payload.length > 64 * 1024) throw new Error("Local push response too large");
          }
          resolve(JSON.parse(payload));
        } catch (error) {
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
