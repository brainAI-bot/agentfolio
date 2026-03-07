/**
 * AgentFolio Live Feed - WebSocket Client
 */

class AgentFolioLiveFeed {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || `ws://${window.location.host}/ws`;
    this.onActivity = options.onActivity || this.defaultOnActivity.bind(this);
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.ws = null;
    this.clientId = null;
    this.subscriptions = new Set();
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
        
        this.ws.onopen = () => {
          console.log('[LiveFeed] Connected');
          this.onConnect();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (e) {
            console.error('[LiveFeed] Parse error:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[LiveFeed] Disconnected');
          this.onDisconnect();
          if (this.autoReconnect) {
            setTimeout(() => this.connect(), this.reconnectInterval);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[LiveFeed] Error:', error);
          reject(error);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  disconnect() {
    this.autoReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.clientId = msg.clientId;
        console.log('[LiveFeed] Client ID:', this.clientId);
        // Resubscribe if reconnecting
        if (this.subscriptions.size > 0) {
          this.subscribe(Array.from(this.subscriptions));
        }
        break;
        
      case 'activity':
        this.onActivity(msg.activity);
        break;
        
      case 'update':
        // Profile-specific update
        if (this.onProfileUpdate) {
          this.onProfileUpdate(msg.profileId, msg.data);
        }
        break;
        
      case 'system':
        console.log('[LiveFeed] System:', msg.message);
        if (this.onSystem) {
          this.onSystem(msg);
        }
        break;
        
      case 'subscribed':
      case 'unsubscribed':
        console.log('[LiveFeed]', msg.type, msg.profileIds);
        break;
        
      case 'pong':
        // Heartbeat response
        break;
        
      case 'error':
        console.error('[LiveFeed] Server error:', msg.message);
        break;
    }
  }

  subscribe(profileIds) {
    if (!Array.isArray(profileIds)) {
      profileIds = [profileIds];
    }
    profileIds.forEach(id => this.subscriptions.add(id));
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        profileId: profileIds
      }));
    }
  }

  unsubscribe(profileIds) {
    if (!Array.isArray(profileIds)) {
      profileIds = [profileIds];
    }
    profileIds.forEach(id => this.subscriptions.delete(id));
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        profileId: profileIds
      }));
    }
  }

  ping() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }

  defaultOnActivity(activity) {
    console.log('[LiveFeed] Activity:', activity);
    
    // Try to add to feed container if it exists
    const container = document.getElementById('live-feed') || document.getElementById('activity-feed');
    if (container) {
      const item = this.createActivityElement(activity);
      container.insertBefore(item, container.firstChild);
      
      // Limit visible items
      while (container.children.length > 50) {
        container.removeChild(container.lastChild);
      }
    }
  }

  createActivityElement(activity) {
    const div = document.createElement('div');
    div.className = 'activity-item live-item';
    div.style.animation = 'fadeIn 0.3s ease-in';
    
    const typeEmoji = {
      'profile_created': '🆕',
      'verification_twitter': '✅',
      'verification_hyperliquid': '📊',
      'verification_solana': '⛓️',
      'endorsement': '👍',
      'skill_added': '🛠️',
      'skill_verified': '✓',
      'profile_updated': '📝'
    };
    
    const emoji = typeEmoji[activity.type] || '📌';
    const time = new Date(activity.timestamp).toLocaleTimeString();
    
    div.innerHTML = `
      <span class="activity-emoji">${emoji}</span>
      <span class="activity-text">
        <strong>${activity.profileId}</strong>: ${activity.type.replace(/_/g, ' ')}
      </span>
      <span class="activity-time">${time}</span>
    `;
    
    return div;
  }
}

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const feedContainer = document.getElementById('live-feed');
  if (feedContainer) {
    window.liveFeed = new AgentFolioLiveFeed();
    window.liveFeed.connect().catch(console.error);
  }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AgentFolioLiveFeed;
}
