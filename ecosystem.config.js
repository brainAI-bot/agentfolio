module.exports = {
  apps: [{
    name: 'agentfolio',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: 3333
    },
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 8000,
    // Restart limits to prevent crash loops
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 2000,
    // Logs
    error_file: '/home/ubuntu/.pm2/logs/agentfolio-error.log',
    out_file: '/home/ubuntu/.pm2/logs/agentfolio-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
