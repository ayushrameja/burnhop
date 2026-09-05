import { startBackend } from './app';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 18) throw new Error('Burnhop requires Node 22.18 or newer within Node 22.x.');
const port = Number(process.env.PORT ?? 2567);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server PORT.');
const { server } = await startBackend(port);
process.send?.('ready');
console.log(`Burnhop match server listening on port ${port}`);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await server.gracefullyShutdown(false);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
