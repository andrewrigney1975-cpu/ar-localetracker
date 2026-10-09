// Constant-velocity Kalman filter with Rauch–Tung–Striebel smoothing, applied
// independently to each axis of locally projected coordinates.

/**
 * Smooth one axis.
 * @param {ArrayLike<number>} t  times in seconds
 * @param {ArrayLike<number>} z  measured positions (m)
 * @param {ArrayLike<number>} r  measurement std-dev per sample (m)
 * @param {number} q  process noise (acceleration variance, (m/s²)²)
 * @returns {Float64Array} smoothed positions
 */
export function smoothAxis(t, z, r, q) {
  const n = z.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (n === 1) {
    out[0] = z[0];
    return out;
  }
  // Filtered state/covariance, and predicted state/covariance for step k (prior to update k).
  const xf = new Float64Array(n * 2);
  const pf = new Float64Array(n * 4);
  const xp = new Float64Array(n * 2);
  const pp = new Float64Array(n * 4);

  let x0 = z[0];
  let v0 = 0;
  let p00 = r[0] * r[0];
  let p01 = 0;
  let p10 = 0;
  let p11 = 25;

  for (let k = 0; k < n; k++) {
    if (k > 0) {
      const dt = Math.max(1e-3, t[k] - t[k - 1]);
      // Predict: x = F x, P = F P F' + Q
      const nx = x0 + v0 * dt;
      const nv = v0;
      const a00 = p00 + dt * (p10 + p01) + dt * dt * p11;
      const a01 = p01 + dt * p11;
      const a10 = p10 + dt * p11;
      const a11 = p11;
      const dt2 = dt * dt;
      x0 = nx;
      v0 = nv;
      p00 = a00 + q * dt2 * dt / 3;
      p01 = a01 + q * dt2 / 2;
      p10 = a10 + q * dt2 / 2;
      p11 = a11 + q * dt;
    }
    xp[2 * k] = x0;
    xp[2 * k + 1] = v0;
    pp[4 * k] = p00;
    pp[4 * k + 1] = p01;
    pp[4 * k + 2] = p10;
    pp[4 * k + 3] = p11;

    // Update with position measurement.
    const R = r[k] * r[k];
    const s = p00 + R;
    const k0 = p00 / s;
    const k1 = p10 / s;
    const y = z[k] - x0;
    x0 += k0 * y;
    v0 += k1 * y;
    const n00 = (1 - k0) * p00;
    const n01 = (1 - k0) * p01;
    const n10 = p10 - k1 * p00;
    const n11 = p11 - k1 * p01;
    p00 = n00;
    p01 = n01;
    p10 = n10;
    p11 = n11;

    xf[2 * k] = x0;
    xf[2 * k + 1] = v0;
    pf[4 * k] = p00;
    pf[4 * k + 1] = p01;
    pf[4 * k + 2] = p10;
    pf[4 * k + 3] = p11;
  }

  // RTS backward pass.
  let sx = xf[2 * (n - 1)];
  let sv = xf[2 * (n - 1) + 1];
  out[n - 1] = sx;
  for (let k = n - 2; k >= 0; k--) {
    const dt = Math.max(1e-3, t[k + 1] - t[k]);
    const f00 = pf[4 * k], f01 = pf[4 * k + 1], f10 = pf[4 * k + 2], f11 = pf[4 * k + 3];
    // P_f F'
    const m00 = f00 + f01 * dt;
    const m01 = f01;
    const m10 = f10 + f11 * dt;
    const m11 = f11;
    // inverse of predicted covariance at k+1
    const q00 = pp[4 * (k + 1)], q01 = pp[4 * (k + 1) + 1], q10 = pp[4 * (k + 1) + 2], q11 = pp[4 * (k + 1) + 3];
    const det = q00 * q11 - q01 * q10;
    if (Math.abs(det) < 1e-12) {
      sx = xf[2 * k];
      sv = xf[2 * k + 1];
      out[k] = sx;
      continue;
    }
    const i00 = q11 / det, i01 = -q01 / det, i10 = -q10 / det, i11 = q00 / det;
    const c00 = m00 * i00 + m01 * i10;
    const c01 = m00 * i01 + m01 * i11;
    const c10 = m10 * i00 + m11 * i10;
    const c11 = m10 * i01 + m11 * i11;
    const dx = sx - xp[2 * (k + 1)];
    const dv = sv - xp[2 * (k + 1) + 1];
    sx = xf[2 * k] + c00 * dx + c01 * dv;
    sv = xf[2 * k + 1] + c10 * dx + c11 * dv;
    out[k] = sx;
  }
  return out;
}
