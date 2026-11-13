// Draws a character from its spec and a pose, from any view angle.
import { apply, convexHull, cross, euler, lerp3, mul, add, norm, rotY, smoothPath, sub, mmul, dot, v3, deg } from "./math.js";
import { headItems, headModel, tube } from "./head.js";
import { BONES, measure, torsoAxes } from "./skeleton.js";

export const THEMES = {
  paper: { paper: "#f3efe6", ink: "#141414", grid: "rgba(20,20,20,0.06)" },
  night: { paper: "#0c0c0d", ink: "#f2eee6", grid: "rgba(255,255,255,0.05)" },
};

const modelCache = new WeakMap();
export function getModel(spec) {
  let m = modelCache.get(spec);
  if (!m) modelCache.set(spec, (m = headModel(spec)));
  return m;
}

/**
 * opts: { ox, oy, k (px per world unit), viewYaw (rad), theme, fills (bool), weight, bones (bool) }
 */
export function drawCharacter(ctx, spec, pose, opts) {
  const theme = THEMES[opts.theme] ?? THEMES.paper;
  const m = measure(spec);
  const k = opts.k;
  const V = rotY(opts.viewYaw ?? 0);
  const proj = (p) => [opts.ox + p.x * k, opts.oy - p.y * k];
  const J = Object.fromEntries(Object.entries(pose.joints).map(([n, p]) => [n, apply(V, p)]));
  const lw = Math.max(1, (opts.weight ?? 2.4) * (k / 330));
  const fills = !!opts.fills;
  const st = { lw, ink: theme.ink, paper: theme.paper, fills, colors: spec.colors };
  const col = (c) => (fills ? spec.colors[c] : theme.paper);
  const ink = theme.ink;
  const items = [];
  const ax = torsoAxes(J);
  const P = (p) => proj(p);

  // ── torso ──
  const sec = (t, w, d, lift = 0) => {
    const C = lerp3(J.chest, J.pelvis, t);
    const R = norm(lerp3(ax.shAxis, ax.hipAxis, t));
    const F = norm(cross(R, ax.up));
    return { C: add(C, mul(ax.up, lift)), R, F, w, d };
  };
  const sections = [
    sec(0, m.shW + m.armT * 0.45, m.depth * 0.85, m.armT * 0.42),
    sec(0.22, m.shW * 0.95, m.depth),
    sec(0.58, m.waistW, m.depth * 0.86),
    sec(0.86, m.waistW * 0.35 + (m.hipW + m.legT * 0.5) * 0.65, m.depth * 0.9),
    sec(1, m.hipW + m.legT * 0.55, m.depth * 0.95, -m.legT * 0.25),
  ];
  const ring = (s, n = 28) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return add(s.C, add(mul(s.R, s.w * Math.sin(a)), mul(s.F, s.d * Math.cos(a))));
  });
  const hullOf = (secs) => convexHull(secs.flatMap((s) => ring(s).map(P)));
  const surf = (t, a, out = 0) => {
    // point on the torso surface at height t (0 shoulders … 1 hips), angle a (0 = front)
    let i = 0;
    while (i < sections.length - 2 && t > lerpT(i + 1)) i++;
    const t0 = lerpT(i), t1 = lerpT(i + 1);
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const A = sections[i], B = sections[i + 1];
    const C = lerp3(A.C, B.C, u), R = norm(lerp3(A.R, B.R, u)), F = norm(lerp3(A.F, B.F, u));
    const w = A.w + (B.w - A.w) * u, d = A.d + (B.d - A.d) * u;
    const nrm = norm(add(mul(R, Math.sin(a) / w), mul(F, Math.cos(a) / d)));
    return { p: add(C, add(mul(R, (w + out) * Math.sin(a)), mul(F, (d + out) * Math.cos(a)))), vis: nrm.z > 0.05 };
  };
  const T_OF = [0, 0.22, 0.58, 0.86, 1];
  function lerpT(i) { return T_OF[i]; }
  const surfLine = (ctx, list, width = lw) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (const [t, a] of list) {
      const s = surf(t, a, 0.004);
      if (!s.vis) { pen = false; continue; }
      const q = P(s.p);
      if (pen) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      pen = true;
    }
    ctx.stroke();
  };
  const torsoZ = (J.chest.z + J.pelvis.z) / 2;
  const top = spec.top, bottom = spec.bottom;

  items.push({
    z: torsoZ,
    draw(ctx) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = ink;
      // pants / bottom block at the hips
      const low = hullOf(sections.slice(2));
      ctx.beginPath();
      smoothPath(ctx, low, true, 0.15);
      ctx.fillStyle = col(top === "dress" ? "top" : "bottom");
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.stroke();
      // skirt or dress
      if (bottom === "skirt" || top === "dress") {
        const hem = top === "dress" ? 0.38 : 0.3;
        const s0 = sections[2];
        const H = sections[4];
        const down = mul(ax.up, -1);
        const flare = { C: add(H.C, mul(down, hem)), R: H.R, F: H.F, w: H.w * 1.55, d: H.d * 1.6 };
        const pts = convexHull([...ring(s0), ...ring(H), ...ring(flare)].map(P));
        ctx.beginPath();
        smoothPath(ctx, pts, true, 0.12);
        ctx.fillStyle = col(top === "dress" ? "top" : "bottom");
        ctx.fill();
        ctx.stroke();
        // a couple of fold lines
        ctx.lineWidth = lw * 0.8;
        for (const a of [-0.5, 0.45]) {
          const p0 = add(add(H.C, add(mul(H.R, H.w * Math.sin(a)), mul(H.F, H.d * Math.cos(a)))), mul(down, 0.06));
          const p1 = add(flare.C, add(mul(flare.R, flare.w * Math.sin(a * 1.1)), mul(flare.F, flare.d * Math.cos(a * 1.1))));
          if ((Math.sin(a) * H.R.z + Math.cos(a) * H.F.z) > 0.1) {
            const q0 = P(p0), q1 = P(lerp3(p0, p1, 0.92));
            ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
          }
        }
      }
      // top
      const tSecs = top === "dress" ? sections.slice(0, 3) : sections.slice(0, 4);
      const upper = hullOf(tSecs);
      ctx.beginPath();
      smoothPath(ctx, upper, true, 0.15);
      ctx.fillStyle = col("top");
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.stroke();

      // details on the front
      const arcA = (t, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => [t, a0 + ((a1 - a0) * i) / n]);
      if (top === "jacket") {
        surfLine(ctx, Array.from({ length: 12 }, (_, i) => [0.05 + (0.81 * i) / 11, 0.05]));
        surfLine(ctx, [[0.0, -0.55], [0.12, -0.25], [0.3, -0.02]]);
        surfLine(ctx, [[0.0, 0.55], [0.12, 0.3], [0.3, 0.08]]);
        surfLine(ctx, arcA(0.55, -0.9, -0.45, 6), lw * 0.9);
      } else if (top === "shirt") {
        surfLine(ctx, [[0.0, -0.5], [0.08, -0.05], [0.0, 0.0]]);
        surfLine(ctx, [[0.0, 0.5], [0.08, 0.05], [0.0, 0.0]]);
        surfLine(ctx, Array.from({ length: 10 }, (_, i) => [0.09 + (0.77 * i) / 9, 0.0]), lw * 0.8);
      } else if (top === "hoodie") {
        surfLine(ctx, [[0.62, -0.55], [0.6, -0.3], [0.6, 0.3], [0.62, 0.55], [0.82, 0.62], [0.84, -0.62], [0.62, -0.55]]);
        surfLine(ctx, [[0.05, -0.12], [0.18, -0.14], [0.3, -0.12]], lw * 0.8);
        surfLine(ctx, [[0.05, 0.12], [0.18, 0.14], [0.3, 0.12]], lw * 0.8);
      } else if (top === "tee" || top === "tank") {
        surfLine(ctx, arcA(0.04, -0.4, 0.4, 12).map(([t, a]) => [t + 0.06 * Math.cos(a * 3.9), a]));
      } else if (top === "dress") {
        surfLine(ctx, arcA(0.58, -1.5, 1.5, 20));
      }
    },
  });

  // collar / hood ring and scarf
  const ringAround = (C, rx, rz, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return add(C, add(mul(ax.shAxis, rx * Math.sin(a)), mul(ax.shFwd, rz * Math.cos(a))));
  });
  if (top === "hoodie" || spec.extras.includes("scarf")) {
    const scarf = spec.extras.includes("scarf");
    items.push({
      z: torsoZ + 0.04,
      draw(ctx) {
        const C = add(J.neck, mul(ax.up, scarf ? 0.015 : -0.005));
        const r = ringAround(C, m.headR * 0.62, m.headR * 0.55).map(P);
        tube(ctx, r, (scarf ? 0.06 : 0.05) * k, scarf ? col("accent") : col("top"), ink, lw);
        if (scarf) {
          const a = add(add(C, mul(ax.shFwd, m.headR * 0.5)), mul(ax.shAxis, m.headR * 0.25));
          if (ax.shFwd.z > -0.2) tube(ctx, [a, add(a, mul(ax.up, -0.12)), add(add(a, mul(ax.up, -0.22)), mul(ax.shAxis, 0.02))].map(P), 0.055 * k, col("accent"), ink, lw, true);
        }
      },
    });
  }

  // neck
  items.push({
    z: torsoZ - 0.01,
    draw(ctx) {
      tube(ctx, [J.neck, J.headBase].map(P), m.headR * 0.5 * k, col("skin"), ink, lw, false, true);
    },
  });

  // ── limbs ──
  const longSleeve = top === "hoodie" || top === "jacket" || top === "shirt";
  for (const s of ["L", "R"]) {
    const sh = J["shoulder" + s], el = J["elbow" + s], wr = J["wrist" + s];
    const dir = norm(sub(wr, el));
    const hand = add(wr, mul(dir, 0.055));
    const z = (sh.z + el.z + wr.z) / 3 + 0.03 + (wr.z - torsoZ > 0.08 ? 0.05 : 0);
    items.push({
      z,
      draw(ctx) {
        const armW = m.armT * k;
        const handTube = () => tube(ctx, [wr, hand].map(P), armW * 1.3, col("skin"), ink, lw);
        if (longSleeve) {
          handTube();
          tube(ctx, [sh, el, lerp3(el, wr, 0.92)].map(P), armW * 1.12, col("top"), ink, lw);
          cuff(ctx, el, wr, 0.92, armW * 1.12);
        } else {
          tube(ctx, [sh, el, wr].map(P), armW, col("skin"), ink, lw);
          handTube();
          if (top !== "tank" && top !== "dress") {
            tube(ctx, [sh, lerp3(sh, el, 0.45)].map(P), armW * 1.32, col("top"), ink, lw, false);
            cuff(ctx, sh, el, 0.45, armW * 1.32);
          }
        }
      },
    });
    const hp = J["hip" + s], kn = J["knee" + s], an = J["ankle" + s];
    const fwd = norm(add(mul(ax.hipFwd, 1), v3(0, -0.15, 0)));
    const toe = add(add(an, mul(fwd, spec.shoes === "none" ? 0.09 : 0.12)), v3(0, -0.04, 0));
    const heel = add(add(an, mul(fwd, -0.025)), v3(0, -0.035, 0));
    items.push({
      z: (hp.z + kn.z + an.z) / 3 - 0.05 + (kn.z - torsoZ > 0.15 ? 0.2 : 0),
      draw(ctx) {
        const legW = m.legT * k;
        // shoes
        const shoeW = (spec.shoes === "boots" ? 0.085 : spec.shoes === "none" ? 0.055 : 0.078) * k;
        if (spec.shoes === "boots") tube(ctx, [lerp3(an, kn, 0.28), heel, toe].map(P), shoeW, col("shoes"), ink, lw, false);
        else tube(ctx, [heel, toe].map(P), shoeW, spec.shoes === "none" ? col("skin") : col("shoes"), ink, lw);
        if (bottom === "pants" && top !== "dress") {
          tube(ctx, [hp, kn, lerp3(kn, an, 0.93)].map(P), legW * 1.08, col("bottom"), ink, lw);
          cuff(ctx, kn, an, 0.93, legW * 1.08);
        } else {
          tube(ctx, [hp, kn, an].map(P), legW * 0.86, col("skin"), ink, lw);
          if (bottom === "shorts" && top !== "dress") {
            tube(ctx, [hp, lerp3(hp, kn, 0.55)].map(P), legW * 1.2, col("bottom"), ink, lw, false);
            cuff(ctx, hp, kn, 0.55, legW * 1.2);
          }
        }
        const footLen = Math.hypot(...[0, 1].map((i) => P(toe)[i] - P(heel)[i]));
        if (spec.shoes === "sneakers" && footLen > shoeW * 1.2) {
          // sole line
          const a = P(lerp3(heel, toe, 0.05)), b = P(lerp3(heel, toe, 0.95));
          const off = shoeW * 0.32;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1] + off);
          ctx.lineTo(b[0], b[1] + off);
          ctx.lineWidth = lw * 0.8;
          ctx.strokeStyle = ink;
          ctx.stroke();
        }
      },
    });
  }
  function cuff(ctx, a, b, t, width) {
    // a short line across the end of a sleeve or trouser leg
    const p = P(lerp3(a, b, t)), q = P(b);
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    ctx.beginPath();
    ctx.moveTo(p[0] + nx * width * 0.5, p[1] + ny * width * 0.5);
    ctx.lineTo(p[0] - nx * width * 0.5, p[1] - ny * width * 0.5);
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // ── head ──
  const Hm = mmul(V, euler(pose.head.yaw, pose.head.pitch, pose.head.roll));
  const R = m.headR;
  const C = add(J.headBase, mul(apply(Hm, v3(0, 0.82, -0.06)), R));
  items.push(...headItems({ model: getModel(spec), spec, M: Hm, R, C, proj, st, face: pose.face, k }));

  items.sort((a, b) => a.z - b.z);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const it of items) it.draw(ctx);
  ctx.restore();

  if (opts.bones) drawBones(ctx, J, P, C, Hm, R, k, opts.accent ?? "#ffc93c");
  return { headScreen: P(C), headR: R * k, joints: J };
}

function drawBones(ctx, J, P, C, Hm, R, k, accent) {
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.95;
  for (const [a, b] of BONES) {
    const p = P(J[a]), q = P(J[b]);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
  }
  for (const n in J) {
    const p = P(J[n]);
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // head axes
  const c = P(C);
  const axes = [[v3(1.4, 0, 0), "#ff5f57"], [v3(0, 1.4, 0), "#5ee08a"], [v3(0, 0, 1.6), accent]];
  for (const [d, color] of axes) {
    const e = P(add(C, mul(apply(Hm, d), R)));
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(c[0], c[1], 4.5, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
}

/** Height of the character's bounding box in world units (for framing). */
export function figureHeight(spec) {
  const m = measure(spec);
  return m.ankleY + m.thigh + m.shin + m.torso + m.neck + m.headR * 2.1 + 0.05;
}
export { deg, dot };
