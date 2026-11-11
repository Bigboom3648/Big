// Звуки синтезируются на лету через WebAudio — без звуковых файлов.
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noise(dur, freq, q, gain, type = 'bandpass', delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  tone(f0, f1, dur, type, gain, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(name, vol = 1) {
    if (!this.ctx || vol <= 0.01) return;
    const r = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'dig':
        this.noise(0.08, 850 * r, 1.2, 0.35 * vol);
        break;
      case 'break':
        this.noise(0.17, 520 * r, 0.8, 0.7 * vol);
        this.tone(160 * r, 70, 0.1, 'square', 0.12 * vol);
        break;
      case 'place':
        this.noise(0.06, 1300 * r, 1, 0.3 * vol);
        this.tone(190 * r, 110, 0.08, 'square', 0.18 * vol);
        break;
      case 'step':
        this.noise(0.05, 380 * r, 1, 0.13 * vol);
        break;
      case 'pop':
        this.tone(620 * r, 980, 0.08, 'sine', 0.22 * vol);
        break;
      case 'craft':
        this.tone(520, 520, 0.07, 'square', 0.1 * vol);
        this.tone(780, 780, 0.09, 'square', 0.1 * vol, 0.07);
        break;
      case 'hurt':
        this.tone(230 * r, 100, 0.22, 'sawtooth', 0.28 * vol);
        break;
      case 'hit':
        this.noise(0.08, 320, 1, 0.5 * vol);
        this.tone(150, 80, 0.1, 'square', 0.15 * vol);
        break;
      case 'mobdie':
        this.tone(520 * r, 120, 0.3, 'triangle', 0.25 * vol);
        break;
      case 'boom':
        this.noise(0.9, 140, 0.4, 1.5 * vol, 'lowpass');
        this.tone(75, 28, 0.7, 'sine', 0.9 * vol);
        break;
      case 'fuse':
        this.noise(2.2, 5200, 3, 0.1 * vol, 'highpass');
        break;
      case 'tp':
        this.tone(300, 1300, 0.35, 'sine', 0.25 * vol);
        this.tone(450, 1900, 0.35, 'triangle', 0.12 * vol, 0.04);
        break;
      case 'hook':
        this.tone(950, 300, 0.14, 'square', 0.09 * vol);
        this.noise(0.1, 2400, 2, 0.15 * vol);
        break;
      case 'boing':
        this.tone(190 * r, 620, 0.24, 'sine', 0.35 * vol);
        break;
      case 'eat':
        this.noise(0.07, 700, 2, 0.3 * vol);
        this.noise(0.07, 600, 2, 0.3 * vol, 'bandpass', 0.12);
        break;
      default:
        break;
    }
  }
}
