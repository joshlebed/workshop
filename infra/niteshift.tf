# Niteshift AWS integration: a role in *this* account that Niteshift's
# account assumes (with an External ID) to inject short-lived (1h, auto-
# refreshed) credentials into per-task sandboxes. See:
#   apps/web/src/components/repo-settings/AwsIntegration.tsx — UI flow
#   apps/web/src/runtime/provisioners/aws-integration-provisioner.ts — STS call
#
# Niteshift's session policy denies iam:*, organizations:*, account:*,
# billing:*, budgets:*, ce:*, cur:*, support:*, trustedadvisor:*,
# aws-portal:* — so even with AdministratorAccess attached here the in-
# sandbox effective permissions exclude the truly destructive surfaces.
#
# Trust + External ID rotate per-repo. If the External ID leaks, rotate
# it in the Niteshift UI ("Generate New ID") and update
# var.niteshift_external_id in terraform.tfvars in the same change.

data "aws_iam_policy_document" "niteshift_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.niteshift_aws_account_id}:root"]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.niteshift_external_id]
    }
  }
}

resource "aws_iam_role" "niteshift" {
  name               = "${local.prefix}-niteshift"
  assume_role_policy = data.aws_iam_policy_document.niteshift_assume.json
  description        = "Assumed by Niteshift (account ${var.niteshift_aws_account_id}) to inject short-lived AWS credentials into per-task sandboxes for this repo."

  # Session duration cap. Niteshift requests 1h tokens and auto-refreshes;
  # this is the hard ceiling per assume call.
  max_session_duration = 3600
}

# Per user direction: AdministratorAccess for development iteration. The
# Niteshift session policy still caps iam/org/billing/support surfaces in-
# sandbox, so this is "everything operational, nothing org-mutating".
resource "aws_iam_role_policy_attachment" "niteshift_admin" {
  role       = aws_iam_role.niteshift.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
