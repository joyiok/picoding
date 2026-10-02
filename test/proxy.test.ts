import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { createProxyRelay } from '../sandbox/forward-proxy.js';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}
function exchange(port: number, data: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'); let output = '';
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('relay timeout')); });
    socket.on('connect', () => socket.write(data)); socket.on('data', chunk => { output += chunk.toString(); });
    socket.on('end', () => resolve(output)); socket.on('error', reject);
  });
}
function cleanup(...servers: Server[]) {
  const sockets = new Set<Socket>();
  for (const server of servers) server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return async () => { for (const socket of sockets) socket.destroy(); await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))); };
}

test('network relay rejects unknown credentials before contacting the host proxy', async t => {
  let contacted = false;
  const upstream = createServer(socket => { contacted = true; socket.destroy(); });
  const upstreamPort = await listen(upstream);
  const relay = createProxyRelay(new URL('http://127.0.0.1:' + upstreamPort), 'fixture-token');
  t.after(cleanup(upstream, relay));
  const port = await listen(relay);
  assert.match(await exchange(port, 'CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n'), /^HTTP\/1.1 407/);
  assert.equal(contacted, false);
});

test('network relay forwards HTTP requests and replaces task authorization with upstream credentials', async t => {
  let forwarded = '';
  const upstream = createServer(socket => socket.on('data', chunk => {
    forwarded += chunk.toString();
    if (forwarded.includes('\r\n\r\n')) socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
  }));
  const upstreamPort = await listen(upstream);
  const relay = createProxyRelay(new URL('http://proxy-user:upstream-fixture@127.0.0.1:' + upstreamPort), 'task-fixture');
  t.after(cleanup(upstream, relay));
  const port = await listen(relay);
  const authorization = Buffer.from('task:task-fixture').toString('base64');
  const response = await exchange(port, 'GET http://example.invalid/data HTTP/1.1\r\nHost: example.invalid\r\nProxy-Authorization: Basic ' + authorization + '\r\n\r\n');
  assert.match(response, /^HTTP\/1.1 200/); assert.ok(response.endsWith('ok'));
  assert.ok(forwarded.includes(Buffer.from('proxy-user:upstream-fixture').toString('base64')));
  assert.ok(!forwarded.includes(authorization)); assert.ok(forwarded.startsWith('GET http://example.invalid/data '));
});

test('network relay preserves a CONNECT tunnel after authenticating', async t => {
  let connected = false;
  const upstream = createServer(socket => {
    let pending = '';
    socket.on('data', chunk => {
      if (connected) { socket.write(chunk); return; }
      pending += chunk.toString();
      if (pending.includes('\r\n\r\n')) { connected = true; socket.write('HTTP/1.1 200 Connection established\r\n\r\n'); }
    });
  });
  const upstreamPort = await listen(upstream);
  const relay = createProxyRelay(new URL('http://127.0.0.1:' + upstreamPort), 'task-fixture');
  t.after(cleanup(upstream, relay));
  const port = await listen(relay);
  await new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'); let output = ''; let sent = false;
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('tunnel timeout')); });
    socket.on('error', reject);
    socket.on('connect', () => socket.write('CONNECT example.invalid:443 HTTP/1.1\r\nProxy-Authorization: Basic ' + Buffer.from('task:task-fixture').toString('base64') + '\r\n\r\n'));
    socket.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('200 Connection established') && !sent) { sent = true; socket.write('tunnel-fixture-payload'); }
      if (output.includes('tunnel-fixture-payload')) { socket.destroy(); resolve(); }
    });
  });
  assert.equal(connected, true);
});
