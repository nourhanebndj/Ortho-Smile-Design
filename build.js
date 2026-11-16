'use strict';
// Build pour Vercel : copie le site statique (index.html + public/) dans dist/.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'site.webmanifest']) {
  fs.copyFileSync(path.join(__dirname, f), path.join(out, f));
}
fs.cpSync(path.join(__dirname, 'public'), path.join(out, 'public'), { recursive: true });
console.log('Site copié dans dist/');
