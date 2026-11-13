// Skeleton: joint positions in world space (metres-ish, ground at y = 0).
// "l" and "r" are the character's own left and right; its left is +x.
import { add, clamp, cross, len, lerp3, mul, norm, sub, v3 } from "./math.js";

export const BONES = [
  ["pelvis", "chest"],
  ["chest", "neck"],
  ["neck", "headBase"],
  ["shoulderL", "elbowL"], ["elbowL", "wristL"],
  ["shoulderR", "elbowR"], ["elbowR", "wristR"],
  ["hipL", "kneeL"], ["kneeL", "ankleL"],
  ["hipR", "kneeR"], ["kneeR", "ankleR"],
  ["chest", "shoulderL"], ["chest", "shoulderR"],
  ["pelvis", "hipL"], ["pelvis", "hipR"],
];

/** Body measurements derived from the spec's shape sliders. */
export function measure(spec) {
  const s = spec.shape;
  const h = s.height;
  const headR = 0.118 * s.headSize * (0.85 + 0.15 * h);
  const thigh = 0.31 * s.legs * h, shin = 0.3 * s.legs * h;
  return {
    headR,
    thigh, shin,
    ankleY: 0.075 * h,
    torso: 0.38 * h,
    neck: 0.05 * h + headR * 0.12,
    shW: 0.165 * s.shoulders * h,
    hipW: 0.085 * s.hips * h,
    waistW: 0.12 * (0.5 * s.shoulders + 0.5 * s.hips) * h,
    upperArm: 0.245 * h,
    foreArm: 0.225 * h,
    armT: 0.058 * s.limbs * h,
    legT: 0.074 * s.limbs * h,
    depth: 0.1 * h * (0.7 + 0.3 * s.limbs),
  };
}

/** A relaxed standing pose. */
export function restPose(spec) {
  const m = measure(spec);
  const hipY = m.ankleY + m.thigh + m.shin;
  const pelvis = v3(0, hipY, 0);
  const chest = v3(0, hipY + m.torso, 0);
  const j = { pelvis, chest };
  j.neck = add(chest, v3(0, 0.02, 0));
  j.headBase = add(j.neck, v3(0, m.neck, 0));
  for (const [k, s] of [["L", 1], ["R", -1]]) {
    j["shoulder" + k] = v3(s * m.shW, chest.y - 0.02, 0);
    const a = 0.16; // arms out from the body
    j["elbow" + k] = add(j["shoulder" + k], v3(s * Math.sin(a) * m.upperArm, -Math.cos(a) * m.upperArm, -0.01));
    const b = 0.1;
    j["wrist" + k] = add(j["elbow" + k], v3(s * Math.sin(b) * m.foreArm, -Math.cos(b) * m.foreArm, 0.03));
    j["hip" + k] = v3(s * m.hipW, hipY, 0);
    j["knee" + k] = add(j["hip" + k], v3(s * 0.012, -m.thigh, 0.01));
    j["ankle" + k] = add(j["knee" + k], v3(s * 0.006, -m.shin, -0.01));
  }
  return {
    joints: j,
    head: { yaw: 0, pitch: 0, roll: 0 },
    face: { blinkL: 0, blinkR: 0, jaw: 0, smile: 0, brow: 0, gazeX: 0, gazeY: 0 },
  };
}

export function clonePose(p) {
  return {
    joints: Object.fromEntries(Object.entries(p.joints).map(([k, v]) => [k, { ...v }])),
    head: { ...p.head },
    face: { ...p.face },
  };
}

/** Blend b into a by t (in place on a copy). */
export function blendPose(a, b, t) {
  const o = clonePose(a);
  for (const k in o.joints) if (b.joints[k]) o.joints[k] = lerp3(a.joints[k], b.joints[k], t);
  for (const k in o.head) o.head[k] = a.head[k] + (b.head[k] - a.head[k]) * t;
  for (const k in o.face) o.face[k] = a.face[k] + (b.face[k] - a.face[k]) * t;
  return o;
}

/** Torso frame: forward axis from the shoulder line and the spine. */
export function torsoAxes(j) {
  const up = norm(sub(j.chest, j.pelvis));
  const shAxis = norm(sub(j.shoulderL, j.shoulderR));
  const hipAxis = norm(sub(j.hipL, j.hipR));
  return { up, shAxis, hipAxis, shFwd: norm(cross(shAxis, up)), hipFwd: norm(cross(hipAxis, up)) };
}

/** Breathing, swaying and blinking on top of a pose. t in seconds. */
export function idle(pose, t, amount = 1) {
  const p = clonePose(pose);
  const breath = Math.sin(t * 1.6) * 0.004 * amount;
  for (const k of ["chest", "neck", "headBase", "shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR"]) p.joints[k].y += breath;
  const sway = Math.sin(t * 0.9) * 0.012 * amount;
  for (const k of ["wristL", "wristR"]) p.joints[k].z += sway;
  // blink about every 3.7s
  const ph = (t % 3.7) / 3.7;
  const b = ph > 0.955 ? Math.sin(((ph - 0.955) / 0.045) * Math.PI) : 0;
  p.face.blinkL = Math.max(p.face.blinkL, b);
  p.face.blinkR = Math.max(p.face.blinkR, b);
  return p;
}

// ── Motion capture retargeting ────────────────────────────────────────────
// MediaPipe pose world landmarks: x = image right, y = down, z = away from
// the camera, origin between the hips. We keep the character's own bone
// lengths and only copy bone directions, so any body shape can be driven.
const LM = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };

export function poseFromLandmarks(spec, world, { mirror = true, legs = "auto" } = {}) {
  const rest = restPose(spec);
  const m = measure(spec);
  const P = (i) => {
    const w = world[i];
    return { x: (mirror ? -1 : 1) * w.x, y: -w.y, z: -w.z, vis: w.visibility ?? 1 };
  };
  // In a mirror the subject's left shows up as the character's right.
  const side = (l, r) => (mirror ? [P(r), P(l)] : [P(l), P(r)]);
  const [sL, sR] = side(LM.ls, LM.rs);
  const [eL, eR] = side(LM.le, LM.re);
  const [wL, wR] = side(LM.lw, LM.rw);
  const [hL, hR] = side(LM.lh, LM.rh);
  const [kL, kR] = side(LM.lk, LM.rk);
  const [aL, aR] = side(LM.la, LM.ra);

  const j = { ...rest.joints };
  const midH = mul(add(hL, hR), 0.5), midS = mul(add(sL, sR), 0.5);
  let up = norm(sub(midS, midH));
  if (up.y < 0.3) up = norm(add(up, v3(0, 0.6, 0)));
  const shAxis = norm(sub(sL, sR));
  let hipAxis = norm(sub(hL, hR));
  // Hips are noisy when out of frame: keep them close to the shoulder twist.
  const hipsSeen = Math.min(hL.vis, hR.vis) > 0.5;
  if (!hipsSeen) hipAxis = norm(v3(shAxis.x, 0, shAxis.z));

  const pelvis = rest.joints.pelvis;
  j.pelvis = pelvis;
  j.chest = add(pelvis, mul(up, m.torso));
  j.neck = add(j.chest, mul(up, 0.02));
  j.headBase = add(j.neck, mul(up, m.neck));
  j.shoulderL = add(add(j.chest, mul(shAxis, m.shW)), mul(up, -0.02));
  j.shoulderR = add(add(j.chest, mul(shAxis, -m.shW)), mul(up, -0.02));
  j.hipL = add(pelvis, mul(hipAxis, m.hipW));
  j.hipR = add(pelvis, mul(hipAxis, -m.hipW));

  const limb = (from, a, b, length, fallback) => {
    const d = sub(b, a);
    if (len(d) < 1e-4 || Math.min(a.vis, b.vis) < 0.35) return fallback(from);
    return add(from, mul(norm(d), length));
  };
  const restOff = (a, b) => (from) => add(from, sub(rest.joints[b], rest.joints[a]));
  j.elbowL = limb(j.shoulderL, sL, eL, m.upperArm, restOff("shoulderL", "elbowL"));
  j.wristL = limb(j.elbowL, eL, wL, m.foreArm, restOff("elbowL", "wristL"));
  j.elbowR = limb(j.shoulderR, sR, eR, m.upperArm, restOff("shoulderR", "elbowR"));
  j.wristR = limb(j.elbowR, eR, wR, m.foreArm, restOff("elbowR", "wristR"));

  const useLegs = legs === "on" || (legs === "auto" && Math.min(kL.vis, kR.vis, aL.vis, aR.vis) > 0.6);
  if (useLegs) {
    j.kneeL = limb(j.hipL, hL, kL, m.thigh, restOff("hipL", "kneeL"));
    j.ankleL = limb(j.kneeL, kL, aL, m.shin, restOff("kneeL", "ankleL"));
    j.kneeR = limb(j.hipR, hR, kR, m.thigh, restOff("hipR", "kneeR"));
    j.ankleR = limb(j.kneeR, kR, aR, m.shin, restOff("kneeR", "ankleR"));
    // keep the lower foot on the ground
    const low = Math.min(j.ankleL.y, j.ankleR.y);
    const dy = m.ankleY - low;
    if (dy > 0) for (const k in j) j[k] = { ...j[k], y: j[k].y + dy };
  } else {
    for (const k of ["kneeL", "ankleL", "kneeR", "ankleR"]) j[k] = { ...rest.joints[k] };
  }
  return { joints: j, head: { ...rest.head }, face: { ...rest.face } };
}

/** Head angles and face shapes from a FaceLandmarker result. */
export function faceFromResult(res, mirror = true) {
  const mtx = res.facialTransformationMatrixes?.[0]?.data;
  const bs = res.faceBlendshapes?.[0]?.categories;
  if (!mtx || !bs) return null;
  // column-major 4×4: forward = 3rd column, up = 2nd column
  const fx = mtx[8], fy = mtx[9], fz = mtx[10];
  const ux = mtx[4], uy = mtx[5];
  let yaw = Math.atan2(fx, fz);
  const pitch = -Math.asin(clamp(fy, -1, 1));
  let roll = Math.atan2(-ux, uy);
  if (mirror) {
    yaw = -yaw;
    roll = -roll;
  }
  const b = Object.fromEntries(bs.map((c) => [c.categoryName, c.score]));
  const g = (k) => b[k] ?? 0;
  // Subject's left eye → character's right eye in a mirror.
  const blinkSubL = g("eyeBlinkLeft"), blinkSubR = g("eyeBlinkRight");
  let gazeX = (g("eyeLookOutLeft") - g("eyeLookInLeft") + g("eyeLookInRight") - g("eyeLookOutRight")) / 2;
  if (mirror) gazeX = -gazeX;
  const gazeY = (g("eyeLookDownLeft") + g("eyeLookDownRight") - g("eyeLookUpLeft") - g("eyeLookUpRight")) / 2;
  const shape = (v) => clamp((v - 0.08) / 0.6, 0, 1);
  return {
    head: { yaw, pitch, roll },
    face: {
      blinkL: shape(mirror ? blinkSubR : blinkSubL),
      blinkR: shape(mirror ? blinkSubL : blinkSubR),
      jaw: clamp((g("jawOpen") - 0.04) / 0.5, 0, 1),
      smile: clamp((g("mouthSmileLeft") + g("mouthSmileRight")) / 1.2 - 0.05, 0, 1),
      brow: clamp(g("browInnerUp") * 1.4 - g("browDownLeft") * 0.8, -1, 1),
      gazeX: clamp(gazeX * 1.6, -1, 1),
      gazeY: clamp(gazeY * 1.6, -1, 1),
    },
  };
}
