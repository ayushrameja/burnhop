import { createServer, type IncomingMessage, type ServerResponse, type RequestListener } from 'node:http';
import { LocalDriver, LocalPresence, Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BurnhopRoom } from './BurnhopRoom';
import { COMPATIBILITY_ID, MATCH_CONFIG } from '../multiplayer/model';
import { allowedOrigins, isAllowedOrigin, MAX_REQUEST_BYTES, RateLimiter } from './security';

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function installHttpGuard(http: ReturnType<typeof createServer>): void {
  const downstream = http.listeners('request') as RequestListener[];
  const requests = new RateLimiter(40, 2);
  const creates = new RateLimiter(3, 1 / 30);
  const lookups = new RateLimiter(30, 1);
  http.removeAllListeners('request');
  http.on('request', (request: IncomingMessage, response: ServerResponse) => {
    request.setTimeout(10_000, () => request.destroy());
    const path = (request.url ?? '/').split('?')[0];
    const origin = request.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && ['/health', '/__healthcheck', '/'].includes(path)) {
      json(response, 200, { ok: true, compatibility: COMPATIBILITY_ID, tickRate: MATCH_CONFIG.tickRate, stateRate: MATCH_CONFIG.stateRate, interpolationDelayMs: MATCH_CONFIG.interpolationDelayMs, maxPlayers: MATCH_CONFIG.maxPlayers });
      return;
    }
    if (request.method === 'GET' && path === '/metrics') {
      const active = BurnhopRoom.active;
      json(response, 200, {
        uptimeSeconds: process.uptime(), rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed,
        activeRooms: active ? 1 : 0, connectedPlayers: active?.clients.length ?? 0,
        reservedPlayers: active ? Object.values(active.match.players).filter(player => !player.connected).length : 0,
        simulation: active?.metrics.snapshot() ?? null,
      });
      return;
    }
    if (!isAllowedOrigin(origin)) { json(response, 403, { code: 403, error: 'Open Burnhop from the game website.' }); return; }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    // Without an explicitly configured trusted reverse proxy, never accept spoofed X-Forwarded-For.
    const address = request.socket.remoteAddress ?? 'unknown';
    if (request.method === 'GET' && /^\/room\/[A-Fa-f0-9]{20}$/.test(path)) {
      if (!lookups.take(address)) { json(response, 429, { error: 'Please wait before checking another invitation.' }); return; }
      const code = path.slice('/room/'.length).toUpperCase();
      const room = BurnhopRoom.active;
      if (!room || room.roomId !== code) { json(response, 404, { error: 'Room not found. Check your invitation.' }); return; }
      json(response, 200, { code, phase: room.match.phase, locked: room.locked,
        players: Object.keys(room.match.players).length, maxPlayers: MATCH_CONFIG.maxPlayers, compatibility: COMPATIBILITY_ID });
      return;
    }
    const route = /^\/matchmake\/(create|joinById|reconnect)\/([A-Za-z0-9_-]+)$/.exec(path);
    if (request.method !== 'POST' || !route || (route[1] === 'create' && route[2] !== 'burnhop')) {
      json(response, 404, { code: 404, error: 'Route not found.' }); return;
    }
    if (!requests.take(address)) {
      response.setHeader('Retry-After', '3');
      json(response, 429, { code: 429, error: 'Please wait a moment before joining again.' }); return;
    }
    const length = Number(request.headers['content-length']);
    if (!Number.isSafeInteger(length) || length < 0 || request.headers['transfer-encoding']) {
      json(response, 411, { code: 411, error: 'A bounded JSON body is required.' }); return;
    }
    if (length > MAX_REQUEST_BYTES) { json(response, 413, { code: 413, error: 'Room request is too large.' }); return; }
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      json(response, 415, { code: 415, error: 'Use JSON for room requests.' }); return;
    }
    if (route[1] === 'create' && !creates.take(address)) {
      json(response, 429, { code: 429, error: 'Please wait before creating another room.' }); return;
    }
    for (const listener of downstream) listener.call(http, request, response);
  });
}

export async function startBackend(port = 2567, hostname = '0.0.0.0') {
  allowedOrigins(); // Fail at startup for malformed preview configuration.
  const http = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 10_000 });
  const upgrades = new RateLimiter(48, 4);
  const transport = new WebSocketTransport({
    server: http, maxPayload: MAX_REQUEST_BYTES, perMessageDeflate: false,
    pingInterval: 3000, pingMaxRetries: 2,
    verifyClient: (info, next) => {
      const accepted = isAllowedOrigin(info.origin) && upgrades.take(info.req.socket.remoteAddress ?? 'unknown');
      next(accepted, accepted ? undefined : 403, accepted ? undefined : 'Origin or connection limit rejected');
    },
  });
  matchMaker.controller.DEFAULT_CORS_HEADERS = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': '',
    'Access-Control-Max-Age': '600',
  };
  matchMaker.controller.getCorsHeaders = (headers): Record<string, string> => {
    const origin = headers.get('origin');
    return origin && isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
  };
  // Cloud delegates Server.listen() to @colyseus/tools and binds a Unix socket.
  // Its delegated call drops the outer listening callback. Wrap the transport
  // callback instead: Colyseus binds its routes first, then the guard installs
  // synchronously before either local or Cloud startup reports readiness.
  const listen = transport.listen.bind(transport);
  transport.listen = (address, host, backlog, onListening) => listen(address, host, backlog, () => {
    onListening?.();
    installHttpGuard(http);
  });
  const server = new Server({ transport, presence: new LocalPresence(), driver: new LocalDriver(),
    greet: false, gracefullyShutdown: false });
  server.define('burnhop', BurnhopRoom);
  await server.listen(port, hostname);
  const address = http.address();
  if (!address) throw new Error('The game server did not start listening.');
  return { server, http, port: typeof address === 'string' ? port : address.port, address };
}
