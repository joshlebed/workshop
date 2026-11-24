# Daily check of Neon's free-plan limits (apps/backend/src/jobs/neonQuota.ts).
#
# The API key is deliberately NOT a Terraform resource. An `aws_ssm_parameter`
# can't be created from an empty value, and an `import` of a parameter that
# doesn't exist fails the apply, which would block every later Lambda env
# update. So this grants read on the name, and the job no-ops until the operator
# creates it (`docs/discord-bot-runbook.md` → "Neon usage alert").

locals {
  neon_api_key_param = "/${local.prefix}/neon/api_key"
  neon_project_id    = "curly-cell-22929804"
}

resource "aws_iam_role_policy" "lambda_neon_quota" {
  name = "${local.prefix}-lambda-neon-quota"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.neon_api_key_param}"
      },
      {
        # SecureString under the AWS-managed aws/ssm key, only via SSM.
        Effect    = "Allow"
        Action    = ["kms:Decrypt"]
        Resource  = "*"
        Condition = { StringEquals = { "kms:ViaService" = "ssm.${data.aws_region.current.region}.amazonaws.com" } }
      },
    ]
  })
}

# 12:03 UTC, right after the digest. The Neon API call doesn't wake the database;
# when a threshold is crossed the job's one query rides the 12:01 rollup wake.
resource "aws_scheduler_schedule" "neon_quota" {
  name        = "${local.prefix}-neon-quota"
  description = "Warn in #workshop-admin before Neon's monthly limits suspend the database"

  schedule_expression          = "cron(3 12 * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "neon-quota" })

    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 300
    }
  }
}
