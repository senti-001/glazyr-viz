#!/bin/bash
# Glazyr Viz Production Deployer (Server-Side Execution)

REMOTE_PATH="/home/senti/glazyr-mcp-core"

echo "🛠️ Finalizing local production node status..."
cd $REMOTE_PATH

# Load local environment overrides if present
if [ -f .env ]; then
    echo "[*] Loading verified credentials from .env..."
    export $(grep -v '^#' .env | xargs)
fi

# Ensure dependencies are present
npm install --production

# Fetch Redis secrets from GCP Metadata Attributes (with fallback to existing env)
METADATA_URL="http://169.254.169.254/computeMetadata/v1/instance/attributes"
REDIS_URL=${REDIS_URL:-$(curl -s -f -H "Metadata-Flavor: Google" $METADATA_URL/REDIS_URL | xargs)}
REDIS_TOKEN=${REDIS_TOKEN:-$(curl -s -f -H "Metadata-Flavor: Google" $METADATA_URL/REDIS_TOKEN | xargs)}

# Force-kill existing stale process to ensure clean environment reload
pm2 delete glazyr-mcp || true

# Launch with robust V1 environment variables (Entry point: server-http.js)
echo "[*] Launching Glazyr MCP (Cloud-Native) on Port 4545..."
REDIS_URL=$REDIS_URL REDIS_TOKEN=$REDIS_TOKEN NODE_ENV=production PORT=4545 pm2 start dist/server-http.js --name "glazyr-mcp" --exp-backoff-restart-delay 100

echo "[*] Launching CDP Relay Bridge..."
REDIS_URL=$REDIS_URL REDIS_TOKEN=$REDIS_TOKEN NODE_ENV=production CHROME_PORT=9222 pm2 start cdp-relay.js --name "cdp-relay" --exp-backoff-restart-delay 100

# Reload Nginx to pick up any config changes
sudo systemctl reload nginx || true

echo "✅ Deployment Complete. Vision Node Live at Port 4545."