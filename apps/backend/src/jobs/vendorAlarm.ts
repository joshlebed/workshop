// CloudWatch alarm → SNS → this Lambda → #workshop-admin.
//
// `infra/vendor_alarms.tf` alarms on the "openai non-2xx" / "jev non-2xx" log
// lines whose status says the vendor stopped serving us (quota exhausted, key
// revoked). SNS invokes the API Lambda with the standard SNS event shape; this
// job turns the alarm JSON into one Discord ping. The same topic also emails
// the operator, so a Discord outage still reaches someone.

import { z } from "zod";
import { notifyDiscord } from "../lib/discord.js";
import { logger } from "../lib/logger.js";

const alarmSchema = z.object({
  AlarmName: z.string(),
  AlarmDescription: z.string().nullish(),
  NewStateValue: z.string(),
  NewStateReason: z.string().optional(),
});

const snsEventSchema = z.object({
  Records: z
    .array(z.object({ Sns: z.object({ Message: z.string(), Subject: z.string().nullish() }) }))
    .min(1),
});

export function isSnsEvent(event: unknown): event is z.infer<typeof snsEventSchema> {
  return snsEventSchema.safeParse(event).success;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The Discord message for one SNS record, or null when it isn't a CloudWatch alarm. */
export function formatAlarmMessage(message: string): string | null {
  const alarm = alarmSchema.safeParse(parseJson(message));
  if (!alarm.success) return null;
  const { AlarmName, AlarmDescription, NewStateValue, NewStateReason } = alarm.data;
  const icon = NewStateValue === "ALARM" ? "🚨" : NewStateValue === "OK" ? "✅" : "⚠️";
  const lines = [`${icon} **${AlarmName}** → ${NewStateValue}`];
  if (AlarmDescription) lines.push(AlarmDescription);
  if (NewStateReason) lines.push(`_${NewStateReason}_`);
  return lines.join("\n");
}

interface Deps {
  notify?: (content: string) => Promise<void>;
}

export async function runVendorAlarmJob(
  event: unknown,
  deps: Deps = {},
): Promise<{ sent: number }> {
  const notify =
    deps.notify ??
    ((content: string) => notifyDiscord(content, { kind: "vendor-alarm", withClient: false }));
  const parsed = snsEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.warn("vendor alarm: not an SNS event", { error: parsed.error });
    return { sent: 0 };
  }
  let sent = 0;
  for (const record of parsed.data.Records) {
    const content =
      formatAlarmMessage(record.Sns.Message) ??
      `⚠️ ${record.Sns.Subject ?? "SNS"}: ${record.Sns.Message.slice(0, 1500)}`;
    await notify(content);
    sent++;
  }
  logger.info("vendor alarm forwarded", { sent });
  return { sent };
}
