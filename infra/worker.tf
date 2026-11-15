resource "aws_security_group" "worker" {
  name        = "dd-worker"
  description = "Worker egress only. No inbound, including SSH."
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS for SSM, S3, and Parameter Store"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "dd-worker"
  }
}

resource "aws_instance" "worker" {
  ami                         = var.ami_id
  instance_type               = "t4g.nano"
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.worker.id]
  iam_instance_profile        = aws_iam_instance_profile.worker.name
  associate_public_ip_address = true
  user_data                   = templatefile("${path.module}/worker-user-data.sh", { bucket = var.bucket_name })
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
  }

  tags = {
    Name = "dd-worker"
  }
}
