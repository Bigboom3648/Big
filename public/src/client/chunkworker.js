// Воркер чанков: тяжёлая работа (генерация, свет, геометрия) вне основного потока.
import { createEngine } from './enginecore.js';

const engine = createEngine((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = (e) => engine.handle(e.data);
self.postMessage({ t: 'ready' });
