pipeline {
    agent any

    environment {
        AWS_REGION      = 'us-east-1'                    // change to your region
        ECS_CLUSTER     = 'mom-cluster'
        ECS_SERVICE     = 'mom-service'
        TASK_FAMILY     = 'mom-app'
        LOG_GROUP       = '/ecs/mom-app'

        // ECR repos — populated dynamically from AWS account
        ECR_REGISTRY    = "${sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()}.dkr.ecr.${AWS_REGION}.amazonaws.com"

        IMAGE_APACHE    = "${ECR_REGISTRY}/mom-apache"
        IMAGE_APP1      = "${ECR_REGISTRY}/mom-app1"
        IMAGE_APP2      = "${ECR_REGISTRY}/mom-app2"
        IMAGE_APP3      = "${ECR_REGISTRY}/mom-app3"
    }

    parameters {
        string(name: 'IMAGE_TAG', defaultValue: 'latest', description: 'Docker image tag (e.g. latest, v1.0.0, or use BUILD_NUMBER)')
        booleanParam(name: 'DEPLOY_TO_ECS', defaultValue: true, description: 'Deploy to ECS after build?')
    }

    stages {

        // ── Stage 1: Checkout ─────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                sh 'echo "Branch: ${GIT_BRANCH} | Commit: ${GIT_COMMIT}"'
            }
        }

        // ── Stage 2: ECR Login ────────────────────────────────────
        stage('ECR Login') {
            steps {
                withCredentials([[$class: 'AmazonWebServicesCredentialsBinding',
                                  credentialsId: 'aws-credentials']]) {
                    sh '''
                        aws ecr get-login-password --region $AWS_REGION | \
                        docker login --username AWS --password-stdin $ECR_REGISTRY
                    '''
                }
            }
        }

        // ── Stage 3: Build Images ─────────────────────────────────
        stage('Build') {
            parallel {
                stage('Build Apache') {
                    steps {
                        sh "docker build -t ${IMAGE_APACHE}:${params.IMAGE_TAG} ./apache"
                    }
                }
                stage('Build App1') {
                    steps {
                        sh "docker build -t ${IMAGE_APP1}:${params.IMAGE_TAG} ./app1"
                    }
                }
                stage('Build App2') {
                    steps {
                        sh "docker build -t ${IMAGE_APP2}:${params.IMAGE_TAG} ./app2"
                    }
                }
                stage('Build App3') {
                    steps {
                        sh "docker build -t ${IMAGE_APP3}:${params.IMAGE_TAG} ./app3"
                    }
                }
            }
        }

        // ── Stage 4: Local Smoke Test ─────────────────────────────
        stage('Smoke Test') {
            steps {
                sh '''
                    echo "Starting containers for smoke test..."
                    docker-compose up -d --build

                    echo "Waiting for apps to be ready..."
                    sleep 10

                    echo "Testing health endpoints..."
                    curl -sf http://localhost:3001/health | grep '"status":"ok"'
                    curl -sf http://localhost:3002/health | grep '"status":"ok"'
                    curl -sf http://localhost:3003/health | grep '"status":"ok"'

                    echo "All health checks passed."
                '''
            }
            post {
                always {
                    sh 'docker-compose down || true'
                }
            }
        }

        // ── Stage 5: Push Images ──────────────────────────────────
        stage('Push') {
            steps {
                withCredentials([[$class: 'AmazonWebServicesCredentialsBinding',
                                  credentialsId: 'aws-credentials']]) {
                    sh '''
                        docker push ${IMAGE_APACHE}:${IMAGE_TAG}
                        docker push ${IMAGE_APP1}:${IMAGE_TAG}
                        docker push ${IMAGE_APP2}:${IMAGE_TAG}
                        docker push ${IMAGE_APP3}:${IMAGE_TAG}

                        # Also tag and push as latest
                        docker tag ${IMAGE_APACHE}:${IMAGE_TAG} ${IMAGE_APACHE}:latest
                        docker tag ${IMAGE_APP1}:${IMAGE_TAG}   ${IMAGE_APP1}:latest
                        docker tag ${IMAGE_APP2}:${IMAGE_TAG}   ${IMAGE_APP2}:latest
                        docker tag ${IMAGE_APP3}:${IMAGE_TAG}   ${IMAGE_APP3}:latest

                        docker push ${IMAGE_APACHE}:latest
                        docker push ${IMAGE_APP1}:latest
                        docker push ${IMAGE_APP2}:latest
                        docker push ${IMAGE_APP3}:latest
                    '''
                }
            }
        }

        // ── Stage 6: Update Task Definition & Deploy ─────────────
        stage('Deploy to ECS') {
            when {
                expression { params.DEPLOY_TO_ECS == true }
            }
            steps {
                withCredentials([[$class: 'AmazonWebServicesCredentialsBinding',
                                  credentialsId: 'aws-credentials']]) {
                    sh '''
                        # Get current task definition
                        TASK_DEF=$(aws ecs describe-task-definition \
                            --task-definition $TASK_FAMILY \
                            --region $AWS_REGION \
                            --query 'taskDefinition' \
                            --output json)

                        # Update image tags in task definition
                        NEW_TASK_DEF=$(echo $TASK_DEF | python3 -c "
import json, sys
td = json.load(sys.stdin)
for c in td['containerDefinitions']:
    if c['name'] == 'apache': c['image'] = '${IMAGE_APACHE}:${IMAGE_TAG}'
    if c['name'] == 'app1':   c['image'] = '${IMAGE_APP1}:${IMAGE_TAG}'
    if c['name'] == 'app2':   c['image'] = '${IMAGE_APP2}:${IMAGE_TAG}'
    if c['name'] == 'app3':   c['image'] = '${IMAGE_APP3}:${IMAGE_TAG}'
# Remove fields not accepted by register-task-definition
for key in ['taskDefinitionArn','revision','status','requiresAttributes',
            'compatibilities','registeredAt','registeredBy']:
    td.pop(key, None)
print(json.dumps(td))
")

                        # Register new task definition revision
                        NEW_REVISION=$(aws ecs register-task-definition \
                            --cli-input-json "$NEW_TASK_DEF" \
                            --region $AWS_REGION \
                            --query 'taskDefinition.revision' \
                            --output text)

                        echo "Registered task definition revision: $NEW_REVISION"

                        # Update ECS service to use new revision
                        aws ecs update-service \
                            --cluster $ECS_CLUSTER \
                            --service $ECS_SERVICE \
                            --task-definition ${TASK_FAMILY}:${NEW_REVISION} \
                            --region $AWS_REGION \
                            --force-new-deployment

                        echo "ECS service updated. Waiting for deployment to stabilize..."

                        # Wait for service to be stable
                        aws ecs wait services-stable \
                            --cluster $ECS_CLUSTER \
                            --services $ECS_SERVICE \
                            --region $AWS_REGION

                        echo "Deployment complete."
                    '''
                }
            }
        }
    }

    // ── Post Actions ──────────────────────────────────────────────
    post {
        success {
            echo "Pipeline succeeded. Images pushed with tag: ${params.IMAGE_TAG}"
        }
        failure {
            echo "Pipeline failed. Check logs above."
            sh 'docker-compose down || true'
        }
        always {
            // Clean up local Docker images to save disk space
            sh '''
                docker rmi ${IMAGE_APACHE}:${IMAGE_TAG} || true
                docker rmi ${IMAGE_APP1}:${IMAGE_TAG}   || true
                docker rmi ${IMAGE_APP2}:${IMAGE_TAG}   || true
                docker rmi ${IMAGE_APP3}:${IMAGE_TAG}   || true
            '''
        }
    }
}
