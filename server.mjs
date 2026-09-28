import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const host = '0.0.0.0'
const port = Number.parseInt(process.env.PORT ?? '8080', 10)

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function insideRoot(candidate) {
  const abs = resolve(candidate)
  return abs === root || abs.startsWith(root + sep)
}

function fileFor(urlPath) {
  let pathname
  try {
    pathname = decodeURIComponent(urlPath)
  } catch {
    return { error: 400 }
  }
  const cleaned = normalize(pathname).replace(/^([/\\])+/, '')
  if (cleaned.split(/[/\\]/).includes('..')) return { error: 400 }
  const abs = resolve(root, cleaned)
  if (!insideRoot(abs)) return { error: 400 }
  return { file: abs }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/health') {
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end('ok')
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }

  const looked = fileFor(url.pathname === '/' ? '/index.html' : url.pathname)
  if (looked.error) {
    res.writeHead(looked.error, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('bad path')
    return
  }

  let file = looked.file
  let spa = false
  if (!(existsSync(file) && statSync(file).isFile())) {
    if (extname(url.pathname) !== '') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    file = join(root, 'index.html')
    spa = true
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dist missing — run npm run build')
      return
    }
  }

  const cache =
    spa || file.endsWith(`${sep}index.html`)
      ? 'no-cache'
      : 'public, max-age=31536000, immutable'
  res.writeHead(200, {
    'cache-control': cache,
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
})

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('PORT must be an integer from 1 to 65535')
  process.exit(1)
}

server.listen(port, host, () => {
  console.log(`serving ${root} on http://${host}:${port}`)
})
