/**
 * WebSocket Server for Real-time Activity Updates
 */

const { Server: WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();
const subscriptions = new Map(); // clientId -> Set of profileIds

/**
 * Initialize WebSocket server
 */
function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).substring(7);
    ws.clientId = clientId;
    clients.add(ws);
    subscriptions.set(clientId, new Set());
    
    console.log(`[WS] Client connected: ${clientId}`);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      message: 'Connected to AgentFolio real-time feed'
    }));
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });
    
    ws.on('close', () => {
      console.log(`[WS] Client disconnected: ${clientId}`);
      clients.delete(ws);
      subscriptions.delete(clientId);
    });
    
    ws.on('error', (err) => {
      console.error(`[WS] Client error ${clientId}:`, err.message);
    });
  });
  
  console.log('[WS] WebSocket server initialized on /ws');
  return wss;
}

/**
 * Handle incoming client messages
 */
function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe':
      // Subscribe to specific profile(s)
      if (msg.profileId) {
        const subs = subscriptions.get(ws.clientId);
        if (Array.isArray(msg.profileId)) {
          msg.profileId.forEach(id => subs.add(id));
        } else {
          subs.add(msg.profileId);
        }
        ws.send(JSON.stringify({ 
          type: 'subscribed', 
          profileIds: Array.from(subs) 
        }));
      }
      break;
      
    case 'unsubscribe':
      if (msg.profileId) {
        const subs = subscriptions.get(ws.clientId);
        if (Array.isArray(msg.profileId)) {
          msg.profileId.forEach(id => subs.delete(id));
        } else {
          subs.delete(msg.profileId);
        }
        ws.send(JSON.stringify({ 
          type: 'unsubscribed', 
          profileIds: Array.from(subs) 
        }));
      }
      break;
      
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
      
    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
}

/**
 * Broadcast activity to all connected clients
 */
function broadcastActivity(activity) {
  if (!wss) return;
  
  const payload = JSON.stringify({
    type: 'activity',
    activity: {
      ...activity,
      timestamp: activity.timestamp || Date.now()
    }
  });
  
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      const subs = subscriptions.get(client.clientId);
      // Send if no subscriptions (global feed) or subscribed to this profile
      if (subs.size === 0 || subs.has(activity.profileId)) {
        client.send(payload);
        sent++;
      }
    }
  }
  
  return sent;
}

/**
 * Broadcast to specific profile subscribers only
 */
function broadcastToProfile(profileId, data) {
  if (!wss) return;
  
  const payload = JSON.stringify({
    type: 'update',
    profileId,
    data
  });
  
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === 1) {
      const subs = subscriptions.get(client.clientId);
      if (subs.has(profileId)) {
        client.send(payload);
        sent++;
      }
    }
  }
  
  return sent;
}

/**
 * Broadcast system message to all clients
 */
function broadcastSystem(message) {
  if (!wss) return;
  
  const payload = JSON.stringify({
    type: 'system',
    message,
    timestamp: Date.now()
  });
  
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

/**
 * Get connection stats
 */
function getStats() {
  return {
    connected: clients.size,
    subscriptions: Array.from(subscriptions.entries()).map(([clientId, subs]) => ({
      clientId,
      profileCount: subs.size
    }))
  };
}

module.exports = {
  initWebSocket,
  broadcastActivity,
  broadcastToProfile,
  broadcastSystem,
  getStats
};
