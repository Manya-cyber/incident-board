variable "aws_region" {
  description = "AWS region to deploy to"
  default     = "us-east-1"
}

variable "db_password" {
  description = "Password for the RDS database"
  type        = string
  sensitive   = true
}