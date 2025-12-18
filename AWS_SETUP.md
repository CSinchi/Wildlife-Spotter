# AWS Infrastructure Setup Guide

This guide details the manual steps required to set up the secure networking and database environment for the Wildlife Spotter backend on AWS Lambda.

## Phase 2: Infrastructure Setup (AWS Console)

### 2.1. Networking (VPC Configuration)

**Why:** Your RDS database is likely in a private VPC. By default, Lambda runs in a separate public network and cannot access it. We must attach the Lambda to the VPC.

1.  **Identify RDS Network Details:**
    *   Go to the [RDS Console](https://console.aws.amazon.com/rds).
    *   Select your database instance.
    *   Under the "Connectivity & security" tab, note the following:
        *   **VPC ID:** (e.g., `vpc-0abcdef1234567890`)
        *   **Subnets:** List of Subnet IDs.
        *   **Security Group:** (e.g., `sg-0123456789abcdef0` - let's call this `db-sg`).

2.  **Create Lambda Security Group:**
    *   Go to the [EC2 Console > Security Groups](https://console.aws.amazon.com/ec2/v2/home#SecurityGroups:).
    *   Click **Create security group**.
    *   **Name:** `wildlife-lambda-sg`
    *   **Description:** Security group for Wildlife Backend Lambda
    *   **VPC:** Select the same VPC ID as your RDS instance.
    *   **Outbound Rules:** Leave as default (Allow all traffic).
    *   Click **Create security group**.

3.  **Update RDS Security Group Rules:**
    *   Select your existing RDS security group (`db-sg`).
    *   Click **Edit inbound rules**.
    *   **Add rule:**
        *   **Type:** PostgreSQL (TCP/5432)
        *   **Source:** Custom -> Select `wildlife-lambda-sg` (the group you just created).
    *   Click **Save rules**.
    *   *This explicitly allows your Lambda function to talk to the Database.*

### 2.2. RDS Proxy (Highly Recommended)

**Why:** Lambda functions scale rapidly (e.g., 100 concurrent requests = 100 connections). This can exhaust the database connection limit. RDS Proxy pools these connections.

1.  Go to the [RDS Console > Proxies](https://console.aws.amazon.com/rds/home#proxies:).
2.  Click **Create proxy**.
3.  **Proxy identifier:** `wildlife-db-proxy`
4.  **Engine family:** PostgreSQL
5.  **Database:** Select your RDS instance.
6.  **Authentication:**
    *   **Secrets Manager:** You will likely need to store your DB credentials in AWS Secrets Manager if you haven't already. Create a new secret for the DB user/password if prompted.
    *   **IAM Role:** Create a new IAM role that gives the proxy access to the secret.
7.  **Connectivity:**
    *   **Subnets:** Select the subnets in your VPC.
    *   **VPC Security Group:** Select `wildlife-lambda-sg` (or a dedicated proxy SG that allows access from `wildlife-lambda-sg` and to `db-sg`).
8.  Click **Create proxy**.
9.  **Wait for Available status.**
10. **Copy the Proxy Endpoint:** It will look like `wildlife-db-proxy.proxy-xxxxxxxx.us-east-1.rds.amazonaws.com`.

## Phase 3: Deployment Configuration

### 3.1. Update `serverless.yml`

Before deploying, you must update the `backend/serverless.yml` file with the IDs you gathered above.

1.  Open `backend/serverless.yml`.
2.  **Uncomment the `vpc` section:**
    ```yaml
    vpc:
      securityGroupIds:
        - sg-xxxxxxxxxxxxxxxxx  # Replace with ID of wildlife-lambda-sg
      subnetIds:
        - subnet-xxxxxxxxxxxxxxxxx # Replace with your VPC Subnet IDs
        - subnet-xxxxxxxxxxxxxxxxx
    ```
3.  **Update Environment Variables:**
    *   Set `DB_HOST` to your **RDS Proxy Endpoint**.
    *   Set `DB_PASSWORD` and other secrets (prefer using SSM Parameter Store or Secrets Manager in production, but env vars work for simple setups).

### 3.2. Deploy

1.  Run the deployment command:
    ```bash
    cd backend
    serverless deploy
    ```
2.  The output will provide an **API Gateway URL** (e.g., `https://xyz123.execute-api.us-east-1.amazonaws.com/dev/`).
3.  Update your frontend configuration to point to this new API URL instead of the EC2 IP.
