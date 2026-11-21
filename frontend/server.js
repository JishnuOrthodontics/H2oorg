const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname);

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.webp': 'image/webp'
};

function safeFilePath(requestUrl) {
    let urlPath = requestUrl || '/';
    const qIndex = urlPath.indexOf('?');
    if (qIndex !== -1) urlPath = urlPath.substring(0, qIndex);
    const hIndex = urlPath.indexOf('#');
    if (hIndex !== -1) urlPath = urlPath.substring(0, hIndex);

    try {
        urlPath = decodeURIComponent(urlPath);
    } catch {
        return null;
    }

    if (urlPath.includes('\0')) return null;

    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^[/\\]+/, '');
    const resolved = path.resolve(ROOT, relative);

    // Prevent path traversal (../../etc/passwd)
    const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
    if (resolved !== ROOT && !resolved.startsWith(rootWithSep)) {
        return null;
    }
    return resolved;
}

const server = http.createServer((req, res) => {
    const filePath = safeFilePath(req.url);
    if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 H2O Frontend server running at http://localhost:${PORT}`);
});
