#!/bin/bash

# This script deploys the frontend files to the Apache web directory
# and then restarts the Apache server.

# Ensure you run this script with sudo
set -e

echo "Deploying frontend files to /var/www/html/..."
sudo cp -r /home/ec2-user/Wildlife-Spotter/frontend/public/* /var/www/html/

echo "Restarting Apache (httpd)..."
sudo systemctl restart httpd

echo "Deployment complete!"