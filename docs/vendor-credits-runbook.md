# Vendor credits runbook — OpenAI + TypeSafe

Two paid vendors sit behind HighScore features and both fail _silently_ when the balance
hits zero: the backend swallows the non-2xx and falls back (`lib/teach/openai.ts` → teach
returns `http` failure, `lib/jev.ts` → recognition returns `null`). Users see a worse
product, not an error.

## What alerts exist (after #<this PR>)

`infra/vendor_alarms.tf`: CloudWatch metric filters on the Lambda log group count the
`openai non-2xx` / `jev non-2xx` lines with status 401/402/403/429. Each alarm fires on
the first hit in a 5-minute window and fans out through SNS `workshop-prod-vendor-alarms` to:

1. **#workshop-admin** — the API Lambda is subscribed; `jobs/vendorAlarm.ts` posts the
   alarm as one message (🚨 on ALARM, ✅ when the next clean window clears it).
2. **Email** (`var.budget_email_recipient`) — SNS email subscriptions deliver nothing
   until the confirmation link in AWS's first mail is clicked. One-time, after the first
   apply. `aws sns list-subscriptions-by-topic --topic-arn <arn>` shows
   `PendingConfirmation` until then.

These alarms are **reactive**: they fire on the first rejected call, i.e. once the balance
is already gone. The pre-emptive layer lives in each vendor's console (below).

## Reading an alarm

| Vendor   | Status  | `code` / body         | Meaning                | Fix                                                               |
| -------- | ------- | --------------------- | ---------------------- | ----------------------------------------------------------------- |
| OpenAI   | 429     | `insufficient_quota`  | Out of prepaid credits | Add credits (billing link below)                                  |
| OpenAI   | 429     | `rate_limit_exceeded` | Burst, not money       | Nothing unless sustained                                          |
| OpenAI   | 401     | `invalid_api_key`     | Key revoked/rotated    | New key → SSM `/workshop-prod/openai_api_key`, refresh Lambda env |
| OpenAI   | 403     | —                     | Org disabled / region  | Check the OpenAI org page                                         |
| TypeSafe | 401/403 | body text             | Key revoked            | New key → SSM `/workshop-prod/typesafe_api_key`                   |
| TypeSafe | 402/429 | body text             | Credits / rate limit   | Top up in the TypeSafe console                                    |

Trace the exact line: `AWS_PROFILE=workshop-prod ./scripts/logs.sh --since 1h --filter "non-2xx"`.

## Pre-emptive alerts (set by hand in each console)

**OpenAI** — <https://platform.openai.com/settings/organization/billing/overview>

- Prepaid credits only; the account is not on monthly invoicing. Enable **auto-recharge**
  (recharge $X when balance < $Y) so the balance never reaches zero, or
- **Usage limits** (<https://platform.openai.com/settings/organization/limits>): set a
  monthly budget with an email alert at a threshold. This alerts on _spend_, not remaining
  credits — with auto-recharge off, pick a threshold below the prepaid amount.
- OpenAI emails the org owner on `insufficient_quota` regardless; make sure that mailbox
  is read.

**TypeSafe** — no documented low-balance webhook or alert API as of 2026-11. Check the
console's billing page for an email threshold; if none exists, the CloudWatch alarm above
is the only signal. Current spend is near zero (0 `jev` calls in the last 30 days of logs),
so the practical risk is key expiry, not balance.

## Key rotation (either vendor)

```bash
aws ssm put-parameter --name /workshop-prod/<openai_api_key|typesafe_api_key> \
  --value '<key>' --overwrite --type SecureString
# then any Terraform apply (merge to main) refreshes the Lambda env, or by hand:
aws lambda update-function-configuration --function-name workshop-prod-api \
  --environment "$(…merged map…)" --query FunctionName
```
