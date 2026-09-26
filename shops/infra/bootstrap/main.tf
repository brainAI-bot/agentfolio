data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  required_tags = {
    Project     = "Makings"
    Product     = "Shops"
    Option      = "3"
    Environment = "production"
    ManagedBy   = "Terraform"
    Repository  = "brainAI-bot/agentfolio"
  }

  oidc_subject = "repo:brainAI-bot/agentfolio:environment:${var.github_environment}"
}

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]
  tags           = local.required_tags
}

resource "aws_iam_policy" "workload_boundary" {
  name        = "makings-shops-workload-boundary"
  path        = "/makings/shops/"
  description = "Maximum permissions for Makings Shops ECS workload roles"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "WorkloadDataPlaneOnly"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "logs:CreateLogStream", "logs:PutLogEvents", "s3:ListBucket", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "rds-db:connect"]
        Resource = "*"
      },
      {
        Sid      = "DenyAdministrationAndDeletion"
        Effect   = "Deny"
        Action   = ["iam:*", "organizations:*", "account:*", "route53:*", "acm:*", "kms:*", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock", "s3:PutEncryptionConfiguration", "s3:PutLifecycleConfiguration", "s3:PutBucketVersioning"]
        Resource = "*"
      }
    ]
  })

  tags = local.required_tags
}

resource "aws_iam_role" "github_deployer" {
  name                 = "makings-shops-github-deployer"
  path                 = "/makings/shops/"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.oidc_subject
        }
      }
    }]
  })

  tags = local.required_tags
}

resource "aws_iam_role_policy" "github_deployer" {
  name = "makings-tagged-option3-only"
  role = aws_iam_role.github_deployer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadForTerraform"
        Effect   = "Allow"
        Action   = ["budgets:ViewBudget", "ec2:Describe*", "elasticloadbalancing:Describe*", "ecs:Describe*", "ecs:List*", "ecr:Describe*", "ecr:List*", "logs:Describe*", "rds:Describe*", "s3:GetBucket*", "s3:GetLifecycleConfiguration", "s3:GetEncryptionConfiguration", "s3:ListAllMyBuckets", "iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "sts:GetCallerIdentity"]
        Resource = "*"
      },
      {
        Sid      = "CreateMakingsTaggedRegionalResources"
        Effect   = "Allow"
        Action   = ["ec2:CreateVpc", "ec2:CreateSubnet", "ec2:CreateInternetGateway", "ec2:CreateRouteTable", "ec2:CreateRoute", "ec2:CreateSecurityGroup", "ec2:CreateTags", "elasticloadbalancing:CreateLoadBalancer", "elasticloadbalancing:CreateTargetGroup", "elasticloadbalancing:CreateListener", "ecs:CreateCluster", "ecs:RegisterTaskDefinition", "ecs:CreateService", "ecr:CreateRepository", "logs:CreateLogGroup", "rds:CreateDBSubnetGroup", "rds:CreateDBParameterGroup", "rds:CreateDBInstance", "s3:CreateBucket", "budgets:ModifyBudget"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestedRegion"       = var.aws_region
            "aws:RequestTag/Project"    = "Makings"
            "aws:RequestTag/Repository" = "brainAI-bot/agentfolio"
          }
          "ForAllValues:StringEquals" = {
            "aws:TagKeys" = ["Project", "Product", "Option", "Environment", "ManagedBy", "Repository", "Name", "Tier"]
          }
        }
      },
      {
        Sid      = "MutateExistingMakingsResources"
        Effect   = "Allow"
        Action   = ["ec2:AttachInternetGateway", "ec2:AssociateRouteTable", "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:ModifyVpcAttribute", "elasticloadbalancing:ModifyLoadBalancerAttributes", "elasticloadbalancing:ModifyTargetGroup", "elasticloadbalancing:ModifyTargetGroupAttributes", "elasticloadbalancing:ModifyListener", "ecs:UpdateService", "ecs:PutClusterCapacityProviders", "ecr:PutLifecyclePolicy", "ecr:PutImageScanningConfiguration", "logs:PutRetentionPolicy", "rds:ModifyDBInstance", "rds:ModifyDBParameterGroup", "s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock", "s3:PutBucketOwnershipControls", "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration", "s3:PutLifecycleConfiguration"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestedRegion"     = var.aws_region
            "aws:ResourceTag/Project" = "Makings"
          }
        }
      },
      {
        Sid      = "CreateBoundedWorkloadRoles"
        Effect   = "Allow"
        Action   = ["iam:CreateRole", "iam:TagRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]
        Resource = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/makings/shops/makings-shops-*"
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = aws_iam_policy.workload_boundary.arn
            "aws:RequestTag/Project"  = "Makings"
          }
        }
      },
      {
        Sid      = "PassOnlyMakingsEcsRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/makings/shops/makings-shops-*"
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Sid      = "DeleteOnlyMakingsTaggedResources"
        Effect   = "Allow"
        Action   = ["ec2:DeleteVpc", "ec2:DeleteSubnet", "ec2:DeleteInternetGateway", "ec2:DetachInternetGateway", "ec2:DeleteRouteTable", "ec2:DeleteRoute", "ec2:DisassociateRouteTable", "ec2:DeleteSecurityGroup", "elasticloadbalancing:DeleteLoadBalancer", "elasticloadbalancing:DeleteTargetGroup", "elasticloadbalancing:DeleteListener", "ecs:DeleteCluster", "ecs:DeleteService", "ecs:DeregisterTaskDefinition", "ecr:DeleteRepository", "logs:DeleteLogGroup", "rds:DeleteDBInstance", "rds:DeleteDBSubnetGroup", "rds:DeleteDBParameterGroup", "s3:DeleteBucket"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:ResourceTag/Project" = "Makings" }
        }
      },
      {
        Sid      = "DenyBootstrapAndExcludedServices"
        Effect   = "Deny"
        Action   = ["iam:UpdateAssumeRolePolicy", "iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint", "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "organizations:*", "account:*", "route53:*", "acm:*", "kms:CreateKey", "kms:ScheduleKeyDeletion"]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_deployer.arn
}

output "workload_permissions_boundary_arn" {
  value = aws_iam_policy.workload_boundary.arn
}

output "trusted_oidc_subject" {
  value = local.oidc_subject
}
