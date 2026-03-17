module.exports = {
  apps: [{
    name: "agentfolio",
    script: "src/server.js",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "256M",
    env: {
      NODE_ENV: "production",
      PORT: 3333,
      BOA_CLUSTER: "mainnet",
      SATP_NETWORK: "mainnet",
      SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb",
      SATP_PLATFORM_KEYPAIR: "/home/ubuntu/.config/solana/satp-mainnet-platform.json"
    },
    kill_timeout: 5000,
    listen_timeout: 8000,
    max_restarts: 10,
    min_uptime: "10s",
    restart_delay: 2000,
    error_file: "/home/ubuntu/.pm2/logs/agentfolio-error.log",
    out_file: "/home/ubuntu/.pm2/logs/agentfolio-out.log",
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z"
  }]
};
