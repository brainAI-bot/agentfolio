import net from 'node:net';

const services = [
  ['PostgreSQL', process.env.SHOPS_POSTGRES_HOST || '127.0.0.1', Number(process.env.SHOPS_POSTGRES_PORT || 55432)],
  ['MinIO', process.env.SHOPS_MINIO_HOST || '127.0.0.1', Number(process.env.SHOPS_MINIO_PORT || 59000)],
];

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.once('error', reject);
  });
}

for (const [name, host, port] of services) {
  let ready = false;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try { await connect(host, port); ready = true; break; } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  if (!ready) throw new Error(`${name} did not become reachable at ${host}:${port}`);
  console.log(`${name} reachable at ${host}:${port}`);
}
