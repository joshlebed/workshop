import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { formatAlarmMessage, isSnsEvent, runVendorAlarmJob } from "./vendorAlarm.js";

const alarm = {
  AlarmName: "workshop-prod-openai-credits",
  AlarmDescription: "OpenAI rejected a call: out of credits or bad key.",
  NewStateValue: "ALARM",
  NewStateReason: "Threshold Crossed: 1 datapoint [1.0] was >= 1.0",
};
const snsEvent = (message: string) => ({
  Records: [{ Sns: { Message: message, Subject: "ALARM" } }],
});

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
});

describe("vendor alarm job", () => {
  it("recognises the SNS event shape and nothing else", () => {
    expect(isSnsEvent(snsEvent("{}"))).toBe(true);
    expect(isSnsEvent({ job: "play-reminders" })).toBe(false);
    expect(isSnsEvent({ requestContext: {}, rawPath: "/health" })).toBe(false);
  });

  it("formats a CloudWatch alarm as one Discord message", () => {
    expect(formatAlarmMessage(JSON.stringify(alarm))).toBe(
      "🚨 **workshop-prod-openai-credits** → ALARM\nOpenAI rejected a call: out of credits or bad key.\n_Threshold Crossed: 1 datapoint [1.0] was >= 1.0_",
    );
    expect(formatAlarmMessage(JSON.stringify({ ...alarm, NewStateValue: "OK" }))).toMatch(/^✅/);
    expect(formatAlarmMessage("not json")).toBeNull();
  });

  it("pings once per record and falls back to the raw message", async () => {
    const notify = vi.fn<(content: string) => Promise<void>>(async () => {});
    const event = {
      Records: [...snsEvent(JSON.stringify(alarm)).Records, ...snsEvent("plain text").Records],
    };
    expect(await runVendorAlarmJob(event, { notify })).toEqual({ sent: 2 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]?.[0]).toBe("⚠️ ALARM: plain text");
  });

  it("ignores a non-SNS payload", async () => {
    const notify = vi.fn(async () => {});
    expect(await runVendorAlarmJob({ job: "nope" }, { notify })).toEqual({ sent: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
});
