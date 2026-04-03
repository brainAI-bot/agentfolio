#!/bin/bash
SNAP_DIR=/home/ubuntu/agentfolio/snapshots/$(date +%Y%m%d-%H%M%S)
mkdir -p $SNAP_DIR
cp /home/ubuntu/agentfolio/src/server.js $SNAP_DIR/
cp /home/ubuntu/agentfolio/src/profile-store.js $SNAP_DIR/
cp -r /home/ubuntu/agentfolio/src/routes/ $SNAP_DIR/routes/
cp -r /home/ubuntu/agentfolio/src/lib/ $SNAP_DIR/lib/
cp /home/ubuntu/agentfolio/frontend/src/components/WalletProvider.tsx $SNAP_DIR/ 2>/dev/null
cp /home/ubuntu/agentfolio/frontend/src/lib/v3-scores.ts $SNAP_DIR/ 2>/dev/null
cp /home/ubuntu/agentfolio/frontend/src/lib/data.ts $SNAP_DIR/ 2>/dev/null
cp /home/ubuntu/agentfolio/frontend/src/app/verify/page.tsx $SNAP_DIR/ 2>/dev/null
echo $SNAP_DIR > /home/ubuntu/agentfolio/snapshots/LATEST
echo "Snapshot saved: $SNAP_DIR"
