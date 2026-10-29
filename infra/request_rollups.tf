# Hourly request-traffic rollups for the in-app admin analytics dashboards.
#
# EventBridge Scheduler invokes the API Lambda with `{ "job": "request-rollups" }`
# five minutes past every hour; the job runs one Logs Insights query over the
# last three complete hours of the request log and rewrites `request_rollups`
# for that window (idempotent). See apps/backend/src/jobs/requestRollups.ts.

resource "aws_iam_role_policy" "lambda_request_rollups" {
  name = "${local.prefix}-lambda-request-rollups"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:StartQuery", "logs:StopQuery"]
        Resource = "${aws_cloudwatch_log_group.lambda.arn}:*"
      },
      {
        # GetQueryResults is not resource-scoped.
        Effect   = "Allow"
        Action   = ["logs:GetQueryResults"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role" "scheduler" {
  name = "${local.prefix}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke_api" {
  name = "${local.prefix}-scheduler-invoke-api"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api.arn
    }]
  })
}

resource "aws_scheduler_schedule" "request_rollups" {
  name        = "${local.prefix}-request-rollups"
  description = "Materialize hourly request rollups from the request log"

  schedule_expression          = "cron(5 * * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "request-rollups" })

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 1800
    }
  }
}
