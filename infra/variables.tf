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
  description = "Email address to verify in SES as the sender (and, in sandbox mode, as a recipient). A verification email will be sent here after apply."
}

variable "budget_email_recipient" {
  type        = string
  description = "Email to receive the $5 monthly AWS budget alert. Usually the same as ses_verified_email."
}

variable "db_name" {
  type        = string
  default     = "workshop"
  description = "Initial PostgreSQL database name."
}

variable "db_username" {
  type        = string
  default     = "workshop_admin"
  description = "RDS master username."
}
