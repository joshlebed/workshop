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

# OAuth verification audiences. Values default to empty so `terraform apply`
# succeeds before Apple/Google portals are configured; after portal setup,
# paste the real IDs via `aws ssm put-parameter --overwrite` (see
# docs/plans/HANDOFF.md) and Lambda picks them up on next deploy.
#
# ignore_changes on `value` lets ops rotate the secret via the CLI/Console
# without Terraform reverting it back to the tfvars default.

resource "aws_ssm_parameter" "apple_bundle_id" {
  name  = "/${local.prefix}/apple_bundle_id"
  type  = "SecureString"
  value = var.apple_bundle_id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "apple_services_id" {
  name  = "/${local.prefix}/apple_services_id"
  type  = "SecureString"
  value = var.apple_services_id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "google_ios_client_id" {
  name  = "/${local.prefix}/google_ios_client_id"
  type  = "SecureString"
  value = var.google_ios_client_id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "google_web_client_id" {
  name  = "/${local.prefix}/google_web_client_id"
  type  = "SecureString"
  value = var.google_web_client_id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "tmdb_api_key" {
  name  = "/${local.prefix}/tmdb_api_key"
  type  = "SecureString"
  value = var.tmdb_api_key

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "google_books_api_key" {
  name  = "/${local.prefix}/google_books_api_key"
  type  = "SecureString"
  value = var.google_books_api_key

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "spotify_client_id" {
  name  = "/${local.prefix}/spotify_client_id"
  type  = "SecureString"
  value = var.spotify_client_id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "spotify_client_secret" {
  name  = "/${local.prefix}/spotify_client_secret"
  type  = "SecureString"
  value = var.spotify_client_secret

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "spotify_redirect_uri" {
  name  = "/${local.prefix}/spotify_redirect_uri"
  type  = "SecureString"
  value = var.spotify_redirect_uri

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "spotify_app_redirect_uri" {
  name  = "/${local.prefix}/spotify_app_redirect_uri"
  type  = "SecureString"
  value = var.spotify_app_redirect_uri

  lifecycle {
    ignore_changes = [value]
  }
}
