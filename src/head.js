// The head: a hand-shaped radial surface (skull, jaw, chin, brow and nose) with
// hair, beards and caps as shells over regions of it. Everything is sampled in
// (lon, lat) on the head, turned in 3D and projected, so the same spec gives a
// true front view, three-quarter, profile and back view, with the nose and
// chin showing in the silhouette as the head turns.
import { apply, clamp, convexHull, smooth, smoothPath } from "./math.js";

const PI = Math.PI;
const HEADS = {
  round: { a: 0.95, b: 1.04, c: 1.0, n: 2, taper: 0.14, back: 1.06 },
  oval: { a: 0.86, b: 1.13, c: 0.98, n: 2, taper: 0.24, back: 1.06 },
  square: { a: 0.97, b: 1.02, c: 1.0, n: 2.8, taper: 0.06, back: 1.04 },
  bean: { a: 0.9, b: 1.0, c: 1.04, n: 2.1, taper: 0.2, back: 1.16 },
};
const NOSES = {
  button: { len: 0.1, tip: -0.17, sx: 0.12, sy: 0.12, bridge: 0.2 },
  long: { len: 0.17, tip: -0.18, sx: 0.09, sy: 0.17, bridge: 0.45 },
  pointy: { len: 0.21, tip: -0.15, sx: 0.07, sy: 0.12, bridge: 0.35 },
  none: { len: 0.035, tip: -0.15, sx: 0.12, sy: 0.12, bridge: 0 },
};

const dirOf = (lon, lat) => {
  const c = Math.cos(lat);
  return { x: c * Math.sin(lon), y: Math.sin(lat), z: c * Math.cos(lon) };
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bump = (dl, dlat, sx, sy) => Math.exp(-((dl / sx) ** 2) - (dlat / sy) ** 2);

/** Cosine-blended hairline: front value F, side S, back B. */
const line3 = (F, S, B, s0, s1, ear = true) => (lon) => {
  const t = Math.abs(wrap(lon));
  const notch = ear && S > -0.2 ? -0.2 * Math.exp(-(((t - 1.22) / 0.1) ** 2)) + 0.14 * Math.exp(-(((t - 1.62) / 0.16) ** 2)) : 0;
  return base3(F, S, B, s0, s1, t) + notch;
};
const base3 = (F, S, B, s0, s1, t) => {
  if (t < s0) return F;
  if (t < s1) return F + (S - F) * smooth((t - s0) / (s1 - s0));
  return S + (B - S) * smooth((t - s1) / (PI - s1));
};

function hairStyle(style) {
  switch (style) {
    case "bald": return null;
    case "buzz": { const h = line3(0.5, 0.16, -0.38, 0.6, 1.45); return { field: (lon, lat) => lat - h(lon), th: () => 0.035, ears: true }; }
    case "short": { const h = line3(0.4, 0.14, -0.42, 0.55, 1.45); return { field: (lon, lat) => lat - h(lon) + 0.035 * Math.sin(lon * 9) * (Math.abs(lon) < 0.7), th: (lon, lat) => 0.1 + 0.03 * smooth(clamp(lat, 0, 1)), ears: true, fringe: 3 }; }
    case "spiky": { const h = line3(0.44, 0.18, -0.34, 0.6, 1.45); return { field: (lon, lat) => lat - h(lon), th: (lon, lat) => 0.07 + 0.22 * Math.pow(Math.max(0, Math.cos(lon * 6.5) * Math.cos((lat - 0.9) * 7)), 3) * smooth(clamp((lat - 0.25) * 2, 0, 1)), ears: true }; }
    case "curly": { const h = line3(0.42, 0.04, -0.48, 0.55, 1.4); return { field: (lon, lat) => lat - h(lon) + 0.05 * Math.sin(lon * 13), th: (lon, lat) => 0.17 + 0.05 * Math.sin(lon * 11) * Math.sin(lat * 11), ears: true }; }
    case "bob": { const h = line3(0.36, -0.55, -0.6, 0.5, 1.02); return { field: (lon, lat) => lat - h(lon), th: (lon, lat) => 0.15 + 0.12 * smooth(clamp(-lat, 0, 1)), ears: false, fringe: 4 }; }
    case "long": { const h = line3(0.38, -0.4, -0.55, 0.5, 1.02); return { field: (lon, lat) => lat - h(lon), th: () => 0.12, ears: false, fringe: 2, sheet: true }; }
    case "bun": { const h = line3(0.44, 0.16, -0.4, 0.6, 1.45); return { field: (lon, lat) => lat - h(lon), th: () => 0.05, ears: true, bun: true }; }
    case "ponytail": { const h = line3(0.44, 0.16, -0.4, 0.6, 1.45); return { field: (lon, lat) => lat - h(lon), th: () => 0.05, ears: true, tail: true }; }
    case "mohawk": return { field: (lon, lat) => { const d = dirOf(lon, lat); return Math.min(0.2 - Math.abs(d.x), d.y + 0.3 - 0.25 * (d.z > 0)); }, th: (lon, lat) => 0.12 + 0.28 * smooth(clamp(Math.sin(lat) + 0.1, 0, 1)), ears: true };
    default: return null;
  }
}

export function headModel(spec) {
  const H = HEADS[spec.head] ?? HEADS.round;
  const N = NOSES[spec.nose] ?? NOSES.button;
  const r = (u) => {
    const low = smooth(clamp(-u.y, 0, 1));
    const a = H.a * (1 - H.taper * low);
    const c = u.z < 0 ? H.c * H.back : H.c * (1 - 0.1 * low);
    const base = Math.pow(Math.abs(u.x / a) ** H.n + Math.abs(u.y / H.b) ** H.n + Math.abs(u.z / c) ** H.n, -1 / H.n);
    if (u.z <= 0) return base;
    const lon = Math.atan2(u.x, u.z), lat = Math.asin(clamp(u.y, -1, 1));
    return (
      base +
      N.len * bump(lon, lat - N.tip, N.sx, N.sy) +
      N.len * N.bridge * bump(lon, lat - 0.02, N.sx * 0.8, 0.16) +
      0.05 * bump(lon, lat + 0.78, 0.4, 0.2) +
      0.025 * bump(lon, lat - 0.24, 0.75, 0.1)
    );
  };
  const S = (lon, lat, shell = 0) => {
    const d = dirOf(lon, lat);
    const k = r(d) * (1 + shell);
    return { x: d.x * k, y: d.y * k, z: d.z * k };
  };
  const hair = hairStyle(spec.hair);
  const ex = new Set(spec.extras);
  const regions = [];
  if (hair) regions.push({ kind: "hair", field: hair.field, th: hair.th, color: "hair" });
  if (ex.has("beard")) regions.push({ kind: "beard", field: (lon, lat) => -0.6 + 0.62 * smooth(clamp(Math.abs(lon) / 1.45, 0, 1)) - lat + (Math.abs(lon) > 1.6 ? -9 : 0), th: () => 0.06, color: "hair" });
  if (ex.has("cap")) {
    const t0 = hair ? 0.04 : 0;
    regions.push({ kind: "cap", field: (lon, lat) => lat - 0.3, th: (lon, lat) => (hair ? Math.max(0.12, hair.th(lon, lat) + 0.05) : 0.1) + t0, color: "accent", cap: true });
  }
  return { r, S, hair, regions, ears: (hair ? hair.ears : true) && !ex.has("headphones"), ex };
}

// ── Rendering ─────────────────────────────────────────────────────────────

const NLON = 72, NLAT = 44;
const LAT0 = -PI / 2 + 0.12, LAT1 = PI / 2 - 0.02;
const lonAt = (i) => -PI + (2 * PI * i) / NLON;
const latAt = (j) => LAT0 + ((LAT1 - LAT0) * j) / NLAT;

/**
 * Returns draw items for the head: [{ z, draw(ctx) }].
 * h = { model, spec, C (view-space head centre, world units), M (view·head rotation), R (world head radius),
 *       proj(p) → [sx, sy], st (style), face }
 */
export function headItems(h) {
  const { model, M, R, C, proj, st, face } = h;
  const world = (p) => {
    const q = apply(M, p);
    return { x: C.x + q.x * R, y: C.y + q.y * R, z: C.z + q.z * R };
  };
  const P = (p) => proj(world(p));
  const facing = (p) => apply(M, p).z; // >0 faces the viewer (for unit-ish normals)
  const items = [];
  const fills = st.fills;

  // Shell point for a region at (lon, lat)
  const shellAt = (reg, lon, lat) => model.S(lon, lat, reg ? reg.th(lon, lat) : 0);

  // Silhouette: polar maximum of everything on the head and its shells.
  const center = proj(C);
  const BINS = 96;
  const maxR = new Float32Array(BINS).fill(-1);
  const addSil = (p) => {
    const s = P(p);
    const dx = s[0] - center[0], dy = s[1] - center[1];
    const a = Math.atan2(dy, dx);
    const b = Math.floor(((a + PI) / (2 * PI)) * BINS) % BINS;
    const d = Math.hypot(dx, dy);
    if (d > maxR[b]) maxR[b] = d;
  };

  // grid of points per surface
  const grid = (fn) => {
    const g = [];
    for (let j = 0; j <= NLAT; j++) {
      const row = [];
      for (let i = 0; i <= NLON; i++) row.push(fn(lonAt(i), latAt(j)));
      g.push(row);
    }
    return g;
  };
  const headG = grid((lon, lat) => model.S(lon, lat));
  for (const row of headG) for (const p of row) addSil(p);

  const regionData = model.regions.map((reg) => {
    const vals = grid((lon, lat) => reg.field(lon, lat));
    const pts = grid((lon, lat) => shellAt(reg, lon, lat));
    for (let j = 0; j <= NLAT; j++) for (let i = 0; i <= NLON; i++) if (vals[j][i] > 0) addSil(pts[j][i]);
    return { reg, vals, pts };
  });

  // fill one surface with front-facing cells (clipped to a region field)
  const fillSurface = (ctx, fn, field, color) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let j = 0; j < NLAT; j++) {
      for (let i = 0; i < NLON; i++) {
        const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const ll = corners.map(([a, b]) => [lonAt(a), latAt(b)]);
        let poly;
        if (field) {
          const f = ll.map(([lo, la]) => field(lo, la));
          if (f.every((v) => v <= 0)) continue;
          if (f.every((v) => v > 0)) poly = ll;
          else {
            poly = [];
            for (let k = 0; k < 4; k++) {
              const k2 = (k + 1) % 4;
              if (f[k] > 0) poly.push(ll[k]);
              if (f[k] > 0 !== f[k2] > 0) {
                const t = f[k] / (f[k] - f[k2]);
                poly.push([ll[k][0] + (ll[k2][0] - ll[k][0]) * t, ll[k][1] + (ll[k2][1] - ll[k][1]) * t]);
              }
            }
          }
        } else poly = ll;
        const s = poly.map(([lo, la]) => P(fn(lo, la)));
        let area = 0;
        for (let k = 0; k < s.length; k++) {
          const a = s[k], b = s[(k + 1) % s.length];
          area += a[0] * b[1] - b[0] * a[1];
        }
        if (area >= -1e-6) continue; // back-facing
        ctx.moveTo(s[0][0], s[0][1]);
        for (let k = 1; k < s.length; k++) ctx.lineTo(s[k][0], s[k][1]);
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.stroke();
  };

  // polyline in (lon,lat) on a surface fn, broken where it faces away
  const surfLine = (ctx, ll, fn, { width = st.lw, min = 0.0 } = {}) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (const [lo, la] of ll) {
      const p = fn(lo, la);
      const n = dirOf(lo, la);
      if (facing(n) > min) {
        const s = P(p);
        if (pen) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  };
  const surfFill = (ctx, ll, fn, color) => {
    const c = ll.reduce((a, [lo, la]) => [a[0] + lo / ll.length, a[1] + la / ll.length], [0, 0]);
    if (facing(dirOf(c[0], c[1])) <= 0.05) return;
    const pts = ll.map(([lo, la]) => P(fn(lo, la)));
    ctx.fillStyle = color;
    ctx.beginPath();
    smoothPath(ctx, pts, true);
    ctx.fill();
  };
  const arc = (lo0, lo1, la, bend = 0, n = 14) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return [lo0 + (lo1 - lo0) * t, la + bend * (1 - (2 * t - 1) ** 2)];
    });
  const ellipse = (lo, la, rx, ry, n = 20) => Array.from({ length: n }, (_, i) => [lo + rx * Math.cos((i / n) * 2 * PI), la + ry * Math.sin((i / n) * 2 * PI)]);
  const face0 = (lo, la) => model.S(lo, la);

  // ── back layer: long hair sheet, far ear, far cup, bun/tail behind ──
  const hs = model.hair;
  const ink = st.ink;
  const col = (k) => (fills ? st.colors[k] : st.paper);

  if (hs?.sheet) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const lon = (i / 28) * 2 * PI - PI;
      if (Math.abs(lon) < 1.0) continue;
      const rr = 1.08 + hs.th(lon, 0);
      for (const y of [0.2, -0.4, -1.0, -1.6, -2.15]) {
        const flare = 1 + 0.12 * clamp(-y / 2, 0, 1);
        pts.push(P({ x: Math.sin(lon) * rr * flare, y: y - 0.1 * Math.cos(lon * 2) * (y < -2), z: Math.cos(lon) * rr * flare - 0.05 }));
      }
    }
    const regH = regionData.find((d) => d.reg.kind === "hair");
    for (let j = 0; j <= NLAT; j += 2) for (let i = 0; i <= NLON; i += 2) if (regH.vals[j][i] > 0) pts.push(P(regH.pts[j][i]));
    const hull = convexHull(pts);
    items.push({
      z: C.z - R * 3,
      draw(ctx) {
        ctx.beginPath();
        smoothPath(ctx, hull, true, 0.35);
        ctx.fillStyle = col("hair");
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = st.lw;
        ctx.stroke();
      },
    });
  }

  // ears
  const earItems = [];
  if (model.ears) {
    for (const s of [1, -1]) {
      const lonB = s * 1.5;
      const pts = [], inner = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const la = 0.12 - 0.5 * t;
        const base = model.S(lonB, la);
        const out = 0.17 * Math.pow(Math.sin(PI * t), 0.6);
        const p = { x: base.x + s * out, y: base.y, z: base.z - out * 0.35 };
        pts.push(p);
        if (t > 0.25 && t < 0.75) inner.push({ x: base.x + s * out * 0.45, y: base.y, z: base.z - out * 0.2 });
      }
      const ctr = apply(M, { x: s, y: -0.12, z: 0 });
      earItems.push({
        near: ctr.z > 0.25,
        draw(ctx) {
          const sp = pts.map(P);
          ctx.beginPath();
          smoothPath(ctx, sp);
          ctx.closePath();
          ctx.fillStyle = col("skin");
          ctx.fill();
          ctx.strokeStyle = ink;
          ctx.lineWidth = st.lw;
          ctx.stroke();
          if (ctr.z > 0.25) {
            ctx.beginPath();
            smoothPath(ctx, inner.map(P));
            ctx.lineWidth = st.lw * 0.75;
            ctx.stroke();
          }
        },
      });
    }
  }

  // headphones cups
  const cupItems = [];
  if (model.ex.has("headphones")) {
    for (const s of [1, -1]) {
      const ring = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * 2 * PI;
        return { x: s * 1.08, y: -0.08 + 0.36 * Math.sin(a), z: 0.36 * Math.cos(a) };
      });
      const ring2 = ring.map((p) => ({ x: s * 1.22, y: -0.08 + (p.y + 0.08) * 0.85, z: p.z * 0.85 }));
      const ctr = apply(M, { x: s, y: 0, z: 0 });
      cupItems.push({
        near: ctr.z > -0.05,
        draw(ctx) {
          const a = convexHull([...ring, ...ring2].map(P));
          ctx.beginPath();
          smoothPath(ctx, a, true, 0.3);
          ctx.fillStyle = col("accent");
          ctx.fill();
          ctx.strokeStyle = ink;
          ctx.lineWidth = st.lw;
          ctx.stroke();
        },
      });
    }
  }

  // bun / ponytail
  const bunItems = [];
  if (hs?.bun) {
    const c = { x: 0, y: 1.0, z: -0.42 };
    const z = apply(M, c).z;
    bunItems.push({
      near: z > 0.3,
      draw(ctx) {
        const s = P(c);
        const rad = 0.4 * R * h.k;
        ctx.beginPath();
        ctx.arc(s[0], s[1], rad, 0, 2 * PI);
        ctx.fillStyle = col("hair");
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = st.lw;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s[0], s[1], rad * 0.55, 0.6, 2.4);
        ctx.lineWidth = st.lw * 0.7;
        ctx.stroke();
      },
    });
  }
  if (hs?.tail) {
    const path = [{ x: 0, y: 0.3, z: -1.08 }, { x: 0, y: -0.15, z: -1.32 }, { x: 0, y: -0.9, z: -1.3 }, { x: 0, y: -1.6, z: -1.12 }];
    bunItems.push({
      near: apply(M, { x: 0, y: 0, z: -1 }).z > 0.3,
      draw(ctx) {
        const s = path.map(P);
        tube(ctx, s, 0.36 * R * h.k, col("hair"), ink, st.lw, true);
        const t = P({ x: 0, y: 0.3, z: -1.1 });
        ctx.beginPath();
        ctx.arc(t[0], t[1], 0.12 * R * h.k, 0, 2 * PI);
        ctx.fillStyle = col("accent");
        ctx.fill();
        ctx.lineWidth = st.lw;
        ctx.stroke();
      },
    });
  }

  for (const it of [...earItems, ...cupItems, ...bunItems]) if (!it.near) items.push({ z: C.z - R * 0.9, draw: it.draw });

  // ── main head ──
  items.push({
    z: C.z + R * 0.2,
    draw(ctx) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      fillSurface(ctx, model.S, null, col("skin"));
      for (const d of regionData) fillSurface(ctx, (lo, la) => shellAt(d.reg, lo, la), d.reg.field, col(d.reg.color));

      // cap brim (in front of the face)
      if (model.ex.has("cap")) {
        const capReg = model.regions.find((x) => x.cap);
        const base = [], outer = [];
        for (let i = 0; i <= 18; i++) {
          const lo = -1.15 + (2.3 * i) / 18;
          const b = shellAt(capReg, lo, 0.3);
          base.push(b);
          outer.push({ x: b.x * 1.05, y: b.y - 0.06, z: b.z + 0.5 * Math.cos(lo * 1.1) });
        }
        const fwd = apply(M, { x: 0, y: 0, z: 1 }).z;
        const poly = [...outer, ...base.reverse()].map(P);
        ctx.beginPath();
        smoothPath(ctx, poly, true, 0.2);
        ctx.fillStyle = col("accent");
        if (fwd > -0.35) ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = st.lw;
        if (fwd > -0.35) ctx.stroke();
      }

      // silhouette
      const pts = [];
      for (let b = 0; b < BINS; b++) {
        let d = maxR[b];
        if (d < 0) {
          let l = b, rr = b;
          while (maxR[(l + BINS) % BINS] < 0 && l > b - BINS) l--;
          while (maxR[rr % BINS] < 0 && rr < b + BINS) rr++;
          d = (maxR[(l + BINS) % BINS] + maxR[rr % BINS]) / 2;
        }
        pts.push(d);
      }
      const at = (arr, b) => arr[(b + BINS) % BINS];
      const dil = pts.map((d, b) => Math.max(at(pts, b - 1), d, at(pts, b + 1)));
      const sm = dil.map((d, b) => (at(dil, b - 1) + d * 2 + at(dil, b + 1)) / 4);
      const outline = sm.map((d, b) => {
        const a = ((b + 0.5) / BINS) * 2 * PI - PI;
        return [center[0] + Math.cos(a) * d, center[1] + Math.sin(a) * d];
      });
      ctx.strokeStyle = ink;
      ctx.beginPath();
      smoothPath(ctx, outline, true, 0.4);
      ctx.lineWidth = st.lw * 1.1;
      ctx.stroke();

      // region borders (hairline, beard edge, cap edge)
      for (const d of regionData) {
        const fn = (lo, la) => shellAt(d.reg, lo, la);
        ctx.lineWidth = st.lw;
        ctx.beginPath();
        for (let j = 0; j < NLAT; j++) {
          for (let i = 0; i < NLON; i++) {
            const c4 = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
            const f = c4.map(([a, b]) => d.vals[b][a]);
            const cross = [];
            for (let k = 0; k < 4; k++) {
              const k2 = (k + 1) % 4;
              if (f[k] > 0 !== f[k2] > 0) {
                const t = f[k] / (f[k] - f[k2]);
                const lo = lonAt(c4[k][0]) + (lonAt(c4[k2][0]) - lonAt(c4[k][0])) * t;
                const la = latAt(c4[k][1]) + (latAt(c4[k2][1]) - latAt(c4[k][1])) * t;
                cross.push([lo, la]);
              }
            }
            if (cross.length < 2) continue;
            const ok = cross.every(([lo, la]) => facing(dirOf(lo, la)) > 0.02);
            if (!ok) continue;
            const a = P(fn(...cross[0])), b = P(fn(...cross[1]));
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
          }
        }
        ctx.stroke();
        // fringe strands
        if (d.reg.kind === "hair" && hs.fringe) {
          for (let k = 0; k < hs.fringe; k++) {
            const lo = -0.45 + (0.9 * (k + 0.5)) / hs.fringe;
            let la1 = 0.3;
            while (d.reg.field(lo, la1) <= 0 && la1 < 1.2) la1 += 0.02;
            surfLine(ctx, [[lo + 0.12, la1 + 0.32], [lo + 0.05, la1 + 0.16], [lo, la1 + 0.04]], fn, { width: st.lw * 0.8, min: 0.1 });
          }
        }
      }

      drawFace(ctx);
    },
  });

  for (const it of [...earItems, ...cupItems, ...bunItems]) if (it.near) items.push({ z: C.z + R * 0.3, draw: it.draw });

  // headphones band over the top
  if (model.ex.has("headphones")) {
    items.push({
      z: C.z + R * 0.25,
      draw(ctx) {
        const band = Array.from({ length: 21 }, (_, i) => {
          const a = (i / 20) * PI;
          return { x: Math.cos(a) * 1.18, y: -0.05 + Math.sin(a) * 1.3, z: 0.02 };
        });
        tube(ctx, band.map(P), 0.12 * R * h.k, col("accent"), ink, st.lw);
      },
    });
  }

  function drawFace(ctx) {
    const sp = h.spec;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    const eyeLon = 0.37, eyeLat = -0.08;
    const gx = face.gazeX * 0.05, gy = -face.gazeY * 0.04;
    for (const s of [1, -1]) {
      const lo = s * eyeLon;
      const blink = s === 1 ? face.blinkL : face.blinkR;
      const open = 1 - clamp(blink, 0, 1);
      const style = sp.eyes;
      if (style === "happy" || open < 0.2) {
        const bend = style === "happy" && open >= 0.2 ? 0.07 : -0.02;
        surfLine(ctx, arc(lo - 0.1, lo + 0.1, eyeLat - 0.01, bend, 10), face0, { width: st.lw * 1.1 });
      } else if (style === "dot") {
        surfFill(ctx, ellipse(lo + gx * 0.6, eyeLat + gy * 0.6, 0.065, 0.085 * open, 16), face0, ink);
      } else {
        const rx = style === "wide" ? 0.13 : 0.115, ry = (style === "wide" ? 0.12 : 0.085) * open;
        const el = ellipse(lo, eyeLat, rx, ry, 22);
        surfFill(ctx, el, face0, col("skin") === st.paper ? st.paper : "#ffffff");
        const pr = style === "wide" ? 0.06 : 0.05;
        surfFill(ctx, ellipse(lo + gx, eyeLat + gy - (style === "sleepy" ? 0.015 : 0), pr, Math.min(pr, ry * 0.95), 14), face0, ink);
        surfLine(ctx, [...el, el[0]], face0, { width: st.lw });
        if (style === "sleepy") surfLine(ctx, arc(lo - rx * 1.05, lo + rx * 1.05, eyeLat + ry * 0.25, 0.012, 10), face0, { width: st.lw * 1.2 });
      }
      // brows
      if (sp.brows !== "none") {
        const bl = 0.2 + face.brow * 0.05;
        const w = sp.brows === "thick" ? st.lw * 2.4 : st.lw;
        surfLine(ctx, arc(lo - s * 0.08 - 0.06 * s, lo + s * 0.1, bl, 0.025, 10).map(([a, b], i) => [a, b - (s * (a - lo) < 0 ? 0.0 : 0.0) + i * 0]), face0, { width: w });
      }
      if (model.ex.has("freckles")) {
        for (const [dl, dla] of [[-0.06, -0.24], [0.02, -0.27], [0.09, -0.23], [0.04, -0.2]]) surfFill(ctx, ellipse(lo + s * dl, dla, 0.012, 0.012, 8), face0, ink);
      }
    }

    // nose
    const nose = sp.nose;
    if (nose === "button") surfLine(ctx, arc(-0.05, 0.05, -0.215, -0.025, 8), face0);
    else if (nose === "long" || nose === "pointy") {
      const tip = nose === "pointy" ? -0.17 : -0.2;
      surfLine(ctx, [[0.03, 0.0], [0.035, -0.08], [0.03, tip], [0.0, tip - 0.035], [-0.05, tip - 0.03]], face0);
    }

    // mouth
    const mouthLat = -0.43;
    const w = sp.mouth === "small" ? 0.09 : sp.mouth === "flat" ? 0.15 : 0.17;
    const smile = (sp.mouth === "smile" ? 0.6 : sp.mouth === "flat" ? 0 : 0.25) + face.smile * 0.6;
    const corner = 0.055 * smile;
    const upper = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12 * 2 - 1;
      return [t * w, mouthLat + corner * t * t - 0.01 * smile];
    });
    if (face.jaw > 0.08) {
      const drop = 0.03 + face.jaw * 0.16;
      const lower = upper.slice().reverse().map(([lo, la]) => [lo * (1 - 0.15 * face.jaw), la - drop * (1 - (lo / w) ** 2)]);
      surfFill(ctx, [...upper, ...lower], face0, ink);
    } else {
      surfLine(ctx, upper, face0, { width: st.lw * 1.05 });
    }
    if (model.ex.has("moustache")) {
      for (const s of [1, -1]) surfLine(ctx, arc(0, s * 0.19, -0.33, 0.03, 8).map(([a, b], i) => [a, b - 0.004 * i * i * 0.1]), face0, { width: st.lw * 2.4 });
    }
    if (model.ex.has("glasses")) {
      const g = (lo, la) => model.S(lo, la, 0.05);
      for (const s of [1, -1]) {
        const el = ellipse(s * eyeLon, eyeLat, 0.17, 0.14, 26);
        surfLine(ctx, [...el, el[0]], g, { width: st.lw * 1.15 });
        surfLine(ctx, arc(s * (eyeLon + 0.17), s * 1.45, eyeLat + 0.02, 0, 10), g, { width: st.lw });
      }
      surfLine(ctx, arc(-eyeLon + 0.17, eyeLon - 0.17, eyeLat + 0.03, 0.03, 8), g, { width: st.lw });
    }
  }

  return items;
}

/** Outlined tube along a polyline: ink stroke, then a fill stroke inside. */
export function tube(ctx, pts, width, fill, ink, lw, rounded = true, butt = false) {
  if (pts.length < 2) return;
  ctx.lineJoin = "round";
  ctx.lineCap = butt ? "butt" : "round";
  ctx.beginPath();
  if (rounded && pts.length > 2) smoothPath(ctx, pts);
  else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = width + lw;
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(0.5, width - lw);
  ctx.stroke();
}
