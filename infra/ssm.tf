resource "random_password" "session_secret" {
  length  = 48
  special = false

  # Bump to rotate. Replacing this resource re-issues SESSION_SECRET on the
  # Lambda and in SSM on the next apply: every session is signed out once and
  # secretBox-sealed values (Apple refresh tokens) become unreadable, which the
  # backend treats as "nothing to revoke". 2026-10-08: the previous value had
  # been printed in public Deploy Backend logs (fixed in #453).
  keepers = {
    rotation = "2026-10-08"
  }
}

resource "aws_ssm_parameter" "session_secret" {
  name  = "/${local.prefix}/session_secret"
  type  = "SecureString"
  value = random_password.session_secret.result
}

# DATABASE_URL points at an externally-managed Postgres (Neon). The connection
# string is set via `var.database_url` in terraform.tfvars — never in git.
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

# The four OAuth audience params below hold a COMMA-SEPARATED LIST of accepted
# `aud` values (one entry per client app). The backend parses them in
# `apps/backend/src/lib/config.ts`; a single value with no comma is unchanged
# behavior. Appending a HighScore audience is an ops-only `put-parameter
# --overwrite` (migration plan OP-6) — no Terraform change needed, since
# `ignore_changes = [value]` keeps the ops-set value.
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

# Created out of band, like typesafe_api_key below.
import {
  to = aws_ssm_parameter.openai_api_key
  id = "/workshop-prod/openai_api_key"
}

resource "aws_ssm_parameter" "openai_api_key" {
  name  = "/${local.prefix}/openai_api_key"
  type  = "SecureString"
  value = var.openai_api_key

  lifecycle {
    ignore_changes = [value]
  }
}

# Created out of band with `aws ssm put-parameter` (SSM rejects the empty
# default on create), so Terraform adopts it instead of creating it.
import {
  to = aws_ssm_parameter.typesafe_api_key
  id = "/workshop-prod/typesafe_api_key"
}

resource "aws_ssm_parameter" "typesafe_api_key" {
  name  = "/${local.prefix}/typesafe_api_key"
  type  = "SecureString"
  value = var.typesafe_api_key

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

# Sign in with Apple revocation key (account-deletion token revocation). All
# three were created out of band with `aws ssm put-parameter` (SSM rejects an
# empty value on create — see CLAUDE.md), so Terraform adopts them via import.
import {
  to = aws_ssm_parameter.apple_team_id
  id = "/workshop-prod/apple_team_id"
}

resource "aws_ssm_parameter" "apple_team_id" {
  name  = "/${local.prefix}/apple_team_id"
  type  = "SecureString"
  value = var.apple_team_id

  lifecycle {
    ignore_changes = [value]
  }
}

import {
  to = aws_ssm_parameter.apple_key_id
  id = "/workshop-prod/apple_key_id"
}

resource "aws_ssm_parameter" "apple_key_id" {
  name  = "/${local.prefix}/apple_key_id"
  type  = "SecureString"
  value = var.apple_key_id

  lifecycle {
    ignore_changes = [value]
  }
}

import {
  to = aws_ssm_parameter.apple_private_key
  id = "/workshop-prod/apple_private_key"
}

resource "aws_ssm_parameter" "apple_private_key" {
  name  = "/${local.prefix}/apple_private_key"
  type  = "SecureString"
  value = var.apple_private_key

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

resource "aws_ssm_parameter" "discord_notify_webhook_url" {
  name  = "/${local.prefix}/discord/notify_webhook_url"
  type  = "SecureString"
  value = var.discord_notify_webhook_url

  lifecycle {
    ignore_changes = [value]
  }
}
