// Рендер: сцена, материалы чанков, небо со сменой дня и ночи, облака.
import * as THREE from './three.js';
import { TS } from './textures.js';
import { createNoise } from '../shared/noise.js';

const CHUNK_VS = /* glsl */ `
attribute vec3 uvl;
attribute vec4 light;
varying vec3 vUvl;
varying vec4 vLight;
varying float vDist;
varying vec3 vWorld;
void main() {
  vUvl = uvl;
  vLight = light;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CHUNK_FS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uDay;
uniform vec3 uSkyTint;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uAlphaTest;
varying vec3 vUvl;
varying vec4 vLight;
varying float vDist;
varying vec3 vWorld;
void main() {
  vec4 c = texture(uTex, vUvl);
  if (c.a < uAlphaTest) discard;
  float sky = vLight.x * uDay;
  float blk = vLight.y;
  float l = max(sky, blk);
  float b = 0.05 + 0.95 * pow(l, 1.5);
  vec3 tint = mix(uSkyTint, vec3(1.0, 0.85, 0.6), clamp((blk - sky) * 1.6, 0.0, 1.0));
  vec3 col = c.rgb * tint * b * vLight.z;
  if (vLight.w > 0.75) {
    float w = sin(vWorld.x * 1.3 + uTime * 1.6) * sin(vWorld.z * 1.1 - uTime * 1.2);
    col += 0.045 * w * b;
  } else if (vLight.w > 0.25) {
    // лава медленно переливается
    float w = sin(vWorld.x * 2.1 + uTime * 0.9) * sin(vWorld.z * 1.7 - uTime * 0.7) + sin(vWorld.y * 2.3 + uTime * 1.1) * 0.5;
    col *= 1.0 + 0.16 * w;
  }
  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDist));
  gl_FragColor = vec4(col, c.a);
}`;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FS = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = pow(max(d.y, 0.0), 0.5);
  vec3 col = mix(uHorizon, uTop, t);
  if (d.y < 0.0) col = uHorizon;
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * (pow(sd, 6.0) * 0.25 + pow(sd, 60.0) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VS = /* glsl */ `
uniform vec2 uOffset;
varying vec2 vUv;
varying vec2 vLocal;
void main() {
  vUv = uv * 4.0 + uOffset;
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CLOUD_FS = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying vec2 vLocal;
void main() {
  float a = texture2D(uMap, vUv).a;
  float fade = 1.0 - smoothstep(300.0, 780.0, length(vLocal));
  gl_FragColor = vec4(uColor, a * fade * uOpacity);
}`;

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function glowTexture(inner, outer, hard) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(hard, inner);
  gr.addColorStop(hard + 0.06, outer);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function cloudTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const n = createNoise(777);
  const f = (x, y) => n.n2(x / 60, y / 60) * 0.6 + n.n2(x / 24, y / 24) * 0.28 + n.n2(x / 9, y / 9) * 0.12;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // смешиваем четыре сдвинутые копии, чтобы текстура повторялась без швов
      const u = x / S;
      const w = y / S;
      const v =
        f(x, y) * (1 - u) * (1 - w) + f(x - S, y) * u * (1 - w) + f(x, y - S) * (1 - u) * w + f(x - S, y - S) * u * w;
      const a = sstep(0.06, 0.36, v);
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * 235;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Renderer {
  constructor(canvas, tiles) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.r.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.06, 1500);
    this.camera.rotation.order = 'YXZ';
    this.fov = 75;
    this.time = 0;
    this.day = 1;

    // --- массив текстур блоков ---
    const tex = new THREE.DataArrayTexture(tiles.data, TS, TS, tiles.count);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.tex = tex;

    this.uniforms = {
      uTex: { value: tex },
      uDay: { value: 1 },
      uSkyTint: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color(0.7, 0.85, 1) },
      uFogNear: { value: 60 },
      uFogFar: { value: 110 },
      uTime: { value: 0 },
    };
    const mk = (alphaTest, extra) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uAlphaTest: { value: alphaTest } },
        vertexShader: CHUNK_VS,
        fragmentShader: CHUNK_FS,
        ...extra,
      });
    this.mats = {
      opaque: mk(0.4, {}),
      blend: mk(0.02, { transparent: true, depthWrite: false }),
    };
    // материал для предмета в руке: без тумана и ночного затемнения
    this.handMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uDay: { value: 1 },
        uSkyTint: { value: new THREE.Color(1, 1, 1) },
        uFogColor: { value: new THREE.Color(0, 0, 0) },
        uFogNear: { value: 1e6 },
        uFogFar: { value: 2e6 },
        uTime: { value: 0 },
        uAlphaTest: { value: 0.4 },
      },
      vertexShader: CHUNK_VS,
      fragmentShader: CHUNK_FS,
    });

    // --- небо ---
    this.skyU = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uGlow: { value: new THREE.Color() },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.skyU,
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      sp[i * 3] = r * Math.cos(a) * 850;
      sp[i * 3 + 1] = u * 850;
      sp[i * 3 + 2] = r * Math.sin(a) * 850;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.8,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.stars.renderOrder = -990;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    const body = (tex2, size) => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex2, depthWrite: false, fog: false, transparent: true }),
      );
      s.scale.set(size, size, 1);
      s.renderOrder = -980;
      this.scene.add(s);
      return s;
    };
    this.sun = body(glowTexture('rgba(255,250,225,1)', 'rgba(255,225,150,0.45)', 0.3), 190);
    this.moon = body(glowTexture('rgba(225,232,255,1)', 'rgba(180,195,255,0.22)', 0.34), 120);

    this.cloudU = {
      uMap: { value: cloudTexture() },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.9 },
      uOffset: { value: new THREE.Vector2() },
    };
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.ShaderMaterial({
        uniforms: this.cloudU,
        vertexShader: CLOUD_VS,
        fragmentShader: CLOUD_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 152;
    this.clouds.renderOrder = 2;
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    // --- свет для существ ---
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x77808c, 1.6);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.4);
    this.scene.add(this.hemi, this.dir);

    // --- сцена предмета в руке ---
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.handScene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 2.2));

    this.fogDist = 100;
    this.underwater = 0; // 0 нет, 1 в воде, 2 в лаве
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h;
    this.handCam.updateProjectionMatrix();
  }

  setFov(f) {
    if (Math.abs(this.camera.fov - f) < 0.01) return;
    this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }

  setRenderDist(chunks) {
    this.fogDist = chunks * 16;
  }

  // t — время суток 0..1 (0 рассвет, 0.25 полдень, 0.5 закат, 0.75 полночь).
  setTime(t, elapsed) {
    const ang = t * Math.PI * 2;
    const sunH = Math.sin(ang);
    const sunDir = new THREE.Vector3(Math.cos(ang), sunH, 0.3).normalize();
    const day = sstep(-0.2, 0.25, sunH);
    const dusk = Math.max(0, 1 - Math.abs(sunH) / 0.38) * sstep(-0.3, 0, sunH + 0.15);
    this.day = day;

    const top = this.skyU.uTop.value.setRGB(lerp(0.01, 0.2, day), lerp(0.02, 0.5, day), lerp(0.06, 0.9, day));
    const hor = this.skyU.uHorizon.value.setRGB(lerp(0.04, 0.66, day), lerp(0.06, 0.83, day), lerp(0.14, 0.97, day));
    hor.lerp(new THREE.Color(0.98, 0.56, 0.3), dusk * 0.75);
    top.lerp(new THREE.Color(0.3, 0.25, 0.5), dusk * 0.35);
    this.skyU.uSunDir.value.copy(sunDir);
    this.skyU.uGlow.value.setRGB(1, lerp(0.75, 0.9, day), lerp(0.4, 0.75, day)).multiplyScalar(sstep(-0.25, 0.1, sunH));

    const u = this.uniforms;
    u.uDay.value = lerp(0.36, 1, day);
    u.uSkyTint.value.setRGB(lerp(0.6, 1, day), lerp(0.7, 1, day), 1).lerp(new THREE.Color(1, 0.82, 0.68), dusk * 0.5);
    u.uTime.value = elapsed;
    if (this.underwater === 2) {
      u.uFogColor.value.setRGB(0.95, 0.38, 0.05);
      u.uFogNear.value = 0.2;
      u.uFogFar.value = 4;
    } else if (this.underwater) {
      u.uFogColor.value.setRGB(0.06, 0.2, 0.42).multiplyScalar(lerp(0.35, 1, day));
      u.uFogNear.value = 1;
      u.uFogFar.value = 26;
    } else {
      u.uFogColor.value.copy(hor);
      u.uFogNear.value = this.fogDist * 0.55;
      u.uFogFar.value = this.fogDist - 6;
    }

    const cam = this.camera.position;
    this.sky.position.copy(cam);
    this.stars.position.copy(cam);
    this.stars.rotation.z = ang * 0.5;
    this.stars.material.opacity = (1 - day) * 0.9;
    this.sun.position.copy(cam).addScaledVector(sunDir, 800);
    this.moon.position.copy(cam).addScaledVector(sunDir, -800);
    this.sun.material.opacity = sstep(-0.22, -0.02, sunH);
    this.moon.material.opacity = sstep(-0.22, -0.02, -sunH);

    this.clouds.position.x = cam.x;
    this.clouds.position.z = cam.z;
    this.cloudU.uOffset.value.set(cam.x / 400 + elapsed * 0.004, -cam.z / 400);
    this.cloudU.uColor.value.setRGB(lerp(0.16, 1, day), lerp(0.18, 1, day), lerp(0.26, 1, day)).lerp(new THREE.Color(1, 0.72, 0.55), dusk * 0.6);

    this.hemi.intensity = lerp(0.45, 1.7, day);
    this.dir.intensity = lerp(0.1, 1.5, day);
    this.dir.position.copy(sunH > 0 ? sunDir : sunDir.clone().negate());
  }

  render() {
    this.r.clear();
    this.r.render(this.scene, this.camera);
    this.r.clearDepth();
    this.r.render(this.handScene, this.handCam);
  }
}
