#!/usr/bin/env bash

# ==============================================================================
# BookBinder Auto-Update Watchdog Script
# Checks remote git repository for updates every 60 seconds.
# Rebuilds Docker Compose containers only when a new commit is detected.
# ==============================================================================

PROJECT_DIR="/home/BookBinder"
BRANCH="main"
CHECK_INTERVAL=60
LOCK_FILE="/tmp/bookbinder_watchdog.lock"

# Ensure script runs inside the repository directory
if [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR" || exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting BookBinder deployment watchdog (branch: $BRANCH, interval: ${CHECK_INTERVAL}s)..."

while true; do
  (
    # Acquire non-blocking file lock to prevent concurrent build loops
    flock -n 200 || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] Build currently in progress. Skipping cycle."; exit 0; }

    # Quietly fetch updates from remote
    git fetch origin "$BRANCH" > /dev/null 2>&1

    LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null)
    REMOTE_HASH=$(git rev-parse "origin/$BRANCH" 2>/dev/null)

    # Check if remote hash differs from local HEAD
    if [ -n "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [UPDATE DETECTED] Local: $LOCAL_HASH -> Remote: $REMOTE_HASH"

      # Pull remote changes
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pulling latest code..."
      git pull origin "$BRANCH"

      # Restart & Rebuild Docker containers
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restarting Docker Compose services..."
      docker compose down
      docker compose up --build -d

      # Clean up dangling build images to preserve disk space
      docker image prune -f

      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS] Deployment updated to commit $REMOTE_HASH"
    fi
  ) 200>"$LOCK_FILE"

  sleep "$CHECK_INTERVAL"
done
