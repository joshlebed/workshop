# Backend failure alarms, through the same SNS topic as the vendor alarms
# (vendor_alarms.tf): #workshop-admin via the API Lambda, plus the operator's
# email. Adds no AWS service.
#
# The three signals don't overlap, so one failure is one ping:
#   api-5xx         a request answered 5xx (includes every unhandled route error)
#   job-failures    a scheduled job failed (`job failed`, jobs/runJob.ts)
#   lambda-errors   an invocation crashed or timed out. runJob doesn't rethrow and
#                   Hono answers route errors itself, so neither counts here.
#
# Burst handling: an alarm fires on the first bad 5-minute window and stays in
# ALARM until six windows in a row (30 minutes) are clean, because the rule is
# "1 of the last 6". It has no OK action. So a burst is one ping, and the next
# ping needs a new burst after 30 quiet minutes.

locals {
  backend_log_alarms = {
    api-5xx = {
      pattern     = "{ $.kind = \"request\" && $.status >= 500 }"
      metric      = "api_5xx"
      description = "The API answered 5xx. Find it with ./scripts/logs.sh --since 1h --filter '\"unhandled error\"'."
    }
    job-failures = {
      pattern     = "{ $.msg = \"job failed\" }"
      metric      = "job_failures"
      description = "A scheduled job failed. The log line names it: ./scripts/logs.sh --since 1h --filter '\"job failed\"'."
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "backend" {
  for_each = local.backend_log_alarms

  name           = "${local.prefix}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = each.value.pattern

  metric_transformation {
    name          = each.value.metric
    namespace     = "${local.prefix}/backend"
    value         = "1"
    default_value = "0"
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "backend" {
  for_each = local.backend_log_alarms

  alarm_name        = "${local.prefix}-${each.key}"
  alarm_description = each.value.description

  namespace           = aws_cloudwatch_log_metric_filter.backend[each.key].metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.backend[each.key].metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 6
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.vendor_alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name        = "${local.prefix}-lambda-errors"
  alarm_description = "A Lambda invocation crashed or timed out (no response, no job result). Check ./scripts/logs.sh --since 1h --filter '?\"Task timed out\" ?\"Runtime exited\"'."

  namespace = "AWS/Lambda"
  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 6
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.vendor_alarms.arn]
}
