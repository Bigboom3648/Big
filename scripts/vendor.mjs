// Обновляет копии библиотек в public/vendor/ из node_modules (после npm install).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(root, to));
  console.log(from + ' -> ' + to);
};
copy('node_modules/three/build/three.module.js', 'public/vendor/three/three.module.js');
copy('node_modules/three/LICENSE', 'public/vendor/three/LICENSE');
copy('node_modules/peerjs/dist/peerjs.min.js', 'public/vendor/peerjs/peerjs.min.js');
copy('node_modules/peerjs/LICENSE', 'public/vendor/peerjs/LICENSE');
