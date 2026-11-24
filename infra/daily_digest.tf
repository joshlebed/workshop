# One #workshop-admin summary each morning (apps/backend/src/jobs/dailyDigest.ts).
#
# 12:02 UTC (07:02 Eastern in winter, 08:02 in summer), one minute after the
# 12:01 request-rollups run, so the digest shares that wake of the database
# instead of adding one: Neon bills compute by the hour it is awake and keeps it
# up ~5 minutes after each query. Reuses the scheduler role from
# request_rollups.tf.
#
# No scheduler retry: a duplicate digest is worse than a missing one, and the
# next morning's message stands on its own.

resource "aws_scheduler_schedule" "daily_digest" {
  name        = "${local.prefix}-daily-digest"
  description = "Post the daily activity and signup-funnel digest to #workshop-admin"

  schedule_expression          = "cron(2 12 * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "daily-digest" })

    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 300
    }
  }
}
