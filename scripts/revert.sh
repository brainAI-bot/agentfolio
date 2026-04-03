#!/bin/bash
SNAP_DIR=$(cat /home/ubuntu/agentfolio/snapshots/LATEST 2>/dev/null)
if [ -z "$SNAP_DIR" ] || [ ! -d "$SNAP_DIR" ]; then
  echo "No snapshot found"
  exit 1
fi
echo "Reverting to: $SNAP_DIR"
cp $SNAP_DIR/server.js /home/ubuntu/agentfolio/src/
cp $SNAP_DIR/profile-store.js /home/ubuntu/agentfolio/src/
cp -r $SNAP_DIR/routes/ /home/ubuntu/agentfolio/src/
cp -r $SNAP_DIR/lib/ /home/ubuntu/agentfolio/src/
cp $SNAP_DIR/WalletProvider.tsx /home/ubuntu/agentfolio/frontend/src/components/ 2>/dev/null
cp $SNAP_DIR/v3-scores.ts /home/ubuntu/agentfolio/frontend/src/lib/ 2>/dev/null
cp $SNAP_DIR/data.ts /home/ubuntu/agentfolio/frontend/src/lib/ 2>/dev/null
cp $SNAP_DIR/page.tsx /home/ubuntu/agentfolio/frontend/src/app/verify/ 2>/dev/null
echo "Reverted. Run: pm2 restart agentfolio && cd /home/ubuntu/agentfolio/frontend && npm run build && pm2 restart agentfolio-frontend"
