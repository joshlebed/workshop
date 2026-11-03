# Hourly daily-game play reminders (push via Expo Push Service).
#
# EventBridge Scheduler invokes the API Lambda with `{ "job": "play-reminders" }`
# at the top of every hour; the job picks users whose local hour matches their
# reminder hour, skips anyone who already played today, sends one Expo push
# per registered token and prunes dead tokens. See
# apps/backend/src/jobs/playReminders.ts. The job dedups on `last_reminded_at`
# but a Lambda retry is still a second pass over the same hour, so retries are
# off: a missed hour is a missed reminder, never a duplicate.
#
# Inert until HighScore registers push tokens (`POST /v1/me/push-token`).
# Reuses the scheduler role + invoke policy from request_rollups.tf.

resource "aws_scheduler_schedule" "play_reminders" {
  name        = "${local.prefix}-play-reminders"
  description = "Send daily-game play reminders for users whose local hour matches"

  schedule_expression          = "cron(0 * * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "play-reminders" })

    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 60
    }
  }
}
