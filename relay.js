// Local HTTP(S) -> SOCKS4/SOCKS5 relay.
// Chromium cannot authenticate to SOCKS proxies, so when a SOCKS proxy needs a
// username/password we point the service's session at this relay instead. The relay
// speaks plain HTTP proxy to Chromium and opens upstream connections through the
// SOCKS server with credentials.
const net = require('net');
const { SocksClient } = require('socks');

const relays = new Map(); // id -> { server, sockets:Set }

function openUpstream(up, host, port) {
  return SocksClient.createConnection({
    proxy: {
      host: up.host,
      port: Number(up.port),
      type: up.type === 'socks4' ? 4 : 5,
      userId: up.username || undefined,
      password: up.password || undefined
    },
    command: 'connect',
    destination: { host, port },
    timeout: 20000
  }).then(r => r.socket);
}

function parseHostPort(t, def) {
  const m = t.match(/^\[(.+)\]:(\d+)$/) || t.match(/^(.+):(\d+)$/);
  return m ? { host: m[1], port: Number(m[2]) } : { host: t, port: def };
}

function handle(client, up, sockets) {
  sockets.add(client);
  client.on('close', () => sockets.delete(client));
  client.on('error', () => {});
  let buf = Buffer.alloc(0);

  const onData = async chunk => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) {
      if (buf.length > 65536) client.destroy();
      return;
    }
    client.removeListener('data', onData);
    client.pause();

    const lines = buf.slice(0, end).toString('latin1').split('\r\n');
    const rest = buf.slice(end + 4);
    const [method, target, ver] = lines[0].split(' ');

    try {
      let s;
      if (method === 'CONNECT') {
        const { host, port } = parseHostPort(target, 443);
        s = await openUpstream(up, host, port);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) s.write(rest);
      } else {
        const u = new URL(target);
        s = await openUpstream(up, u.hostname.replace(/^\[|\]$/g, ''), Number(u.port) || 80);
        const headers = lines
          .slice(1)
          .filter(l => !/^(proxy-connection|connection):/i.test(l));
        headers.push('Connection: close');
        const head = [`${method} ${u.pathname}${u.search} ${ver}`, ...headers].join('\r\n') + '\r\n\r\n';
        s.write(Buffer.concat([Buffer.from(head, 'latin1'), rest]));
      }
      sockets.add(s);
      s.on('close', () => { sockets.delete(s); client.destroy(); });
      s.on('error', () => client.destroy());
      client.on('close', () => s.destroy());
      s.pipe(client);
      client.pipe(s);
      client.resume();
    } catch (e) {
      client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nProxy error: ' + e.message);
    }
  };
  client.on('data', onData);
}

function startRelay(id, up) {
  stopRelay(id);
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const server = net.createServer(c => handle(c, up, sockets));
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      relays.set(id, { server, sockets });
      resolve(server.address().port);
    });
  });
}

function stopRelay(id) {
  const r = relays.get(id);
  if (!r) return;
  r.server.close();
  for (const s of r.sockets) s.destroy();
  relays.delete(id);
}

module.exports = { startRelay, stopRelay };
