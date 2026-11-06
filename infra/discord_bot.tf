# Per-minute poll for `@Niteshift` mentions in #workshop-admin.
#
# Mentions only arrive over Discord's gateway websocket, which a Lambda can't
# hold, so EventBridge Scheduler invokes the API Lambda with
# `{ "job": "discord-mentions" }` once a minute; the job reads the last 50
# channel messages over REST and starts a Niteshift task for each new mention
# (apps/backend/src/jobs/discordMentions.ts). No-op until DISCORD_BOT_CONFIG is
# filled in. Reuses the scheduler role from request_rollups.tf.
#
# The /niteshift slash command needs no infra: Discord POSTs it to
# `<api>/discord/interactions`, served by the same Lambda.

resource "aws_scheduler_schedule" "discord_mentions" {
  name        = "${local.prefix}-discord-mentions"
  description = "Start Niteshift tasks for @Niteshift mentions in #workshop-admin"

  schedule_expression          = "rate(1 minute)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "discord-mentions" })

    # A missed minute is picked up by the next run (messages stay eligible
    # for 10 minutes), so never retry — a retry could overlap the next run.
    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 60
    }
  }
}
