module.exports = {
  apps: [
    {
      name: 'agentfolio-frontend',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/home/ubuntu/clawd/brainKID/projects/agent-portfolio/frontend',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        API_URL: 'http://localhost:3333',
        NEXT_PUBLIC_API_URL: ''
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      error_file: '/home/ubuntu/clawd/brainKID/projects/agent-portfolio/frontend/logs/error.log',
      out_file: '/home/ubuntu/clawd/brainKID/projects/agent-portfolio/frontend/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
