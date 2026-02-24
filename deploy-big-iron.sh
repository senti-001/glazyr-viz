#!/bin/bash
# Glazyr Viz Production Deployer
# Usage: ./deploy-big-iron.sh [GCP_IP]

GCP_IP=${1:-"136.113.105.70"}
REMOTE_PATH="/home/senti/glazyr-mcp-core"

echo "🚀 Building local package..."
npm run build

echo "📦 Syncing to Big Iron..."
# We exclude node_modules and the local log files
rsync -avz --exclude 'node_modules' --exclude '*.log' ./dist ./package.json ./package-lock.json senti@$GCP_IP:$REMOTE_PATH

echo "🛠️ Finalizing production node..."
ssh senti@$GCP_IP << EOF
    cd $REMOTE_PATH
    npm install --production
    
    # Reload with PM2 for zero-downtime
    pm2 delete glazyr-mcp || true
    NODE_ENV=production PORT=4545 pm2 start dist/index.js --name "glazyr-mcp" --exp-backoff-restart-delay 100
    
    # Reload Nginx to pick up any config changes
    sudo systemctl reload nginx
EOF

echo "✅ Deployment Complete. Vision Node Live at https://mcp.glazyr.io/mcp/sse"
