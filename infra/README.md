# infra/

Terraform for this project's AWS resources. Currently just the ECR
repositories and the GitHub Actions OIDC deploy role (Part 0 of the
deployment pipeline) — EC2/VPC/networking is a later part, not yet added
here.

State is local (`terraform.tfstate`, gitignored) — fine for one operator;
move to an S3 backend before more than one person runs `apply` against
this.

```bash
cd infra
terraform init
terraform plan
terraform apply
```

Region is `ap-south-1` (Mumbai) by default — see `variables.tf`. This
project's resources live in the same shared AWS account as other
unrelated projects; everything here is tagged `project = "court-booking-app"`
(via the provider's `default_tags`) to stay distinguishable.

After `apply`, `terraform output` prints the two ECR repository URLs and
the `github_actions_role_arn` — the latter goes into the GitHub repo as
the `AWS_ROLE_ARN` secret/variable the deploy workflow assumes via OIDC.
