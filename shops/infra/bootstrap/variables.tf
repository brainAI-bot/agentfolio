variable "aws_region" {
  type    = string
  default = "eu-north-1"

  validation {
    condition     = var.aws_region == "eu-north-1"
    error_message = "The Makings bootstrap is approved only for eu-north-1."
  }
}

variable "github_environment" {
  description = "GitHub environment protected so only refs/heads/main can deploy and principal approval is required."
  type        = string
  default     = "makings-production"

  validation {
    condition     = var.github_environment == "makings-production"
    error_message = "The trust policy is fixed to the protected makings-production environment."
  }
}
