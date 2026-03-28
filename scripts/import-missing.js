const db = require('better-sqlite3')('/home/ubuntu/agentfolio/data/agentfolio.db');
const fs = require('fs');

const hackathon = JSON.parse(fs.readFileSync('/home/ubuntu/agentfolio/data/hackathon-agents.json', 'utf8')).agents;
const supp = JSON.parse(fs.readFileSync('/home/ubuntu/agentfolio/data/supplementary-agents.json', 'utf8'));
const suppAgents = Array.isArray(supp) ? supp : supp.agents || [];

const existing = new Set(db.prepare('SELECT id FROM profiles').all().map(r => r.id));
const now = new Date().toISOString();

const sql = 'INSERT OR IGNORE INTO profiles (id, name, handle, bio, avatar, links, wallets, skills, portfolio, track_record, verification, verification_data, endorsements, endorsements_given, created_at, updated_at, status, hidden, capabilities, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const insert = db.prepare(sql);

let imported = 0;
const tx = db.transaction(() => {
  for (const a of [...hackathon, ...suppAgents]) {
    const rawName = a.name || '';
    const id = 'agent_' + rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (existing.has(id) || !id || id === 'agent_') continue;
    
    const handle = '@' + rawName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const bio = a.description || a.bio || '';
    const links = JSON.stringify({ website: a.website || a.url || '', github: a.github || '', x: a.twitter || a.x || '' });
    const skills = JSON.stringify(a.tags || a.skills || [a.category].filter(Boolean));
    const tags = JSON.stringify(a.tags || [a.category].filter(Boolean));
    
    insert.run(id, rawName, handle, bio, null, links, '{}', skills, '[]', null, '{}', '{}', '[]', '[]', now, now, 'active', 0, '[]', tags);
    imported++;
  }
});
tx();
console.log('Imported:', imported);
console.log('Total profiles now:', db.prepare('SELECT COUNT(*) as c FROM profiles').get().c);
db.close();
