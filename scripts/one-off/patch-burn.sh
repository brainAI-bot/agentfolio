#!/bin/bash
cd ~/agentfolio/src/routes

# Find the line where it sets profile.nftAvatar and add DB write after saveProfile
python3 << 'PYEOF'
import re

with open("burn-to-become-public.js", "r") as f:
    content = f.read()

# Find the saveProfile call in the submit handler and add direct DB update after it
old_block = """              saveProfile(profile);
              console.log('[BurnPublic] Profile updated:', genesisInfo.profileId);"""

new_block = """              saveProfile(profile);
              
              // Direct DB update for nft_avatar column (saveProfile doesn't handle this)
              try {
                const Database = require('better-sqlite3');
                const dbPath = require('path').join(__dirname, '../../data/agentfolio.db');
                const directDb = new Database(dbPath);
                directDb.prepare('UPDATE profiles SET nft_avatar = ?, avatar = ?, updated_at = ? WHERE id = ?').run(
                  JSON.stringify(profile.nftAvatar),
                  profile.nftAvatar.image || profile.nftAvatar.arweaveUrl,
                  new Date().toISOString(),
                  genesisInfo.profileId
                );
                directDb.close();
                console.log('[BurnPublic] nft_avatar saved to DB for', genesisInfo.profileId);
              } catch (dbErr) {
                console.error('[BurnPublic] DB nft_avatar update failed:', dbErr.message);
              }
              
              console.log('[BurnPublic] Profile updated:', genesisInfo.profileId);"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open("burn-to-become-public.js", "w") as f:
        f.write(content)
    print("Patched submit handler ✅")
else:
    print("WARNING: Could not find exact match for patch")
    print("Looking for saveProfile call...")
    if "saveProfile(profile)" in content:
        print("saveProfile found but surrounding context differs")
    else:
        print("saveProfile NOT found in file")
PYEOF
