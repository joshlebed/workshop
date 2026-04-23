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

variable "ses_verified_email" {
  type        = string
  default     = "joshlebed@gmail.com"
  description = "Email address to verify in SES as the sender (and, in sandbox mode, as a recipient). A verification email will be sent here after apply."
}

variable "budget_email_recipient" {
  type        = string
  default     = "joshlebed@gmail.com"
  description = "Email to receive the $5 monthly AWS budget alert. Usually the same as ses_verified_email."
}

variable "database_url" {
  type        = string
  sensitive   = true
  description = "Full Postgres connection string (Neon). Must include sslmode=require. Set in terraform.tfvars.local; never committed."
}
