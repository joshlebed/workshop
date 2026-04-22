terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # State lives in HCP Terraform (free tier). Configure via `terraform login`
  # then set org/workspace here. Migrate to s3 backend later if desired.
  cloud {
    organization = "joshlebed"
    workspaces {
      name = "workshop-prod"
    }
  }
}
