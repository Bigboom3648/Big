// Собирает папку dist/ — статическую версию игры без сервера (одиночный режим).
// Её можно выложить на любой статический хостинг, например GitHub Pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'vendor', 'three'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'node_modules', 'three', 'build', 'three.module.js'),
  path.join(dist, 'vendor', 'three', 'three.module.js'),
);
console.log('Готово: ' + dist);
