# Vendor-credit alarms: OpenAI (game teach) and TypeSafe/Jev (game recognition).
#
# Both clients swallow a non-2xx and fall back silently (`lib/teach/openai.ts`,
# `lib/jev.ts`), so an exhausted balance or a revoked key only ever showed up as
# a `logger.warn` line. These metric filters count the log lines whose status
# says the vendor stopped serving us; the alarms fan out through one SNS topic
# to (1) the API Lambda, which posts to #workshop-admin (`jobs/vendorAlarm.ts`),
# and (2) the operator's email. Email subscriptions need a one-time click on
# AWS's confirmation mail before they deliver.
#
# Why "any auth/quota status", not just 429: OpenAI reports a dead balance as
# 429 `insufficient_quota` (same status as a rate limit — the `code` field in
# the log tells them apart, and a burst of plain rate limits is also worth a
# ping), a revoked key as 401, and a disabled org as 403. TypeSafe's low-credit
# status isn't documented, so Jev alarms on the same set plus 402.
#
# Alarms transition once per episode: a persistent outage pings once (ALARM)
# and once more when the next successful window clears it (OK).

locals {
  vendor_alarm_statuses = "($.status = 401 || $.status = 402 || $.status = 403 || $.status = 429)"
  vendor_alarms = {
    openai = {
      pattern     = "{ $.msg = \"openai non-2xx\" && ${local.vendor_alarm_statuses} }"
      description = "OpenAI rejected a teach call (401/403 = key, 429 insufficient_quota = out of credits). Top up at platform.openai.com/settings/organization/billing; see docs/vendor-credits-runbook.md."
    }
    typesafe = {
      pattern     = "{ $.msg = \"jev non-2xx\" && ${local.vendor_alarm_statuses} }"
      description = "TypeSafe (Jev) rejected a game-recognition call (401/403 = key, 402/429 = credits). Top up in the TypeSafe console; see docs/vendor-credits-runbook.md."
    }
  }
}

resource "aws_sns_topic" "vendor_alarms" {
  name = "${local.prefix}-vendor-alarms"
}

resource "aws_sns_topic_subscription" "vendor_alarms_email" {
  topic_arn = aws_sns_topic.vendor_alarms.arn
  protocol  = "email"
  endpoint  = var.budget_email_recipient
}

resource "aws_sns_topic_subscription" "vendor_alarms_lambda" {
  topic_arn = aws_sns_topic.vendor_alarms.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.api.arn
}

resource "aws_lambda_permission" "sns_vendor_alarms" {
  statement_id  = "AllowSnsVendorAlarms"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.vendor_alarms.arn
}

resource "aws_cloudwatch_log_metric_filter" "vendor_errors" {
  for_each = local.vendor_alarms

  name           = "${local.prefix}-${each.key}-auth-or-quota-errors"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = each.value.pattern

  metric_transformation {
    name          = "${each.key}_auth_or_quota_errors"
    namespace     = "${local.prefix}/vendors"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "vendor_errors" {
  for_each = local.vendor_alarms

  alarm_name        = "${local.prefix}-${each.key}-credits"
  alarm_description = each.value.description

  namespace           = aws_cloudwatch_log_metric_filter.vendor_errors[each.key].metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.vendor_errors[each.key].metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.vendor_alarms.arn]
  ok_actions    = [aws_sns_topic.vendor_alarms.arn]
}
