resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.ses_verified_email
}

output "ses_verification_notice" {
  value = "After apply, check ${var.ses_verified_email} and click the AWS SES verification link before sending mail."
}
