import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

let cachedClient: SESClient | null = null;

function getClient(): SESClient {
  if (cachedClient) return cachedClient;
  const { awsRegion } = getConfig();
  cachedClient = new SESClient({ region: awsRegion });
  return cachedClient;
}

export async function sendMagicLinkEmail(to: string, code: string): Promise<void> {
  const { sesFromAddress, isLocal } = getConfig();

  if (isLocal) {
    logger.info("magic code (local, not sent)", { to, code });
    return;
  }

  const cmd = new SendEmailCommand({
    Source: sesFromAddress,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: "Your Watchlist sign-in code", Charset: "UTF-8" },
      Body: {
        Text: {
          Data: `Your sign-in code is: ${code}\n\nIt expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`,
          Charset: "UTF-8",
        },
        Html: {
          Data: `<p>Your sign-in code:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`,
          Charset: "UTF-8",
        },
      },
    },
  });

  await getClient().send(cmd);
  logger.info("magic code sent", { to });
}
