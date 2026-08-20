# MOM Multi-Site Application

Three subdomain Node.js sites behind an Apache reverse proxy.
Runs as a single ECS Fargate task with 4 containers.

---

## Architecture

```
Internet
    │
   ALB (port 80/443)
    │
    ├── site1.yourdomain.com ──┐
    ├── site2.yourdomain.com ──┤──→ ECS Task (port 80)
    └── site3.yourdomain.com ──┘         │
                                    [Apache :80]
                                         │
                              ┌──────────┼──────────┐
                         [app1 :3001] [app2 :3002] [app3 :3003]
```

All 4 containers share `localhost` inside the ECS task (awsvpc network mode).

---

## Project Structure

```
mom_test/
├── README.md
├── Jenkinsfile
├── docker-compose.yml          ← local testing
├── ecs-task-definition.json    ← ECS deployment
├── app1/
│   ├── Dockerfile              (amazonlinux:2023 + Node.js)
│   ├── package.json
│   └── server.js               (Express, port 3001)
├── app2/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js               (Express, port 3002)
├── app3/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js               (Express, port 3003)
└── apache/
    ├── Dockerfile              (httpd:2.4)
    └── vhosts.conf             (reverse proxy config)
```

---

## Prerequisites

- Docker & Docker Compose installed
- AWS CLI configured (`aws configure`)
- AWS account with ECS, ECR, IAM permissions
- Jenkins with AWS credentials configured (for CI/CD)

---

## Part 1 — Local Testing with Docker Compose

### Step 1 — Add local hostnames

```bash
sudo sh -c 'echo "127.0.0.1  site1.local site2.local site3.local" >> /etc/hosts'
```

### Step 2 — Build and start

```bash
cd ~/scripts/mom_test
docker-compose up --build
```

### Step 3 — Test

```bash
# Each subdomain site
curl http://site1.local
curl http://site2.local
curl http://site3.local

# Health checks
curl http://site1.local/health
curl http://site2.local/health
curl http://site3.local/health
```

Expected response for health check:
```json
{ "status": "ok", "site": "Site 1", "port": 3001 }
```

### Step 4 — Stop

```bash
docker-compose down
```

---

## Part 2 — ECS Deployment

### Step 1 — Create ECR repositories

```bash
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=us-east-1   # change to your region

for repo in mom-apache mom-app1 mom-app2 mom-app3; do
  aws ecr create-repository --repository-name $repo --region $AWS_REGION
done
```

### Step 2 — Authenticate Docker to ECR

```bash
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

### Step 3 — Build and push images

```bash
# Build
docker build -t mom-apache ./apache
docker build -t mom-app1   ./app1
docker build -t mom-app2   ./app2
docker build -t mom-app3   ./app3

# Tag
docker tag mom-apache $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-apache:latest
docker tag mom-app1   $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-app1:latest
docker tag mom-app2   $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-app2:latest
docker tag mom-app3   $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-app3:latest

# Push
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-apache:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-app1:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-app2:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/mom-app3:latest
```

### Step 4 — Update task definition placeholders

```bash
sed -i "s/<ACCOUNT_ID>/$AWS_ACCOUNT_ID/g" ecs-task-definition.json
sed -i "s/<REGION>/$AWS_REGION/g"         ecs-task-definition.json
```

### Step 5 — Create CloudWatch log group

```bash
aws logs create-log-group --log-group-name /ecs/mom-app --region $AWS_REGION
```

### Step 6 — Register task definition

```bash
aws ecs register-task-definition \
  --cli-input-json file://ecs-task-definition.json \
  --region $AWS_REGION
```

### Step 7 — Create ECS Cluster (if not exists)

```bash
aws ecs create-cluster --cluster-name mom-cluster --region $AWS_REGION
```

### Step 8 — Create ECS Service

```bash
aws ecs create-service \
  --cluster mom-cluster \
  --service-name mom-service \
  --task-definition mom-app \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={
    subnets=[subnet-xxxxxxxx],
    securityGroups=[sg-xxxxxxxx],
    assignPublicIp=ENABLED
  }" \
  --region $AWS_REGION
```

> Replace `subnet-xxxxxxxx` and `sg-xxxxxxxx` with your VPC values.

### Step 9 — Verify deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster mom-cluster \
  --services mom-service \
  --region $AWS_REGION \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# Check running tasks
aws ecs list-tasks --cluster mom-cluster --region $AWS_REGION
```

---

## Part 3 — Subdomain Configuration

### Update Apache vhosts for real domains

Edit `apache/vhosts.conf` and replace `site1.local`, `site2.local`, `site3.local`
with your real subdomain names:

```apache
ServerName site1.yourdomain.com   # ← change this
```

### ALB Host-Based Routing (production)

Create listener rules on your ALB:
```
site1.yourdomain.com → Target Group → ECS Service port 80
site2.yourdomain.com → Target Group → ECS Service port 80
site3.yourdomain.com → Target Group → ECS Service port 80
```

Apache then handles the final routing to the correct Node.js app internally.

---

## Customising the Apps

| File | What to change |
|---|---|
| `app1/server.js` | Add your routes and business logic |
| `app2/server.js` | Add your routes and business logic |
| `app3/server.js` | Add your routes and business logic |
| `apache/vhosts.conf` | Change ServerName to real subdomains |
| `ecs-task-definition.json` | Adjust CPU/memory, add env vars, secrets |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3001/3002/3003 | Port the Node.js app listens on |
| `SITE_NAME` | Site 1/2/3 | Display name shown on the page |

---

## Troubleshooting

**Containers not starting locally:**
```bash
docker-compose logs apache
docker-compose logs app1
```

**ECS task failing:**
```bash
aws ecs describe-tasks \
  --cluster mom-cluster \
  --tasks <task-arn> \
  --region $AWS_REGION
```

**Check CloudWatch logs:**
```
Log group : /ecs/mom-app
Streams   : apache/*, app1/*, app2/*, app3/*
```

**Apache not proxying:**
- Confirm all 3 Node.js apps are healthy before Apache starts
- Check health endpoint: `curl http://localhost:3001/health`
