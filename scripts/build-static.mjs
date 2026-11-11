// Собирает папку dist/ — статическую версию игры без сервера. В ней работают
// одиночная игра и игра с друзьями по коду. Её можно выложить на любой
// статический хостинг (например, GitHub Pages). Папка public/ — то же самое.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
console.log('Готово: ' + dist);
