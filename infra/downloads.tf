# Ledger v2 rollout (founder 14 Nov): the owners' Android app is installed from an APK (no Play Store). The "Update karein"
# screen and https://<web>/app need ONE fixed link that always gives the latest APK.
#
# A SEPARATE bucket on purpose: the payment-proof and venue-photo buckets above stay fully private and are not touched.
# Here only objects under app/ are publicly readable (GetObject); nothing can be listed, ACLs stay disabled, and the rest
# of the bucket (if anything is ever put there) stays private. Versioning keeps every APK that was overwritten.
#
# Files (see infra/scripts/publish-apk.sh and infra/APP-DOWNLOADS.md):
#   app/khelo-latest.apk          the fixed link, replaced on every release
#   app/khelo-YYYY-MM-DD-<sha>.apk a dated copy of each release
#
# NOT APPLIED YET. `terraform plan` first and read it: it must only ADD the resources below.
locals {
  downloads_bucket = "${var.project_name}-app-downloads-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "downloads" {
  bucket = local.downloads_bucket
}

resource "aws_s3_bucket_ownership_controls" "downloads" {
  bucket = aws_s3_bucket.downloads.id
  rule {
    object_ownership = "BucketOwnerEnforced" # ACLs off: access is decided by the policy below only
  }
}

# Only the public POLICY is allowed (for app/*). Public ACLs stay blocked and ignored.
resource "aws_s3_bucket_public_access_block" "downloads" {
  bucket                  = aws_s3_bucket.downloads.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "downloads_public_app_prefix" {
  bucket = aws_s3_bucket.downloads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadAppPrefixOnly"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject" # read one known file; no s3:ListBucket, so the bucket cannot be listed
      Resource  = "${aws_s3_bucket.downloads.arn}/app/*"
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.downloads]
}

resource "aws_s3_bucket_versioning" "downloads" {
  bucket = aws_s3_bucket.downloads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "downloads" {
  bucket = aws_s3_bucket.downloads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # not KMS: a public GetObject cannot use a customer KMS key
    }
  }
}

# Old overwritten khelo-latest.apk versions are kept 90 days, then removed (the dated copies stay).
resource "aws_s3_bucket_lifecycle_configuration" "downloads" {
  bucket = aws_s3_bucket.downloads.id
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
  depends_on = [aws_s3_bucket_versioning.downloads]
}

output "downloads_bucket" {
  value = aws_s3_bucket.downloads.bucket
}

output "apk_latest_url" {
  description = "The fixed latest-APK link; the web's /app redirects here (APK_URL in .env.web overrides it)."
  value       = "https://${aws_s3_bucket.downloads.bucket_regional_domain_name}/app/khelo-latest.apk"
}
