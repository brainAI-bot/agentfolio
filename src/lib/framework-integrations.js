/**
 * Framework Integrations for AgentFolio
 * 
 * Provides plug-and-play integration modules for popular AI agent frameworks:
 * - LangChain/LangGraph
 * - CrewAI
 * - AutoGPT
 * - ElizaOS
 * 
 * Each integration provides:
 * - Auto-registration of agents
 * - Profile sync (skills, activity, metrics)
 * - Task completion reporting
 * - Verification helpers
 */

const crypto = require('crypto');

// ─── Base Integration Class ───

class AgentFolioClient {
  constructor({ baseUrl = 'https://agentfolio.bot', apiKey, profileId } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.profileId = profileId;
  }

  async _request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AgentFolio API ${method} ${path}: ${res.status} ${text}`);
    }
    return res.json();
  }

  async register(profile) {
    const result = await this._request('POST', '/api/profile', profile);
    this.profileId = result.profile?.id || result.id;
    return result;
  }

  async updateProfile(updates) {
    if (!this.profileId) throw new Error('No profileId set. Register first.');
    return this._request('PATCH', `/api/profile/${this.profileId}`, updates);
  }

  async addVerification(type, data) {
    if (!this.profileId) throw new Error('No profileId set.');
    return this._request('POST', `/api/profile/${this.profileId}/verify/${type}`, data);
  }

  async reportTaskCompletion(task) {
    if (!this.profileId) throw new Error('No profileId set.');
    return this._request('POST', `/api/profile/${this.profileId}/activity`, {
      type: 'task_completion',
      ...task
    });
  }

  async getProfile(id) {
    return this._request('GET', `/api/profile/${id || this.profileId}`);
  }

  async searchAgents(query) {
    return this._request('GET', `/api/search?q=${encodeURIComponent(query)}`);
  }
}

// ─── LangChain Integration ───

/**
 * LangChain/LangGraph Tool that auto-reports agent activity to AgentFolio.
 * 
 * Usage:
 *   const { AgentFolioTool } = require('agentfolio/integrations/langchain');
 *   const tool = new AgentFolioTool({ apiKey: 'agf_xxx', profileId: 'my-agent' });
 *   // Add to your agent's tools array
 *   const agent = createAgent({ tools: [...otherTools, tool] });
 */
class LangChainIntegration {
  constructor(clientOpts) {
    this.client = new AgentFolioClient(clientOpts);
  }

  /**
   * Returns a LangChain-compatible tool definition for profile updates.
   */
  asTool() {
    const client = this.client;
    return {
      name: 'agentfolio_update',
      description: 'Update your AgentFolio profile with completed tasks, new skills, or metrics.',
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['report_task', 'update_skills', 'update_bio'] },
          task_name: { type: 'string' },
          task_result: { type: 'string', enum: ['success', 'failure'] },
          skills: { type: 'array', items: { type: 'string' } },
          bio: { type: 'string' }
        },
        required: ['action']
      },
      func: async (input) => {
        try {
          if (input.action === 'report_task') {
            await client.reportTaskCompletion({
              name: input.task_name,
              result: input.task_result,
              timestamp: new Date().toISOString()
            });
            return `Task "${input.task_name}" reported to AgentFolio.`;
          }
          if (input.action === 'update_skills') {
            await client.updateProfile({ skills: input.skills });
            return `Skills updated on AgentFolio: ${input.skills.join(', ')}`;
          }
          if (input.action === 'update_bio') {
            await client.updateProfile({ description: input.bio });
            return `Bio updated on AgentFolio.`;
          }
          return 'Unknown action.';
        } catch (e) {
          return `AgentFolio error: ${e.message}`;
        }
      }
    };
  }

  /**
   * LangChain callback handler that auto-reports chain completions.
   */
  asCallbackHandler() {
    const client = this.client;
    return {
      handleChainEnd: async (outputs, runId) => {
        try {
          await client.reportTaskCompletion({
            name: `chain_${runId}`,
            result: 'success',
            outputs: typeof outputs === 'string' ? outputs : JSON.stringify(outputs).slice(0, 500),
            timestamp: new Date().toISOString()
          });
        } catch (_) { /* non-blocking */ }
      },
      handleChainError: async (error, runId) => {
        try {
          await client.reportTaskCompletion({
            name: `chain_${runId}`,
            result: 'failure',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } catch (_) { /* non-blocking */ }
      }
    };
  }
}

// ─── CrewAI Integration ───

/**
 * CrewAI integration - wraps agents with AgentFolio reporting.
 * 
 * Usage (Python-style, but this is the JS reference implementation):
 *   const crew = new CrewAIIntegration({ apiKey: 'agf_xxx' });
 *   crew.registerAgent({ name: 'Researcher', role: 'research', skills: ['web_search'] });
 *   crew.onTaskComplete(agentName, task, result);
 */
class CrewAIIntegration {
  constructor(clientOpts) {
    this.clientOpts = clientOpts;
    this.agents = new Map(); // name -> AgentFolioClient
  }

  async registerAgent({ name, role, skills = [], description = '' }) {
    const client = new AgentFolioClient(this.clientOpts);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    try {
      // Try to register
      await client.register({
        id: `crewai-${slug}`,
        name,
        type: 'crewai_agent',
        description: description || `CrewAI ${role} agent`,
        skills,
        metadata: { framework: 'crewai', role }
      });
    } catch (e) {
      // Already exists - just set the ID
      client.profileId = `crewai-${slug}`;
    }
    
    this.agents.set(name, client);
    return client;
  }

  async onTaskComplete(agentName, task, result) {
    const client = this.agents.get(agentName);
    if (!client) return;
    
    await client.reportTaskCompletion({
      name: task.description || task.name || 'unnamed_task',
      result: result.success !== false ? 'success' : 'failure',
      output: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 500),
      timestamp: new Date().toISOString()
    });
  }

  async syncAllProfiles(metrics = {}) {
    for (const [name, client] of this.agents) {
      if (metrics[name]) {
        await client.updateProfile({ metrics: metrics[name] });
      }
    }
  }
}

// ─── AutoGPT Integration ───

/**
 * AutoGPT plugin-style integration.
 * 
 * Usage:
 *   const plugin = new AutoGPTIntegration({ apiKey: 'agf_xxx', profileId: 'my-autogpt' });
 *   // In your AutoGPT command loop:
 *   plugin.reportCommand(commandName, args, result);
 */
class AutoGPTIntegration {
  constructor(clientOpts) {
    this.client = new AgentFolioClient(clientOpts);
    this.commandLog = [];
    this.syncInterval = null;
  }

  async init(agentConfig) {
    try {
      await this.client.register({
        id: agentConfig.id || `autogpt-${Date.now()}`,
        name: agentConfig.name || 'AutoGPT Agent',
        type: 'autogpt_agent',
        description: agentConfig.role || 'Autonomous GPT agent',
        skills: agentConfig.goals?.map(g => g.slice(0, 50)) || [],
        metadata: { framework: 'autogpt', goals: agentConfig.goals }
      });
    } catch (_) {
      // Already registered
    }
  }

  reportCommand(command, args, result) {
    this.commandLog.push({
      command,
      args: JSON.stringify(args).slice(0, 200),
      result: typeof result === 'string' ? result.slice(0, 200) : 'ok',
      timestamp: new Date().toISOString()
    });
  }

  async flush() {
    if (this.commandLog.length === 0) return;
    
    const batch = this.commandLog.splice(0, 50);
    await this.client.reportTaskCompletion({
      name: 'command_batch',
      commands: batch,
      count: batch.length,
      timestamp: new Date().toISOString()
    });
  }

  startAutoSync(intervalMs = 60000) {
    this.syncInterval = setInterval(() => this.flush().catch(() => {}), intervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) clearInterval(this.syncInterval);
  }
}

// ─── ElizaOS Integration ───

/**
 * ElizaOS integration for AI agents built with the ElizaOS framework.
 * 
 * Usage:
 *   const eliza = new ElizaOSIntegration({ apiKey: 'agf_xxx' });
 *   await eliza.registerCharacter(characterConfig);
 *   eliza.onMessage(message, response);
 */
class ElizaOSIntegration {
  constructor(clientOpts) {
    this.client = new AgentFolioClient(clientOpts);
    this.messageCount = 0;
    this.lastSync = Date.now();
  }

  async registerCharacter(character) {
    const slug = (character.name || 'eliza').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    try {
      await this.client.register({
        id: `eliza-${slug}`,
        name: character.name,
        type: 'elizaos_agent',
        description: character.bio || character.description || `ElizaOS agent: ${character.name}`,
        skills: character.topics || [],
        metadata: {
          framework: 'elizaos',
          personality: character.adjectives?.join(', '),
          style: character.style
        }
      });
    } catch (_) {
      this.client.profileId = `eliza-${slug}`;
    }
  }

  onMessage(message, response) {
    this.messageCount++;
    // Batch sync every 100 messages or 5 minutes
    if (this.messageCount % 100 === 0 || Date.now() - this.lastSync > 300000) {
      this.sync().catch(() => {});
    }
  }

  async sync() {
    await this.client.updateProfile({
      metrics: {
        total_messages: this.messageCount,
        last_active: new Date().toISOString()
      }
    });
    this.lastSync = Date.now();
  }
}

// ─── API Route Handler ───

/**
 * Express route handler for /api/integrations
 * Provides setup guides, code snippets, and integration status.
 */
function setupIntegrationRoutes(app, db) {
  
  // GET /api/integrations - list available integrations
  app.get('/api/integrations', (req, res) => {
    res.json({
      integrations: [
        {
          id: 'langchain',
          name: 'LangChain / LangGraph',
          description: 'Add AgentFolio as a tool or callback handler in your LangChain agent.',
          status: 'stable',
          languages: ['javascript', 'python'],
          docs: '/api/integrations/langchain'
        },
        {
          id: 'crewai',
          name: 'CrewAI',
          description: 'Auto-register crew members and report task completions.',
          status: 'stable',
          languages: ['javascript', 'python'],
          docs: '/api/integrations/crewai'
        },
        {
          id: 'autogpt',
          name: 'AutoGPT',
          description: 'Plugin for autonomous agents to track commands and progress.',
          status: 'stable',
          languages: ['javascript', 'python'],
          docs: '/api/integrations/autogpt'
        },
        {
          id: 'elizaos',
          name: 'ElizaOS',
          description: 'Register ElizaOS characters and sync activity metrics.',
          status: 'stable',
          languages: ['javascript'],
          docs: '/api/integrations/elizaos'
        },
        {
          id: 'generic',
          name: 'Generic REST API',
          description: 'Use the REST API directly from any framework or language.',
          status: 'stable',
          languages: ['any'],
          docs: '/api/docs'
        }
      ]
    });
  });

  // GET /api/integrations/:framework - detailed setup guide
  app.get('/api/integrations/:framework', (req, res) => {
    const guides = getIntegrationGuides();
    const guide = guides[req.params.framework];
    if (!guide) {
      return res.status(404).json({ error: 'Unknown framework. GET /api/integrations for available options.' });
    }
    res.json(guide);
  });

  // POST /api/integrations/setup - auto-setup an integration
  app.post('/api/integrations/setup', async (req, res) => {
    const { framework, profileId, config = {} } = req.body;
    
    if (!framework || !profileId) {
      return res.status(400).json({ error: 'framework and profileId required' });
    }

    try {
      // Generate a framework-specific API key
      const apiKey = `agf_${framework}_${crypto.randomBytes(16).toString('hex')}`;
      
      // Store integration config
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO integrations (profile_id, framework, api_key, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      stmt.run(profileId, framework, apiKey, JSON.stringify(config));

      res.json({
        success: true,
        framework,
        profileId,
        apiKey,
        setupCode: generateSetupCode(framework, apiKey, profileId)
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/integrations/status/:profileId - check integration health
  app.get('/api/integrations/status/:profileId', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT framework, config, created_at, updated_at,
               (SELECT COUNT(*) FROM activity WHERE profile_id = integrations.profile_id 
                AND created_at > datetime('now', '-24 hours')) as events_24h
        FROM integrations WHERE profile_id = ?
      `).all(req.params.profileId);

      res.json({
        profileId: req.params.profileId,
        integrations: rows.map(r => ({
          framework: r.framework,
          active: r.events_24h > 0,
          events_24h: r.events_24h,
          connected_at: r.created_at,
          last_updated: r.updated_at
        }))
      });
    } catch (e) {
      res.json({ profileId: req.params.profileId, integrations: [] });
    }
  });
}

// ─── Setup Code Generator ───

function generateSetupCode(framework, apiKey, profileId) {
  const snippets = {
    langchain: {
      javascript: `
const { AgentFolioTool } = require('agentfolio');

// Option 1: As a LangChain tool
const tool = new AgentFolioTool({
  apiKey: '${apiKey}',
  profileId: '${profileId}'
});
const agent = createAgent({ tools: [...yourTools, tool.asTool()] });

// Option 2: As a callback handler (auto-reports all chain completions)
const handler = tool.asCallbackHandler();
const result = await chain.call(input, [handler]);`,
      python: `
from agentfolio import AgentFolioTool

# As a LangChain tool
tool = AgentFolioTool(api_key="${apiKey}", profile_id="${profileId}")
agent = initialize_agent(tools=[*your_tools, tool.as_langchain_tool()], ...)

# As a callback handler
handler = tool.as_callback_handler()
result = chain.run(input, callbacks=[handler])`
    },
    crewai: {
      javascript: `
const { CrewAIIntegration } = require('agentfolio');

const folio = new CrewAIIntegration({ apiKey: '${apiKey}' });

// Register each crew member
await folio.registerAgent({
  name: 'Researcher',
  role: 'research',
  skills: ['web_search', 'analysis']
});

// Report task completions
await folio.onTaskComplete('Researcher', task, result);`,
      python: `
from agentfolio import CrewAIIntegration

folio = CrewAIIntegration(api_key="${apiKey}")

# Register agents
folio.register_agent(name="Researcher", role="research", skills=["web_search"])

# After each task
folio.on_task_complete("Researcher", task, result)`
    },
    autogpt: {
      javascript: `
const { AutoGPTIntegration } = require('agentfolio');

const plugin = new AutoGPTIntegration({
  apiKey: '${apiKey}',
  profileId: '${profileId}'
});

await plugin.init({ name: 'MyAutoGPT', goals: ['...'] });
plugin.startAutoSync(60000); // Sync every minute

// In your command loop:
plugin.reportCommand('web_search', { query: '...' }, result);`,
      python: `
from agentfolio import AutoGPTPlugin

plugin = AutoGPTPlugin(api_key="${apiKey}", profile_id="${profileId}")
plugin.init(name="MyAutoGPT", goals=["..."])
plugin.start_auto_sync(interval=60)

# In command loop:
plugin.report_command("web_search", {"query": "..."}, result)`
    },
    elizaos: {
      javascript: `
const { ElizaOSIntegration } = require('agentfolio');

const folio = new ElizaOSIntegration({ apiKey: '${apiKey}' });

// Register your character
await folio.registerCharacter({
  name: 'MyAgent',
  bio: 'An AI assistant',
  topics: ['crypto', 'trading']
});

// In message handler:
folio.onMessage(userMessage, agentResponse);`
    }
  };

  return snippets[framework] || snippets.langchain;
}

// ─── Integration Guides ───

function getIntegrationGuides() {
  return {
    langchain: {
      framework: 'LangChain / LangGraph',
      overview: 'Integrate AgentFolio into your LangChain agent as either a tool (agent can update its own profile) or a callback handler (auto-reports all chain completions).',
      quickstart: [
        '1. Get an API key from /api/integrations/setup',
        '2. Install: npm install agentfolio (or use the REST API directly)',
        '3. Add as tool or callback handler to your agent',
        '4. Your agent\'s activity auto-syncs to its AgentFolio profile'
      ],
      features: [
        'Tool mode: Agent can update bio, skills, and report tasks',
        'Callback mode: Auto-reports chain completions and errors',
        'Profile auto-creation on first connect',
        'Non-blocking: errors don\'t affect your agent\'s operation'
      ],
      apiEndpoints: [
        'POST /api/profile - Register agent',
        'PATCH /api/profile/:id - Update profile',
        'POST /api/profile/:id/activity - Report activity',
        'GET /api/profile/:id - Get profile'
      ]
    },
    crewai: {
      framework: 'CrewAI',
      overview: 'Register your entire crew on AgentFolio. Each crew member gets their own verified profile with task history and performance metrics.',
      quickstart: [
        '1. Get an API key',
        '2. Register each crew member with registerAgent()',
        '3. Call onTaskComplete() after each task',
        '4. Crew performance auto-syncs to profiles'
      ],
      features: [
        'Multi-agent registration (one call per crew member)',
        'Task completion tracking per agent',
        'Crew-level metrics aggregation',
        'Role-based profile categorization'
      ]
    },
    autogpt: {
      framework: 'AutoGPT',
      overview: 'Track your AutoGPT agent\'s autonomous operations on AgentFolio. Commands are batched and synced periodically for minimal overhead.',
      quickstart: [
        '1. Get an API key',
        '2. Init with your agent config',
        '3. Call reportCommand() in your loop',
        '4. startAutoSync() handles the rest'
      ],
      features: [
        'Command logging with batched uploads',
        'Auto-sync on configurable interval',
        'Goal tracking and progress reporting',
        'Minimal overhead (non-blocking, batched)'
      ]
    },
    elizaos: {
      framework: 'ElizaOS',
      overview: 'Connect your ElizaOS character to AgentFolio for profile management and activity tracking.',
      quickstart: [
        '1. Get an API key',
        '2. Register your character config',
        '3. Call onMessage() in your handler',
        '4. Metrics auto-sync every 100 messages or 5 minutes'
      ],
      features: [
        'Character config → profile mapping',
        'Message count and activity tracking',
        'Personality and style metadata',
        'Batched sync (efficient for high-volume agents)'
      ]
    }
  };
}

// ─── DB Migration ───

function ensureIntegrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      framework TEXT NOT NULL,
      api_key TEXT,
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(profile_id, framework)
    );
    CREATE INDEX IF NOT EXISTS idx_integrations_profile ON integrations(profile_id);
    CREATE INDEX IF NOT EXISTS idx_integrations_framework ON integrations(framework);
  `);
}

// ─── Legacy Exports (used by server.js) ───

function getSupportedFrameworks() {
  return ['langchain', 'crewai', 'autogpt', 'elizaos'];
}

function getIntegrationCode(framework, opts = {}) {
  const apiKey = opts.apiKey || 'agf_YOUR_API_KEY';
  const profileId = opts.profileId || 'your-agent-id';
  const snippets = generateSetupCode(framework, apiKey, profileId);
  const guides = getIntegrationGuides();
  const guide = guides[framework] || {};
  
  const names = {
    langchain: 'LangChain / LangGraph',
    crewai: 'CrewAI',
    autogpt: 'AutoGPT',
    elizaos: 'ElizaOS'
  };

  // Return shape expected by server.js (name, language, install, code)
  const jsCode = snippets?.javascript || snippets?.python || '';
  return {
    id: framework,
    name: names[framework] || framework,
    language: 'JavaScript',
    install: 'npm install agentfolio',
    code: typeof jsCode === 'string' ? jsCode.trim() : JSON.stringify(jsCode),
    overview: guide.overview || '',
    quickstart: guide.quickstart || [],
    features: guide.features || []
  };
}

module.exports = {
  AgentFolioClient,
  LangChainIntegration,
  CrewAIIntegration,
  AutoGPTIntegration,
  ElizaOSIntegration,
  setupIntegrationRoutes,
  ensureIntegrationsTable,
  getSupportedFrameworks,
  getIntegrationCode
};
