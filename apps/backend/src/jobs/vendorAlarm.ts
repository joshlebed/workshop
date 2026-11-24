// CloudWatch alarm → SNS → this Lambda → #workshop-admin.
//
// Two sets of alarms share the topic: `infra/vendor_alarms.tf` (the "openai
// non-2xx" / "jev non-2xx" log lines whose status says the vendor stopped
// serving us) and `infra/backend_alarms.tf` (API 5xx, failed jobs, crashed
// invocations). SNS invokes the API Lambda with the standard SNS event shape;
// this job turns the alarm JSON into one Discord ping. The same topic also
// emails the operator, so a Discord outage still reaches someone.

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

/** The log tag for a record: vendor alarms are named `<prefix>-<vendor>-credits`. */
export function alarmKind(message: string): "vendor-alarm" | "backend-alarm" {
  const alarm = alarmSchema.safeParse(parseJson(message));
  return alarm.success && !alarm.data.AlarmName.endsWith("-credits")
    ? "backend-alarm"
    : "vendor-alarm";
}

interface Deps {
  notify?: (content: string, kind: string) => Promise<unknown>;
}

export async function runVendorAlarmJob(
  event: unknown,
  deps: Deps = {},
): Promise<{ sent: number }> {
  const notify =
    deps.notify ??
    ((content: string, kind: string) => notifyDiscord(content, { kind, withClient: false }));
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
    await notify(content, alarmKind(record.Sns.Message));
    sent++;
  }
  logger.info("vendor alarm forwarded", { sent });
  return { sent };
}
