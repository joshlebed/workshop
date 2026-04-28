variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region for all resources."
}

variable "github_repository" {
  type        = string
  default     = "joshlebed/workshop"
  description = "GitHub repo (owner/name). Used to scope the GH Actions OIDC trust policy."
}

variable "budget_email_recipient" {
  type        = string
  default     = "joshlebed@gmail.com"
  description = "Email to receive the $5 monthly AWS budget alert. Routed through SNS, not SES."
}

variable "database_url" {
  type        = string
  sensitive   = true
  description = "Full Postgres connection string (Neon). Must include sslmode=require. Set in terraform.tfvars; never committed."
}

variable "apple_bundle_id" {
  type        = string
  default     = ""
  description = "Apple iOS bundle ID — used as the `aud` for native Sign in with Apple tokens. Empty string is allowed so `terraform apply` works before portal config; backend rejects verification until this is set."
}

variable "apple_services_id" {
  type        = string
  default     = ""
  description = "Apple Services ID — used as the `aud` for web Sign in with Apple tokens. Configured in the Apple Developer portal; paste the identifier here."
}

variable "google_ios_client_id" {
  type        = string
  default     = ""
  description = "Google OAuth iOS client ID — matches the `aud` claim on native Google sign-in tokens."
}

variable "google_web_client_id" {
  type        = string
  default     = ""
  description = "Google OAuth web client ID — matches the `aud` claim on web Google sign-in tokens."
}

variable "tmdb_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "TMDB API key for movie/TV search enrichment (Phase 2). Empty default lets infra apply before the key is obtained."
}

variable "google_books_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Google Books API key for book search enrichment (Phase 2). Empty default lets infra apply before the key is obtained."
}

variable "spotify_client_id" {
  type        = string
  default     = ""
  description = "Spotify Web API client ID. Register an app at https://developer.spotify.com/dashboard. Empty default lets infra apply before the app is registered."
}

variable "spotify_client_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Spotify Web API client secret. Used in the Authorization Code token exchange when PKCE is paired with confidential clients."
}

variable "spotify_redirect_uri" {
  type        = string
  default     = ""
  description = "Redirect URI registered on the Spotify dashboard. Must point at the deployed API: https://<api>/v1/spotify/auth/callback."
}

variable "spotify_app_redirect_uri" {
  type        = string
  default     = ""
  description = "Where the backend redirects the browser after a successful Spotify callback. Typically the workshop:// deep link or the web app origin."
}
