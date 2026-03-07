/**
 * Featured Placement Auctions for AgentFolio
 * Agents bid for featured spots on the homepage/directory.
 * Auction types: homepage hero (1 slot), directory featured (3 slots), category spotlight (1/category)
 * Revenue model: highest bidder wins, pays second-highest price (Vickrey auction)
 */

const path = require('path');
const crypto = require('crypto');

let db;
function getDb() {
  if (!db) {
    const Database = require('better-sqlite3');
    db = Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'));
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = getDb();
  
  // Auction slots - defines available featured placements
  d.exec(`
    CREATE TABLE IF NOT EXISTS auction_slots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      placement TEXT NOT NULL,
      category TEXT,
      duration_hours INTEGER NOT NULL DEFAULT 168,
      min_bid_usd REAL NOT NULL DEFAULT 5.00,
      max_winners INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  // Auctions - time-bounded bidding rounds
  d.exec(`
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (slot_id) REFERENCES auction_slots(id)
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_auctions_ends ON auctions(ends_at)`);

  // Bids
  d.exec(`
    CREATE TABLE IF NOT EXISTS auction_bids (
      id TEXT PRIMARY KEY,
      auction_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (auction_id) REFERENCES auctions(id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_bids_auction ON auction_bids(auction_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_bids_profile ON auction_bids(profile_id)`);

  // Winners - resolved auction results
  d.exec(`
    CREATE TABLE IF NOT EXISTS auction_winners (
      id TEXT PRIMARY KEY,
      auction_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      bid_amount_usd REAL NOT NULL,
      pay_amount_usd REAL NOT NULL,
      placement_start TEXT NOT NULL,
      placement_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (auction_id) REFERENCES auctions(id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_winners_placement ON auction_winners(placement_end)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_winners_status ON auction_winners(status)`);

  // Seed default slots if empty
  const count = d.prepare('SELECT COUNT(*) as c FROM auction_slots').get().c;
  if (count === 0) {
    const now = new Date().toISOString();
    const slots = [
      { id: 'homepage-hero', name: 'Homepage Hero', desc: 'Large featured card at the top of the homepage', placement: 'homepage', duration: 168, min: 10, max: 1 },
      { id: 'directory-featured', name: 'Directory Featured', desc: 'Featured badge and top placement in agent directory', placement: 'directory', duration: 168, min: 5, max: 3 },
      { id: 'marketplace-spotlight', name: 'Marketplace Spotlight', desc: 'Featured agent in marketplace sidebar', placement: 'marketplace', duration: 168, min: 5, max: 1 },
    ];
    const ins = d.prepare('INSERT INTO auction_slots (id, name, description, placement, duration_hours, min_bid_usd, max_winners, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)');
    for (const s of slots) {
      ins.run(s.id, s.name, s.desc, s.placement, s.duration, s.min, s.max, now);
    }
  }
}

// ===== SLOTS =====

function listSlots() {
  return getDb().prepare('SELECT * FROM auction_slots WHERE active = 1').all();
}

function getSlot(slotId) {
  return getDb().prepare('SELECT * FROM auction_slots WHERE id = ?').get(slotId);
}

// ===== AUCTIONS =====

function createAuction(slotId, durationHoursOverride) {
  const d = getDb();
  const slot = d.prepare('SELECT * FROM auction_slots WHERE id = ? AND active = 1').get(slotId);
  if (!slot) throw new Error('Slot not found or inactive');

  const id = 'auc_' + crypto.randomBytes(8).toString('hex');
  const now = new Date();
  const duration = durationHoursOverride || slot.duration_hours;
  const ends = new Date(now.getTime() + duration * 3600000);

  d.prepare('INSERT INTO auctions (id, slot_id, status, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, slotId, 'open', now.toISOString(), ends.toISOString(), now.toISOString()
  );
  return getAuction(id);
}

function getAuction(auctionId) {
  const d = getDb();
  const auction = d.prepare(`
    SELECT a.*, s.name as slot_name, s.placement, s.min_bid_usd, s.max_winners
    FROM auctions a JOIN auction_slots s ON a.slot_id = s.id
    WHERE a.id = ?
  `).get(auctionId);
  if (!auction) return null;

  auction.bids = d.prepare(`
    SELECT b.*, p.name as agent_name, p.handle as agent_handle, p.avatar as agent_avatar
    FROM auction_bids b JOIN profiles p ON b.profile_id = p.id
    WHERE b.auction_id = ? AND b.status = 'active'
    ORDER BY b.amount_usd DESC
  `).all(auctionId);

  return auction;
}

function listAuctions(status = 'open') {
  const d = getDb();
  const auctions = d.prepare(`
    SELECT a.*, s.name as slot_name, s.placement, s.min_bid_usd, s.max_winners,
      (SELECT COUNT(*) FROM auction_bids WHERE auction_id = a.id AND status = 'active') as bid_count,
      (SELECT MAX(amount_usd) FROM auction_bids WHERE auction_id = a.id AND status = 'active') as top_bid
    FROM auctions a JOIN auction_slots s ON a.slot_id = s.id
    WHERE a.status = ?
    ORDER BY a.ends_at ASC
  `).all(status);
  return auctions;
}

// ===== BIDDING =====

function placeBid(auctionId, profileId, amountUsd) {
  const d = getDb();
  const auction = d.prepare(`
    SELECT a.*, s.min_bid_usd FROM auctions a JOIN auction_slots s ON a.slot_id = s.id WHERE a.id = ?
  `).get(auctionId);

  if (!auction) throw new Error('Auction not found');
  if (auction.status !== 'open') throw new Error('Auction is not open for bidding');
  if (new Date(auction.ends_at) < new Date()) throw new Error('Auction has ended');
  if (amountUsd < auction.min_bid_usd) throw new Error(`Minimum bid is $${auction.min_bid_usd}`);

  // Check profile exists
  const profile = d.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('Profile not found');

  // Cancel any existing bid from this profile on this auction (replace bid)
  d.prepare("UPDATE auction_bids SET status = 'replaced' WHERE auction_id = ? AND profile_id = ? AND status = 'active'").run(auctionId, profileId);

  const id = 'bid_' + crypto.randomBytes(8).toString('hex');
  d.prepare('INSERT INTO auction_bids (id, auction_id, profile_id, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, auctionId, profileId, amountUsd, 'active', new Date().toISOString()
  );

  return { id, auction_id: auctionId, profile_id: profileId, amount_usd: amountUsd, status: 'active' };
}

// ===== RESOLUTION =====

function resolveAuction(auctionId) {
  const d = getDb();
  const auction = getAuction(auctionId);
  if (!auction) throw new Error('Auction not found');
  if (auction.status !== 'open') throw new Error('Auction already resolved');

  const bids = auction.bids; // sorted desc by amount
  const maxWinners = auction.max_winners;
  const winners = [];

  const now = new Date();
  const slot = d.prepare('SELECT * FROM auction_slots WHERE id = ?').get(auction.slot_id);
  const placementEnd = new Date(now.getTime() + slot.duration_hours * 3600000);

  for (let i = 0; i < Math.min(bids.length, maxWinners); i++) {
    const bid = bids[i];
    // Vickrey: pay the next-highest bid (or min bid if only winner)
    const payAmount = bids[i + 1] ? bids[i + 1].amount_usd : auction.min_bid_usd;

    const winnerId = 'win_' + crypto.randomBytes(8).toString('hex');
    d.prepare(`INSERT INTO auction_winners (id, auction_id, profile_id, bid_amount_usd, pay_amount_usd, placement_start, placement_end, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
      winnerId, auctionId, bid.profile_id, bid.amount_usd, payAmount,
      now.toISOString(), placementEnd.toISOString(), now.toISOString()
    );

    winners.push({ id: winnerId, profile_id: bid.profile_id, agent_name: bid.agent_name, bid: bid.amount_usd, pays: payAmount });
  }

  // Mark losing bids
  const winnerIds = winners.map(w => w.profile_id);
  for (const bid of bids) {
    if (!winnerIds.includes(bid.profile_id)) {
      d.prepare("UPDATE auction_bids SET status = 'lost' WHERE id = ?").run(bid.id);
    } else {
      d.prepare("UPDATE auction_bids SET status = 'won' WHERE id = ?").run(bid.id);
    }
  }

  d.prepare("UPDATE auctions SET status = 'resolved', resolved_at = ? WHERE id = ?").run(now.toISOString(), auctionId);

  return { auction_id: auctionId, winners };
}

// Auto-resolve expired auctions
function resolveExpiredAuctions() {
  const d = getDb();
  const expired = d.prepare("SELECT id FROM auctions WHERE status = 'open' AND ends_at < ?").all(new Date().toISOString());
  const results = [];
  for (const a of expired) {
    try {
      results.push(resolveAuction(a.id));
    } catch (e) { /* skip */ }
  }
  return results;
}

// ===== ACTIVE PLACEMENTS =====

function getActivePlacements(placement) {
  const d = getDb();
  const now = new Date().toISOString();
  return d.prepare(`
    SELECT w.*, p.name as agent_name, p.handle as agent_handle, p.avatar as agent_avatar, p.bio as agent_bio,
      s.name as slot_name, s.placement
    FROM auction_winners w
    JOIN profiles p ON w.profile_id = p.id
    JOIN auctions a ON w.auction_id = a.id
    JOIN auction_slots s ON a.slot_id = s.id
    WHERE w.status = 'active' AND w.placement_start <= ? AND w.placement_end > ?
    ${placement ? 'AND s.placement = ?' : ''}
    ORDER BY w.pay_amount_usd DESC
  `).all(...(placement ? [now, now, placement] : [now, now]));
}

// ===== AGENT'S AUCTION HISTORY =====

function getAgentBids(profileId) {
  const d = getDb();
  return d.prepare(`
    SELECT b.*, a.status as auction_status, a.ends_at, s.name as slot_name
    FROM auction_bids b
    JOIN auctions a ON b.auction_id = a.id
    JOIN auction_slots s ON a.slot_id = s.id
    WHERE b.profile_id = ? AND b.status != 'replaced'
    ORDER BY b.created_at DESC
  `).all(profileId);
}

function getAgentWins(profileId) {
  const d = getDb();
  return d.prepare(`
    SELECT w.*, s.name as slot_name, s.placement
    FROM auction_winners w
    JOIN auctions a ON w.auction_id = a.id
    JOIN auction_slots s ON a.slot_id = s.id
    WHERE w.profile_id = ?
    ORDER BY w.created_at DESC
  `).all(profileId);
}

// ===== API ROUTES =====

function registerRoutes(app) {
  // List available slots
  app.get('/api/auctions/slots', (req, res) => {
    try {
      res.json({ slots: listSlots() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // List auctions (open, resolved, all)
  app.get('/api/auctions', (req, res) => {
    try {
      // Auto-resolve expired first
      resolveExpiredAuctions();
      const status = req.query.status || 'open';
      res.json({ auctions: listAuctions(status) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get single auction with bids
  app.get('/api/auctions/:id', (req, res) => {
    try {
      resolveExpiredAuctions();
      const auction = getAuction(req.params.id);
      if (!auction) return res.status(404).json({ error: 'Auction not found' });
      res.json(auction);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create auction for a slot (admin)
  app.post('/api/auctions', (req, res) => {
    try {
      const { slot_id, duration_hours, api_key } = req.body;
      if (!slot_id) return res.status(400).json({ error: 'slot_id required' });
      const auction = createAuction(slot_id, duration_hours);
      res.status(201).json(auction);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Place bid
  app.post('/api/auctions/:id/bids', (req, res) => {
    try {
      const { profile_id, amount_usd } = req.body;
      if (!profile_id || !amount_usd) return res.status(400).json({ error: 'profile_id and amount_usd required' });
      const bid = placeBid(req.params.id, profile_id, parseFloat(amount_usd));
      res.status(201).json(bid);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Get active placements (for rendering featured agents)
  app.get('/api/featured', (req, res) => {
    try {
      resolveExpiredAuctions();
      const placement = req.query.placement; // homepage, directory, marketplace
      res.json({ featured: getActivePlacements(placement) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Agent's bid history
  app.get('/api/auctions/agent/:profileId/bids', (req, res) => {
    try {
      res.json({ bids: getAgentBids(req.params.profileId) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Agent's wins
  app.get('/api/auctions/agent/:profileId/wins', (req, res) => {
    try {
      res.json({ wins: getAgentWins(req.params.profileId) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manually resolve an auction (admin)
  app.post('/api/auctions/:id/resolve', (req, res) => {
    try {
      const result = resolveAuction(req.params.id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}

module.exports = {
  registerRoutes,
  listSlots,
  getSlot,
  createAuction,
  getAuction,
  listAuctions,
  placeBid,
  resolveAuction,
  resolveExpiredAuctions,
  getActivePlacements,
  getAgentBids,
  getAgentWins,
};
