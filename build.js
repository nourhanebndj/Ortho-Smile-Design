'use strict';
// Build pour Vercel : copie le site statique (index.html + public/) dans dist/.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(out, 'index.html'));
fs.cpSync(path.join(__dirname, 'public'), path.join(out, 'public'), { recursive: true });
console.log('Site copié dans dist/');
