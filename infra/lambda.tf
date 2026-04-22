resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.prefix}-api"
  retention_in_days = 14
}

resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_inline" {
  role = aws_iam_role.lambda.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_verified_email
          }
        }
      }
    ]
  })
}

# A tiny placeholder zip so `terraform apply` succeeds before the first CI
# deploy uploads real code. CI runs `aws lambda update-function-code` after.
data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.placeholder.zip"
  source {
    content  = "exports.handler = async () => ({ statusCode: 503, body: JSON.stringify({ error: 'not deployed yet' }) });"
    filename = "lambda.js"
  }
}

resource "aws_lambda_function" "api" {
  function_name = "${local.prefix}-api"
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs20.x"
  handler       = "lambda.handler"
  memory_size   = 512
  timeout       = 15

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  environment {
    variables = {
      STAGE            = "prod"
      DATABASE_URL     = aws_ssm_parameter.db_url.value
      SESSION_SECRET   = random_password.session_secret.result
      SES_FROM_ADDRESS = var.ses_verified_email
      LOG_LEVEL        = "info"
    }
  }

  # CI always replaces the code; ignore it so `terraform apply` doesn't
  # revert a newer deploy.
  lifecycle {
    ignore_changes = [
      filename,
      source_code_hash,
    ]
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}
