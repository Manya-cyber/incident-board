#!/bin/bash
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
set -x

yum update -y
yum install -y docker -y
systemctl start docker
systemctl enable docker

# Wait for network
sleep 10

# Pull the image
docker pull manyaaaa/incident-board:latest

# Run container with HARDCODED environment variables
docker run -d -p 3000:3000 \
  -e DB_HOST=incident-db.ckxg2c46cco8.us-east-1.rds.amazonaws.com \
  -e DB_PORT=5432 \
  -e DB_USER=incident_user \
  -e DB_PASSWORD=YourStrongPassword123! \
  -e DB_NAME=incidentdb \
  -e REDIS_HOST=incident-redis.fvnsrm.ng.0001.use1.cache.amazonaws.com \
  -e REDIS_PORT=6379 \
  -e JWT_SECRET=your-super-secret-key-here \
  --restart always \
  --name incident-app \
  manyaaaa/incident-board:latest

# Check if running
sleep 10
docker ps | grep incident-app
curl http://localhost:3000/health || echo "Health check failed!"