import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { networkDispatcher } from '../server/network.js';

test('native model fetch respects the proxy while loopback worker credentials always bypass it', { timeout: 10_000 }, async t => {
  const target = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ host: request.headers.host, authorization: request.headers.authorization })); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve)); const targetPort = (target.address() as AddressInfo).port;
  t.after(() => { target.closeAllConnections(); target.close(); });
  const tunnels: string[] = []; const sockets = new Set<Socket>();
  const proxy = createServer((incoming, response) => {
    const url = new URL(incoming.url || ''); tunnels.push(url.host);
    const upstream = httpRequest({ host: '127.0.0.1', port: targetPort, path: url.pathname, method: incoming.method, headers: incoming.headers, agent: false }, result => { response.writeHead(result.statusCode || 502, result.headers); result.pipe(response); });
    upstream.on('error', () => response.destroy()); incoming.pipe(upstream);
  });
  proxy.on('connection', socket => sockets.add(socket));
  proxy.on('connect', (request, client, head) => {
    tunnels.push(request.url || ''); sockets.add(client as Socket);
    const upstream = connect(targetPort, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
    sockets.add(upstream); upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve)); const proxyPort = (proxy.address() as AddressInfo).port;
  t.after(() => { for (const socket of sockets) socket.destroy(); proxy.close(); });
  const previous = getGlobalDispatcher();
  const dispatcher = networkDispatcher({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: 'unrelated.invalid' });
  setGlobalDispatcher(dispatcher); t.after(async () => { setGlobalDispatcher(previous); await dispatcher.destroy(); });
  const model = await fetch(`http://model-fixture.invalid:${targetPort}/v1`, { headers: { authorization: 'Bearer fictional-model-key' }, signal: AbortSignal.timeout(3000) });
  assert.equal((await model.json()).authorization, 'Bearer fictional-model-key');
  const worker = await fetch(`http://127.0.0.1:${targetPort}/worker`, { headers: { authorization: 'Bearer private-worker-token' }, signal: AbortSignal.timeout(3000) });
  assert.equal((await worker.json()).authorization, 'Bearer private-worker-token');
  assert.deepEqual(tunnels, ['model-fixture.invalid:' + targetPort]);
});

test('proxy override can disable inheritance and rejects unsupported addresses without exposing them', async () => {
  const direct = networkDispatcher({ PICODING_MODEL_PROXY: 'none', HTTPS_PROXY: 'socks5://secret@invalid' }); await direct.close();
  assert.throws(() => networkDispatcher({ PICODING_MODEL_PROXY: 'socks5://secret@invalid' }), error => { assert.ok(error instanceof Error); assert.match(error.message, /模型代理地址无效/); assert.equal(error.message.includes('secret'), false); return true; });
});
