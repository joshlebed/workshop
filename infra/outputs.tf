output "api_url" {
  description = "Public HTTPS URL of the backend API."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "lambda_function_name" {
  description = "Lambda function name (for aws lambda update-function-code)."
  value       = aws_lambda_function.api.function_name
}

output "db_url_ssm_param" {
  description = "SSM param name holding DATABASE_URL (SecureString)."
  value       = aws_ssm_parameter.db_url.name
}

output "cloudwatch_log_group" {
  description = "Lambda log group (for aws logs tail)."
  value       = aws_cloudwatch_log_group.lambda.name
}

output "github_actions_role_arn" {
  description = "Role ARN that GitHub Actions assumes via OIDC."
  value       = aws_iam_role.github_actions.arn
}

output "niteshift_role_arn" {
  description = "Role ARN to paste into Niteshift → Settings → Repositories → workshop → AWS tab."
  value       = aws_iam_role.niteshift.arn
}

output "github_actions_tf_apply_role_arn" {
  description = "Role ARN used by terraform.yml's apply job (push-to-main). Admin policy; scoped to main-branch sub claim."
  value       = aws_iam_role.github_actions_tf_apply.arn
}

output "aws_region" {
  value = data.aws_region.current.name
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}
