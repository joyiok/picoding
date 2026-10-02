import { createServer, connect } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { timingSafeEqual } from 'node:crypto';

// This authenticated transport runs separately from task computers and only
// listens on Docker's bridge, forwarding to a loopback-only host proxy.
export function createProxyRelay(upstream: URL, token: string) {
  const expected = Buffer.from('Basic ' + Buffer.from('task:' + token).toString('base64'));
  return createServer(client => {
    client.setTimeout(10_000, () => client.destroy());
    let pending = Buffer.alloc(0);
    const receive = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) { if (pending.length > 16_384) client.destroy(); return; }
      client.removeListener('data', receive);
      if (end > 16_384) { client.destroy(); return; }
      const lines = pending.subarray(0, end).toString('latin1').split('\r\n');
      const authorization = lines.find(line => /^proxy-authorization:/i.test(line))?.split(':').slice(1).join(':').trim() || '';
      const received = Buffer.from(authorization);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="PiCoding"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        return;
      }
      const headers = lines.filter(line => !/^(proxy-authorization|proxy-connection|connection):/i.test(line));
      if (upstream.username || upstream.password) headers.push('Proxy-Authorization: Basic ' + Buffer.from(decodeURIComponent(upstream.username) + ':' + decodeURIComponent(upstream.password)).toString('base64'));
      if (!lines[0].startsWith('CONNECT ')) headers.push('Connection: close');
      const options = { host: upstream.hostname, port: Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80)) };
      const socket = upstream.protocol === 'https:' ? connectTls({ ...options, servername: upstream.hostname }) : connect(options);
      client.pause();
      socket.on(upstream.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
        client.setTimeout(0);
        socket.write(headers.join('\r\n') + '\r\n\r\n'); socket.write(pending.subarray(end + 4));
        socket.pipe(client); client.pipe(socket); client.resume();
      });
      socket.on('error', () => client.destroy());
      client.on('close', () => socket.destroy()); client.on('error', () => socket.destroy());
    };
    client.on('error', () => {}); client.on('data', receive);
  });
}

if (process.env.PICODING_PROXY_RELAY === '1') {
  const upstream = new URL(process.env.UPSTREAM_PROXY!);
  const token = process.env.RELAY_TOKEN;
  if (!token || !['http:', 'https:'].includes(upstream.protocol)) throw new Error('Invalid proxy relay configuration');
  const server = createProxyRelay(upstream, token);
  server.listen(0, process.env.RELAY_GATEWAY, () => {
    const address = server.address() as { port: number }; console.log('PROXY_PORT=' + address.port);
  });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}
