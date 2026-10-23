import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
let explicitPort = false;
let attempts = 0;
const options = { host: '127.0.0.1', port: 4173 };
for (let index = 2; index < process.argv.length; index += 1) {
  const option = process.argv[index];
  if (option === '--host' || option === '--port') {
    const value = process.argv[++index];
    if (!value) throw new Error(`A value is required for ${option}.`);
    if (option === '--port') explicitPort = true;
    options[option.slice(2)] = option === '--port' ? Number(value) : value;
  } else {
    throw new Error(`Unknown option: ${option}. Use --host or --port.`);
  }
}
if (options.host !== '127.0.0.1' && options.host !== '::1') throw new Error('Use a loopback host.');
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  throw new Error('The port must be an integer between 1 and 65535.');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(path);
    if (info.isDirectory()) path = resolve(path, 'index.html');
    const content = await readFile(path);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(path)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const code = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400;
    response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(code === 404 ? 'Not found' : 'Bad request');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && !explicitPort && attempts < 20 && options.port < 65535) {
    attempts++;
    options.port++;
    server.listen(options.port, options.host);
    return;
  }
  console.error(`Could not start Shobdokosh: ${error.message}`);
  process.exitCode = 1;
});
server.listen(options.port, options.host, () => {
  console.log(`Shobdokosh is ready at http://${options.host}:${options.port}`);
  console.log('Use HTTPS when hosting publicly so offline mode and installation are available.');
});
