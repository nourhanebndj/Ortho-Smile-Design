'use strict';
/**
 * Serveur local de prévisualisation. Sert le dossier du projet :
 *   index.html (racine) + public/ (css, js, assets, admin).
 * Les données sont dans Firebase Firestore, la connexion passe par Firebase Auth.
 * Lancer :  node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const ALLOWED = [path.join(ROOT, 'index.html'), path.join(ROOT, 'public') + path.sep];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };

http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') { res.writeHead(302, { Location: '/public/admin/' }); return res.end(); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!ALLOWED.some((a) => file === a || file.startsWith(a))) { res.writeHead(404); return res.end('Page introuvable'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Page introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n  Ortho Smile Design (Firebase)`);
  console.log(`  Site      : http://localhost:${PORT}`);
  console.log(`  Dashboard : http://localhost:${PORT}/public/admin/\n`);
});
