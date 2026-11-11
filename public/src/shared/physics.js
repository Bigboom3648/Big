// Движение прямоугольного тела (AABB) по воксельному миру.
// p — позиция центра основания, v — скорость; у обоих поля x, y, z.
const EPS = 1e-3;

function solidInBox(isSolid, x0, x1, y0, y1, z0, z1) {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

export function boxBlocked(isSolid, x, y, z, hw, h) {
  return solidInBox(
    isSolid,
    Math.floor(x - hw),
    Math.ceil(x + hw) - 1,
    Math.floor(y),
    Math.ceil(y + h) - 1,
    Math.floor(z - hw),
    Math.ceil(z + hw) - 1,
  );
}

export function moveBox(isSolid, p, v, hw, h, dt, out) {
  out.onGround = false;
  out.hitX = false;
  out.hitY = false;
  out.hitZ = false;
  const maxD = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxD / 0.4));
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    // --- Y ---
    let d = v.y * sdt;
    if (d !== 0) {
      p.y += d;
      const x0 = Math.floor(p.x - hw);
      const x1 = Math.ceil(p.x + hw) - 1;
      const z0 = Math.floor(p.z - hw);
      const z1 = Math.ceil(p.z + hw) - 1;
      if (d < 0) {
        const cy = Math.floor(p.y);
        if (solidInBox(isSolid, x0, x1, cy, cy, z0, z1)) {
          p.y = cy + 1;
          v.y = 0;
          out.onGround = true;
          out.hitY = true;
        }
      } else {
        const cy = Math.ceil(p.y + h) - 1;
        if (solidInBox(isSolid, x0, x1, cy, cy, z0, z1)) {
          p.y = cy - h - EPS;
          v.y = 0;
          out.hitY = true;
        }
      }
    }
    // --- X ---
    d = v.x * sdt;
    if (d !== 0) {
      p.x += d;
      const y0 = Math.floor(p.y);
      const y1 = Math.ceil(p.y + h) - 1;
      const z0 = Math.floor(p.z - hw);
      const z1 = Math.ceil(p.z + hw) - 1;
      if (d > 0) {
        const cx = Math.ceil(p.x + hw) - 1;
        if (solidInBox(isSolid, cx, cx, y0, y1, z0, z1)) {
          p.x = cx - hw - EPS;
          v.x = 0;
          out.hitX = true;
        }
      } else {
        const cx = Math.floor(p.x - hw);
        if (solidInBox(isSolid, cx, cx, y0, y1, z0, z1)) {
          p.x = cx + 1 + hw + EPS;
          v.x = 0;
          out.hitX = true;
        }
      }
    }
    // --- Z ---
    d = v.z * sdt;
    if (d !== 0) {
      p.z += d;
      const y0 = Math.floor(p.y);
      const y1 = Math.ceil(p.y + h) - 1;
      const x0 = Math.floor(p.x - hw);
      const x1 = Math.ceil(p.x + hw) - 1;
      if (d > 0) {
        const cz = Math.ceil(p.z + hw) - 1;
        if (solidInBox(isSolid, x0, x1, y0, y1, cz, cz)) {
          p.z = cz - hw - EPS;
          v.z = 0;
          out.hitZ = true;
        }
      } else {
        const cz = Math.floor(p.z - hw);
        if (solidInBox(isSolid, x0, x1, y0, y1, cz, cz)) {
          p.z = cz + 1 + hw + EPS;
          v.z = 0;
          out.hitZ = true;
        }
      }
    }
  }
  return out;
}
