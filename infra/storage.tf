# Section 25, Part 4 -- S3 + KMS + CloudFront.
#
# Bucket names are global across all AWS accounts, so the account id is
# appended to keep them collision-free and deterministic.

locals {
  proofs_bucket = "${var.project_name}-payment-proofs-${data.aws_caller_identity.current.account_id}"
  photos_bucket = "${var.project_name}-venue-photos-${data.aws_caller_identity.current.account_id}"
}

resource "aws_kms_key" "proofs" {
  description             = "${var.project_name} payment-proof bucket encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "proofs" {
  name          = "alias/${var.project_name}-payment-proofs"
  target_key_id = aws_kms_key.proofs.key_id
}

# --- payment proofs: private, KMS-encrypted, versioned ---

resource "aws_s3_bucket" "proofs" {
  bucket = local.proofs_bucket
}

resource "aws_s3_bucket_public_access_block" "proofs" {
  bucket                  = aws_s3_bucket.proofs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "proofs" {
  bucket = aws_s3_bucket.proofs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "proofs" {
  bucket = aws_s3_bucket.proofs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "proofs" {
  bucket = aws_s3_bucket.proofs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.proofs.arn
    }
    bucket_key_enabled = true # cuts KMS request cost
  }
}

# Versioning keeps every overwritten/deleted proof forever unless told
# otherwise -- expire only the *noncurrent* versions, never current proofs
# (they're evidence for payment disputes).
resource "aws_s3_bucket_lifecycle_configuration" "proofs" {
  bucket = aws_s3_bucket.proofs.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  depends_on = [aws_s3_bucket_versioning.proofs]
}

# --- venue photos: readable ONLY through CloudFront ---
#
# DEVIATION from the spec's "public read" wording, deliberately: the bucket
# stays fully private and CloudFront reads it via Origin Access Control.
# Same end result for players (public photo URLs via CLOUDFRONT_DOMAIN,
# which the backend's public_url() already prefers), but the bucket itself
# is never publicly listable/readable, and CloudFront can't be bypassed.
# The backend uploads without ACLs (app/utils/s3.py), so nothing depends on
# the bucket being public.

resource "aws_s3_bucket" "photos" {
  bucket = local.photos_bucket
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "photos" {
  name                              = "${var.project_name}-photos"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed "CachingOptimized" cache policy.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "photos" {
  enabled         = true
  comment         = "${var.project_name} venue photos"
  price_class     = "PriceClass_200" # includes Asia edges; _100 (NA/EU only) would serve Karachi from far away
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.photos.bucket_regional_domain_name
    origin_id                = "photos-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.photos.id
  }

  default_cache_behavior {
    target_origin_id       = "photos-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "photos" {
  bucket = aws_s3_bucket.photos.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.photos.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.photos.arn }
      }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.photos]
}

# Non-secret infra values the instance's bootstrap script reads to assemble
# its .env -- published to SSM so nothing is hand-copied between Terraform
# output and the box. (Secrets under /<project>/secrets/* are NOT managed
# here on purpose: keeping API keys out of terraform.tfstate.)
resource "aws_ssm_parameter" "kms_key_arn" {
  name  = "/${var.project_name}/infra/kms_key_arn"
  type  = "String"
  value = aws_kms_key.proofs.arn
}

resource "aws_ssm_parameter" "proofs_bucket" {
  name  = "/${var.project_name}/infra/proofs_bucket"
  type  = "String"
  value = aws_s3_bucket.proofs.bucket
}

resource "aws_ssm_parameter" "photos_bucket" {
  name  = "/${var.project_name}/infra/photos_bucket"
  type  = "String"
  value = aws_s3_bucket.photos.bucket
}

resource "aws_ssm_parameter" "cloudfront_domain" {
  name  = "/${var.project_name}/infra/cloudfront_domain"
  type  = "String"
  value = aws_cloudfront_distribution.photos.domain_name
}
