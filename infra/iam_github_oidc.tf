# GitHub OIDC provider so CI can assume an AWS role without long-lived keys.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/main",
        "repo:${var.github_repository}:pull_request",
        "repo:${var.github_repository}:environment:production",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${local.prefix}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "github_permissions" {
  statement {
    sid    = "LambdaDeploy"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:PublishVersion",
    ]
    resources = [aws_lambda_function.api.arn]
  }

  # Read access for all /workshop-prod/* params. Two callers share this:
  #   - deploy-backend.yml reads db_url + session_secret for migrations.
  #   - terraform.yml plan refreshes every SSM resource it manages, which
  #     is the full set under this prefix. Scoping tighter than the prefix
  #     means every new SSM param needs a paired IAM grant or plan 403s
  #     and the required `terraform plan` check blocks the PR. Apply uses
  #     a separate AdministratorAccess role, so this prefix grant is the
  #     least-privilege ceiling for what plan can read.
  statement {
    sid    = "ReadWorkshopProdSecrets"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${local.prefix}/*",
    ]
  }

  statement {
    sid    = "DescribeForDeployVerification"
    effect = "Allow"
    actions = [
      "apigateway:GET",
      "logs:DescribeLogGroups",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_actions" {
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_permissions.json
}

# Terraform apply role: assumable ONLY from main-branch push (post-merge auto-
# apply via .github/workflows/terraform.yml). The `sub` claim for `push` events
# is `repo:<r>:ref:refs/heads/main`; fork PRs and pull_request events cannot
# produce this sub, so they cannot assume this role even with `id-token: write`
# permissions on their workflow.
#
# AdministratorAccess is broad on purpose: Terraform manages IAM (including
# this role and its trust policy), the OIDC provider, API Gateway, Lambda,
# SSM, budgets, logs — scoping tighter requires constant least-privilege
# debugging without meaningfully shrinking blast radius (the role can already
# rewrite its own trust policy). The compensating control is `sub`-restriction
# to main branch: only a merged commit can assume this role.
data "aws_iam_policy_document" "github_terraform_apply_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions_tf_apply" {
  name               = "${local.prefix}-github-actions-tf-apply"
  assume_role_policy = data.aws_iam_policy_document.github_terraform_apply_assume.json
}

resource "aws_iam_role_policy_attachment" "github_actions_tf_apply_admin" {
  role       = aws_iam_role.github_actions_tf_apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
