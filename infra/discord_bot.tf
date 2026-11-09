# Per-minute poll for `@Niteshift` mentions in #workshop-admin.
#
# Mentions only arrive over Discord's gateway websocket, which a Lambda can't
# hold, so EventBridge Scheduler invokes the API Lambda with
# `{ "job": "discord-mentions" }` once a minute; the job reads the last 50
# channel messages over REST and starts a Niteshift task for each new mention
# (apps/backend/src/jobs/discordMentions.ts). No-op until the bot config is
# filled in. Reuses the scheduler role from request_rollups.tf.
#
# The Lambda reads /workshop-prod/discord/bot_config at runtime (cached 5 min,
# DISCORD_BOT_CONFIG_PARAM = its name), so `scripts/discord.mjs setup` takes
# effect without an apply and the token never sits in the Lambda env.

resource "aws_iam_role_policy" "lambda_discord_bot_config" {
  name = "${local.prefix}-lambda-discord-bot-config"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = aws_ssm_parameter.discord_bot_config.arn
      },
      {
        # SecureString under the AWS-managed aws/ssm key, only via SSM.
        Effect    = "Allow"
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = { StringEquals = { "kms:ViaService" = "ssm.us-east-1.amazonaws.com" } }
      },
    ]
  })
}
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
