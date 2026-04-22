resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "aws_security_group" "db" {
  name        = "${local.prefix}-db"
  description = "Public prototype access to RDS. Locks down before launch."

  ingress {
    description = "Postgres from anywhere (TLS + strong password required)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_parameter_group" "pg" {
  name   = "${local.prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "main" {
  identifier             = local.prefix
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = random_password.db.result
  parameter_group_name   = aws_db_parameter_group.pg.name
  publicly_accessible    = true
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period = 7
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true

  performance_insights_enabled = false
  monitoring_interval          = 0
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/${local.prefix}/db/password"
  type  = "SecureString"
  value = random_password.db.result
}

resource "aws_ssm_parameter" "db_url" {
  name  = "/${local.prefix}/db/url"
  type  = "SecureString"
  value = "postgres://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.endpoint}/${var.db_name}?sslmode=require"
}

resource "aws_ssm_parameter" "session_secret" {
  name  = "/${local.prefix}/session_secret"
  type  = "SecureString"
  value = random_password.session_secret.result
}
