import net from 'node:net';

const availableServices = new Map([
  ['postgres', ['PostgreSQL', process.env.SHOPS_POSTGRES_HOST || '127.0.0.1', Number(process.env.SHOPS_POSTGRES_PORT || 55432)]],
  ['minio', ['MinIO', process.env.SHOPS_MINIO_HOST || '127.0.0.1', Number(process.env.SHOPS_MINIO_PORT || 59000)]],
]);

const requiredServiceNames = (process.env.SHOPS_REQUIRED_SERVICES || 'postgres,minio')
  .split(',')
  .map(name => name.trim().toLowerCase())
  .filter(Boolean);

if (requiredServiceNames.length === 0) throw new Error('SHOPS_REQUIRED_SERVICES must name at least one service');

const services = requiredServiceNames.map(name => {
  const service = availableServices.get(name);
  if (!service) throw new Error(`unknown required service: ${name}`);
  return service;
});

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
