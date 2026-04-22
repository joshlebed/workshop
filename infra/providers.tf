provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = local.project
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
