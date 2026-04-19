#!/bin/bash
# Daily AgentFolio DB backup — keep last 7 days
BACKUP_DIR="/home/ubuntu/agentfolio/data/backups"
DB_PATH="/home/ubuntu/agentfolio/data/agentfolio.db"
DATE=$(date +%Y%m%d)

# Use sqlite3 .backup for safe copy (handles WAL mode)
sqlite3 "$DB_PATH" ".backup $BACKUP_DIR/agentfolio.db.$DATE"

# Delete backups older than 7 days
find "$BACKUP_DIR" -name "agentfolio.db.*" -mtime +7 -delete

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: agentfolio.db.$DATE"
