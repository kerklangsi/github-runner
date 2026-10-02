#!/usr/bin/env bash
set -e

mkdir -p /opt/github-runner /app/data /home/runner/.cache /opt/shared_data

# Ensure legacy path symlink exists for full backwards compatibility
if [ ! -e /opt/github-runners ]; then
  sudo ln -sfn /opt/github-runner /opt/github-runners || true
fi

# Unify hostedtoolcache into single cache volume so docker-compose requires only 1 volume mount
if [ ! -L /opt/hostedtoolcache ]; then
  sudo rm -rf /opt/hostedtoolcache
  sudo ln -sfn /home/runner/.cache /opt/hostedtoolcache
  sudo chown -h runner:runner /opt/hostedtoolcache || true
fi

sudo chown -R runner:runner /home/runner/.cache /opt/github-runner /opt/github-runners /app/data /opt/shared_data || true
sudo chmod -R 777 /opt/shared_data /opt/github-runner /opt/github-runners || true

DATA_FILE="/app/data/runners.json"
if [ ! -f "$DATA_FILE" ]; then
  echo '[]' > "$DATA_FILE"
fi

# Handles graceful container shutdown by terminating node backend process.
shutdown() {
  echo "Stopping GitHub Runner Manager Node Server..."
  if [ -n "$NODE_PID" ]; then
    kill "$NODE_PID" || true
  fi
  exit 0
}

trap 'shutdown' SIGTERM SIGINT

echo "Starting GitHub Runner Manager Web Dashboard & Backend on port 3000..."
node /app/backend/src/server.js &
NODE_PID=$!

wait "$NODE_PID"




