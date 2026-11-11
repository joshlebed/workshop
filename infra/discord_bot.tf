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

# Daily self-check (token, intent, endpoint URL — re-set if blanked — commands,
# channel access). Problems are posted via the notify webhook, not the bot.
resource "aws_scheduler_schedule" "discord_health" {
  name        = "${local.prefix}-discord-health"
  description = "Daily health check of the #workshop-admin Niteshift bot"

  schedule_expression          = "cron(0 15 * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "discord-health" })

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 3600
    }
  }
}

# ✅ on the Discord message behind a task once its PR (body line
# `Discord-Message: <id>`) merges. One anonymous GitHub API call per run.
resource "aws_scheduler_schedule" "discord_merged" {
  name        = "${local.prefix}-discord-merged"
  description = "Mark Discord-started tasks whose PR merged"

  schedule_expression          = "rate(10 minutes)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "discord-merged" })

    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 300
    }
  }
}
