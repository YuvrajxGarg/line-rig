// Your own drawing as a rig. Strokes are drawn over a ghost guide in the
// front view and stored in world units. "Rigging" binds every point to the
// nearest bones (two-bone blend at joints). Face strokes go onto a sphere so
// the head turns in 2.5D, and the eyes and mouth are found so blinks and
// talking from motion capture still work.
import { apply, clamp, euler, mmul, rotY, smoothPath, v3 } from "./math.js";
import { measure, restPose } from "./skeleton.js";

const SEGS = [
  ["torso", "pelvis", "chest"],
  ["neck", "neck", "headBase"],
  ["upperArmL", "shoulderL", "elbowL"], ["foreArmL", "elbowL", "wristL", 0.07],
  ["upperArmR", "shoulderR", "elbowR"], ["foreArmR", "elbowR", "wristR", 0.07],
  ["thighL", "hipL", "kneeL"], ["shinL", "kneeL", "ankleL", 0.08],
  ["thighR", "hipR", "kneeR"], ["shinR", "kneeR", "ankleR", 0.08],
];
const LINKED = new Set(["torso|neck", "torso|upperArmL", "torso|upperArmR", "upperArmL|foreArmL", "upperArmR|foreArmR", "torso|thighL", "torso|thighR", "thighL|shinL", "thighR|shinR"]);
const linked = (a, b) => LINKED.has(`${a}|${b}`) || LINKED.has(`${b}|${a}`);

export function headCenter(joints, R, M = null) {
  const off = M ? apply(M, v3(0, 0.82, -0.06)) : v3(0, 0.82, -0.06);
  return { x: joints.headBase.x + off.x * R, y: joints.headBase.y + off.y * R, z: joints.headBase.z + off.z * R };
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Bind strokes ([{pts:[{x,y}], w}]) to the rest skeleton of spec. */
export function bindDrawing(strokes, spec) {
  const rest = restPose(spec).joints;
  const m = measure(spec);
  const hc = headCenter(rest, m.headR);
  const segs = SEGS.map(([name, a, b, ext]) => {
    const A = rest[a];
    let B = rest[b];
    if (ext) {
      const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy);
      B = { x: B.x + (dx / l) * ext, y: B.y + (dy / l) * ext };
    }
    // bones have thickness: the torso is as wide as the body, limbs as thick as the limb
    const rad = name === "torso" ? null : name === "neck" ? m.headR * 0.2 : name.startsWith("upper") || name.startsWith("fore") ? m.armT * 0.5 : m.legT * 0.5;
    return { name, a, b, A, B, rad };
  });
  const torsoHalf = (y) => {
    const t = clamp((rest.chest.y - y) / (rest.chest.y - rest.pelvis.y), 0, 1);
    return m.shW * (1 - t) + (m.hipW + m.legT * 0.5) * t;
  };
  const capDist = (p, g) => {
    const d = segDist(p, g.A, g.B);
    return Math.max(0, d - (g.rad ?? torsoHalf(p.y) * 0.98));
  };
  const out = strokes.map((s) => {
    const qs = s.pts.map((p) => ({ x: (p.x - hc.x) / m.headR, y: (p.y - hc.y) / m.headR }));
    const inHead = qs.map((q, i) => Math.hypot(q.x, q.y * 0.92) < 1.55 && s.pts[i].y > rest.neck.y + 0.01);
    const headShare = inHead.filter(Boolean).length / s.pts.length;
    if (headShare > 0.6) {
      const rads = qs.map((q) => Math.hypot(q.x, q.y)).sort((a, b) => a - b);
      const med = rads[Math.floor(rads.length / 2)];
      const feature = med < 0.72;
      const c = qs.reduce((a, q) => ({ x: a.x + q.x / qs.length, y: a.y + q.y / qs.length }), { x: 0, y: 0 });
      let part = null;
      if (feature) {
        if (c.y < -0.18 && Math.abs(c.x) < 0.5) part = "mouth";
        else if (c.y > -0.3 && c.y < 0.38 && Math.abs(c.x) > 0.1 && Math.abs(c.x) < 0.8) part = c.x > 0 ? "eyeL" : "eyeR";
      }
      return { ...s, kind: "head", feature, part, q: qs, c, top: Math.max(...qs.map((q) => q.y)) };
    }
    const binds = s.pts.map((p) => {
      const d = segs.map((g) => capDist(p, g));
      const order = d.map((v, i) => i).sort((i, j) => d[i] - d[j]);
      const [i1, i2] = order;
      const g1 = segs[i1], g2 = segs[i2];
      let w1 = 1;
      if (linked(g1.name, g2.name)) {
        const a = 1 / (d[i1] + 0.01) ** 3, b = 1 / (d[i2] + 0.01) ** 3;
        w1 = a / (a + b);
      }
      const local = (g) => {
        const ux = g.B.x - g.A.x, uy = g.B.y - g.A.y;
        const L = Math.hypot(ux, uy);
        const nx = ux / L, ny = uy / L;
        const rx = p.x - g.A.x, ry = p.y - g.A.y;
        return { along: rx * nx + ry * ny, perp: rx * -ny + ry * nx, L };
      };
      return [{ seg: g1, w: w1, ...local(g1) }, ...(w1 < 0.999 ? [{ seg: g2, w: 1 - w1, ...local(g2) }] : [])];
    });
    return { ...s, kind: "body", binds };
  });
  return { strokes: out, specRef: spec };
}

/** Draw a bound drawing in a pose. */
export function drawRigged(ctx, rig, pose, opts) {
  const { ox, oy, k, ink, weight = 2.4 } = opts;
  const spec = rig.specRef;
  const m = measure(spec);
  const V = rotY(opts.viewYaw ?? 0);
  const J = Object.fromEntries(Object.entries(pose.joints).map(([n, p]) => [n, apply(V, p)]));
  const proj = (p) => [ox + p.x * k, oy - p.y * k];
  const lw = Math.max(1, weight * (k / 330));
  const yaw = clamp(pose.head.yaw, -0.85, 0.85), pitch = clamp(pose.head.pitch, -0.5, 0.5), roll = pose.head.roll;
  const Hm = mmul(V, euler(yaw, pitch, roll));
  const hc = headCenter(J, m.headR, Hm);
  const hcp = proj(hc);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  const segNow = Object.fromEntries(
    SEGS.map(([name, a, b, ext]) => {
      const A = J[a];
      let B = J[b];
      if (ext) {
        const d = { x: B.x - A.x, y: B.y - A.y, z: B.z - A.z };
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        B = { x: B.x + (d.x / l) * ext, y: B.y + (d.y / l) * ext, z: B.z };
      }
      return [name, { A, B }];
    }),
  );

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  for (const s of rig.strokes) {
    ctx.lineWidth = lw * (s.w ?? 1);
    if (s.kind === "body") {
      const pts = s.binds.map((bs) => {
        let x = 0, y = 0;
        for (const b of bs) {
          const now = segNow[b.seg.name];
          const ux = now.B.x - now.A.x, uy = now.B.y - now.A.y;
          const L2 = Math.hypot(ux, uy) || 1e-6;
          const nx = ux / L2, ny = uy / L2;
          // keep the rest length scale along the 3D bone, so depth shows as foreshortening
          const L3 = Math.hypot(ux, uy, now.B.z - now.A.z) || 1e-6;
          const along = b.along * (L2 / L3) * (L3 / b.L);
          x += b.w * (now.A.x + nx * along - ny * b.perp);
          y += b.w * (now.A.y + ny * along + nx * b.perp);
        }
        return proj({ x, y });
      });
      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.stroke();
      continue;
    }
    // head strokes
    let q = s.q;
    if (s.part === "eyeL" || s.part === "eyeR") {
      const blink = s.part === "eyeL" ? pose.face.blinkL : pose.face.blinkR;
      const cy = q.reduce((a, p) => a + p.y, 0) / q.length;
      q = q.map((p) => ({ x: p.x, y: cy + (p.y - cy) * (1 - 0.92 * clamp(blink, 0, 1)) }));
    } else if (s.part === "mouth") {
      const j = pose.face.jaw;
      q = q.map((p) => ({ x: p.x * (1 - 0.08 * j), y: s.top + (p.y - s.top) * (1 + 2.4 * j) - 0.04 * j }));
    }
    const segs = [];
    let cur = [];
    for (const p of q) {
      let sp;
      let vis = true;
      if (s.feature) {
        const r2 = p.x * p.x + p.y * p.y;
        const z = Math.sqrt(Math.max(0, 1 - Math.min(r2, 0.97)));
        const w = apply(Hm, { x: p.x, y: p.y, z });
        vis = w.z > 0.06;
        sp = [hcp[0] + w.x * m.headR * k, hcp[1] - w.y * m.headR * k];
      } else {
        const x = p.x * (1 - 0.1 * Math.abs(Math.sin(yaw))) + Math.sin(yaw) * 0.1;
        const y = p.y - Math.sin(pitch) * 0.08;
        sp = [hcp[0] + (x * cr - y * sr) * m.headR * k, hcp[1] - (x * sr + y * cr) * m.headR * k];
      }
      if (vis) cur.push(sp);
      else if (cur.length) { segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    for (const sg of segs) {
      ctx.beginPath();
      if (sg.length === 1) { ctx.arc(sg[0][0], sg[0][1], ctx.lineWidth * 0.5, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill(); continue; }
      smoothPath(ctx, sg);
      ctx.stroke();
    }
  }
  ctx.restore();
  return { headScreen: hcp, headR: m.headR * k };
}

/** Estimate a clean spec from a drawing's proportions. */
export function fitSpec(rig, base) {
  const spec = rig.specRef;
  const m = measure(spec);
  const rest = restPose(spec).joints;
  const shape = { ...base.shape };
  const head = rig.strokes.filter((s) => s.kind === "head" && !s.feature);
  if (head.length) {
    const xs = head.flatMap((s) => s.q.map((q) => q.x)), ys = head.flatMap((s) => s.q.map((q) => q.y));
    const halfW = ((Math.max(...xs) - Math.min(...xs)) / 2) * m.headR;
    shape.headSize = halfW / 0.118 / 0.95;
    var lowest = Math.min(...ys), highest = Math.max(...ys);
  }
  const bodyPts = (names) => rig.strokes.filter((s) => s.kind === "body").flatMap((s) => s.binds.filter((b) => names.includes(b[0].seg.name)).map((b) => b[0]));
  const torso = rig.strokes.filter((s) => s.kind === "body").flatMap((s) => s.pts.filter((p, i) => s.binds[i][0].seg.name === "torso"));
  if (torso.length > 4) {
    const span = rest.chest.y - rest.pelvis.y;
    const upper = torso.filter((p) => p.y > rest.chest.y - span * 0.3).map((p) => Math.abs(p.x));
    const lower = torso.filter((p) => p.y < rest.pelvis.y + span * 0.25).map((p) => Math.abs(p.x));
    if (upper.length) shape.shoulders = (Math.max(...upper) - 0.026) / 0.165;
    if (lower.length) shape.hips = (Math.max(...lower) - 0.04) / 0.085;
  }
  const limbs = bodyPts(["upperArmL", "upperArmR", "foreArmL", "foreArmR", "thighL", "thighR", "shinL", "shinR"]).map((b) => Math.abs(b.perp)).sort((a, b) => a - b);
  if (limbs.length > 6) shape.limbs = (limbs[Math.floor(limbs.length * 0.6)] * 2) / 0.062;
  const out = { ...base, shape, name: base.name };
  if (head.length && lowest < -1.6) out.hair = "long";
  else if (head.length && highest > 1.45 && base.hair === "bald") out.hair = "spiky";
  return out;
}
