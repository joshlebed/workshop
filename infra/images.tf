# User-uploaded images (profile pictures, list cover photos).
#
# They used to live in Postgres as base64 text, where every read counted
# against Neon's network transfer allowance (4.25 of 5 GB by day 18 of
# Nov 2026). An S3 object in the Lambda's own region costs nothing to read and
# ~$0.023/GB-month to keep. Migration plan and runbook:
# docs/image-storage-migration.md.
#
# The bucket is private. Images are served by the API (`GET /v1/images/*`,
# apps/backend/src/lib/images.ts), so there is no public URL and no CDN.
resource "aws_s3_bucket" "images" {
  bucket = "${local.prefix}-images-${data.aws_caller_identity.current.account_id}"

  # A `terraform destroy` or a renamed resource must never take user uploads
  # with it. Removing this bucket is a deliberate, manual act.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket = aws_s3_bucket.images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning is the undo for a bad delete or overwrite: the old object stays
# as a noncurrent version for 14 days. That is also how long a deleted
# account's picture lingers before it is gone for good.
resource "aws_s3_bucket_versioning" "images" {
  bucket = aws_s3_bucket.images.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  rule {
    id     = "expire-noncurrent"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 14
    }

    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.images]
}

resource "aws_iam_role_policy" "lambda_images" {
  name = "${local.prefix}-lambda-images"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.images.arn}/*"
      },
      {
        # Without ListBucket a missing key reads as AccessDenied instead of
        # NoSuchKey, and the image routes would 500 where they should 404.
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.images.arn
      },
    ]
  })
}

# Cache of the sandbox's copy of prod. Every Niteshift sandbox used to
# `pg_dump` prod on start (~90 dumps a month, about a fifth of Neon's transfer
# allowance); now the first sandbox of the day dumps and uploads, and the rest
# download from here (.niteshift/files/db.sh). Holds the same user data the
# sandboxes already hold, so it is private, and objects expire after a week.
resource "aws_s3_bucket" "dev_snapshots" {
  bucket = "${local.prefix}-dev-snapshots-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "dev_snapshots" {
  bucket = aws_s3_bucket.dev_snapshots.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "dev_snapshots" {
  bucket = aws_s3_bucket.dev_snapshots.id

  rule {
    id     = "expire-snapshots"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
