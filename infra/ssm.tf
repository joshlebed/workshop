resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "session_secret" {
  name  = "/${local.prefix}/session_secret"
  type  = "SecureString"
  value = random_password.session_secret.result
}

# DATABASE_URL points at an externally-managed Postgres (Neon). The connection
# string is set via `var.database_url` in terraform.tfvars.local — never in git.
resource "aws_ssm_parameter" "db_url" {
  name  = "/${local.prefix}/db/url"
  type  = "SecureString"
  value = var.database_url
}
