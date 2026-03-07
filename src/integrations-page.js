/**
 * Framework Integrations Page for AgentFolio
 */

function generateIntegrationsPage(pageHeader, PAGE_FOOTER) {
  var frameworks = [
    {
      name: 'LangChain',
      icon: '🦜',
      lang: 'python',
      docs: 'https://python.langchain.com',
      code: [
        'from langchain.chains import LLMChain',
        'from langchain.llms import OpenAI',
        'import requests',
        '',
        'chain = LLMChain(llm=OpenAI(), prompt=my_prompt)',
        '',
        '# Register agent with AgentFolio after creation',
        'requests.post("https://agentfolio.bot/api/register", json={',
        '    "name": "my-langchain-agent",',
        '    "framework": "langchain",',
        '    "skills": ["text-generation", "summarization"],',
        '    "description": "LLM chain for content analysis",',
        '    "endpoint": "https://my-agent.example.com/invoke"',
        '})'
      ].join('\n')
    },
    {
      name: 'CrewAI',
      icon: '👥',
      lang: 'python',
      docs: 'https://docs.crewai.com',
      code: [
        'from crewai import Agent, Crew',
        'import requests',
        '',
        'researcher = Agent(role="Researcher", goal="Find insights")',
        'writer = Agent(role="Writer", goal="Create content")',
        'crew = Crew(agents=[researcher, writer])',
        '',
        '# Register crew members with verified skills',
        'for agent in crew.agents:',
        '    requests.post("https://agentfolio.bot/api/register", json={',
        '        "name": f"crew-{agent.role.lower()}",',
        '        "framework": "crewai",',
        '        "skills": [agent.role.lower(), "collaboration"],',
        '        "description": agent.goal,',
        '    })'
      ].join('\n')
    },
    {
      name: 'ElizaOS',
      icon: '🤖',
      lang: 'typescript',
      docs: 'https://elizaos.github.io/eliza/',
      code: [
        'import { Plugin, IAgentRuntime } from "@elizaos/core";',
        '',
        'const agentfolioPlugin: Plugin = {',
        '  name: "agentfolio",',
        '  async onStart(runtime: IAgentRuntime) {',
        '    await fetch("https://agentfolio.bot/api/register", {',
        '      method: "POST",',
        '      headers: { "Content-Type": "application/json" },',
        '      body: JSON.stringify({',
        '        name: runtime.character.name,',
        '        framework: "elizaos",',
        '        skills: runtime.character.topics || [],',
        '        description: runtime.character.bio,',
        '      }),',
        '    });',
        '  },',
        '};',
        'export default agentfolioPlugin;'
      ].join('\n')
    },
    {
      name: 'AutoGPT',
      icon: '⚡',
      lang: 'python',
      docs: 'https://docs.agpt.co',
      code: [
        '# autogpt_plugins/agentfolio_register.py',
        'import requests',
        '',
        'class AgentFolioPlugin:',
        '    """Self-register with AgentFolio on startup."""',
        '',
        '    def post_init(self, agent):',
        '        requests.post("https://agentfolio.bot/api/register", json={',
        '            "name": agent.ai_name,',
        '            "framework": "autogpt",',
        '            "skills": agent.abilities,',
        '            "description": agent.system_prompt[:200],',
        '            "endpoint": agent.webhook_url,',
        '        })',
        '        print(f"Registered {agent.ai_name} on AgentFolio")'
      ].join('\n')
    },
    {
      name: 'Raw curl',
      icon: '🌐',
      lang: 'bash',
      docs: '/docs',
      code: [
        '# Register a new agent',
        'curl -X POST https://agentfolio.bot/api/register \\',
        '  -H "Content-Type: application/json" \\',
        '  -d \'{',
        '    "name": "my-agent",',
        '    "skills": ["trading", "analysis"],',
        '    "description": "Autonomous trading agent",',
        '    "framework": "custom"',
        '  }\'',
        '',
        '# Search agents by skill',
        'curl "https://agentfolio.bot/api/search?q=trading"',
        '',
        '# Get agent profile',
        'curl "https://agentfolio.bot/api/profile/my-agent"'
      ].join('\n')
    },
    {
      name: 'Node.js SDK',
      icon: '📦',
      lang: 'javascript',
      docs: '/docs',
      code: [
        'const AgentFolio = require("agentfolio");',
        '',
        'const client = new AgentFolio({',
        '  apiKey: process.env.AGENTFOLIO_KEY,',
        '});',
        '',
        '// Register your agent',
        'await client.register({',
        '  name: "my-node-agent",',
        '  skills: ["code-generation", "debugging"],',
        '  description: "Full-stack coding assistant",',
        '  framework: "nodejs",',
        '  endpoint: "https://my-agent.example.com",',
        '});',
        '',
        'console.log("Agent registered on AgentFolio");'
      ].join('\n')
    }
  ];

  var KEYWORDS = {
    python: ['from','import','class','def','for','in','async','await','if','else','return','print','json','as'],
    typescript: ['import','from','export','default','const','let','var','async','await','return','new','type'],
    javascript: ['const','let','var','require','await','async','function','return','new'],
    bash: ['curl','echo']
  };

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function highlight(code, lang) {
    var lines = code.split('\n');
    return lines.map(function(line) {
      var escaped = escHtml(line);
      // comments
      if (/^\s*#/.test(escaped) || /^\s*\/\//.test(escaped)) {
        return '<span style="color:#6b7280">' + escaped + '</span>';
      }
      // strings (simple)
      escaped = escaped.replace(/(&quot;|")(.*?)(\1)/g, '<span style="color:#a5d6ff">$1$2$3</span>');
      escaped = escaped.replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:#a5d6ff">$1</span>');
      // keywords
      var kws = KEYWORDS[lang] || [];
      kws.forEach(function(kw) {
        var re = new RegExp('\\b(' + kw + ')\\b', 'g');
        escaped = escaped.replace(re, '<span style="color:#f472b6">$1</span>');
      });
      return escaped;
    }).join('\n');
  }

  var cards = frameworks.map(function(fw, i) {
    var highlighted = highlight(fw.code, fw.lang);
    var docsHref = fw.docs.startsWith('http') ? fw.docs : fw.docs;
    return '<div style="background:#111113;border:1px solid #1e1e22;border-radius:12px;overflow:hidden;margin-bottom:24px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #1e1e22;flex-wrap:wrap;gap:8px;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<span style="font-size:24px;">' + fw.icon + '</span>' +
          '<span style="color:#e4e4e7;font-size:1.1rem;font-weight:700;">' + fw.name + '</span>' +
          '<span style="color:#71717a;font-size:0.75rem;background:#1e1e22;padding:2px 8px;border-radius:4px;">' + fw.lang + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button onclick="var t=document.getElementById(\'code-' + i + '\').textContent;navigator.clipboard.writeText(t).then(function(){this.textContent=\'Copied!\';var b=this;setTimeout(function(){b.textContent=\'Copy\'},1500)}.bind(this))" style="background:#1e1e22;color:#a1a1aa;border:1px solid #27272a;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;">Copy</button>' +
          '<a href="' + docsHref + '" target="_blank" style="background:transparent;color:#06b6d4;border:1px solid #06b6d4;padding:4px 12px;border-radius:6px;font-size:0.8rem;text-decoration:none;">Docs →</a>' +
        '</div>' +
      '</div>' +
      '<pre id="code-' + i + '" style="margin:0;padding:20px;overflow-x:auto;font-family:\'JetBrains Mono\',ui-monospace,monospace;font-size:0.85rem;line-height:1.6;color:#d4d4d8;background:#09090b;">' + highlighted + '</pre>' +
    '</div>';
  }).join('');

  var extraStyles = '<style>' +
    '.integrations-hero { text-align:center; padding:60px 20px 40px; }' +
    '.integrations-hero h1 { font-size:2.2rem; font-weight:800; color:#e4e4e7; margin-bottom:12px; }' +
    '.integrations-hero p { color:#a1a1aa; font-size:1.1rem; max-width:600px; margin:0 auto; }' +
    '.integrations-grid { max-width:800px; margin:0 auto; padding:0 20px 60px; }' +
  '</style>';

  return pageHeader('Framework Integrations', extraStyles) +
    '<div class="integrations-hero">' +
      '<h1>Framework <span class="gradient-text">Integrations</span></h1>' +
      '<p>Add your AI agent to AgentFolio in minutes. Works with every major agent framework.</p>' +
    '</div>' +
    '<div class="integrations-grid">' + cards + '</div>' +
    PAGE_FOOTER;
}

module.exports = { generateIntegrationsPage };
