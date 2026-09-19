module.exports = {
  apps: [
    {
      name: 'agentfolio-frontend',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/home/ubuntu/agentfolio/frontend',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        INTERNAL_API_URL: 'http://127.0.0.1:3333'
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      error_file: '/home/ubuntu/.pm2/logs/agentfolio-frontend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/agentfolio-frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
