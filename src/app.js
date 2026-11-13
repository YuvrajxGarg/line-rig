import { LABELS, OPTIONS, PRESETS, SHAPE, defaultSpec, normalize } from "./spec.js";
import { blendPose, clonePose, faceFromResult, idle, measure, poseFromLandmarks, restPose } from "./skeleton.js";
import { THEMES, drawCharacter, figureHeight } from "./render.js";
import { bindDrawing, drawRigged, fitSpec } from "./drawing.js";
import { describe } from "./describe.js";
import { clamp, deg } from "./math.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ACCENT = "#ffc93c";

// ── State (saved to sessionStorage only: nothing leaves this tab) ──
const KEY = "line-rig:v1";
const state = {
  step: "character",
  charTab: "describe",
  mode: "spec", // "spec" (clean rig) or "drawn" (your strokes)
  spec: defaultSpec(),
  strokes: [],
  view: "sheet",
  yaw: 30,
  spin: false,
  bones: true,
  theme: "paper",
  fills: false,
  weight: 2.4,
  src: "cursor",
  follow: 1,
  bodyFollow: true,
  mirror: true,
  legs: "auto",
  smoothing: 0.45,
  faceManual: { smile: 0, jaw: 0, blink: 0, brow: 0 },
};
try {
  const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
  if (saved) Object.assign(state, saved, { spec: normalize(saved.spec), step: saved.step || "character" });
} catch {
  /* private mode etc. */
}
let rig = null; // bound drawing
const save = () => {
  try {
    const { step, charTab, mode, spec, strokes, view, yaw, bones, theme, fills, weight, src, follow, bodyFollow, mirror, legs, smoothing } = state;
    sessionStorage.setItem(KEY, JSON.stringify({ step, charTab, mode, spec, strokes, view, yaw, bones, theme, fills, weight, src: src === "cursor" ? src : "cursor", follow, bodyFollow, mirror, legs, smoothing }));
  } catch {
    /* ignore */
  }
};
if (state.mode === "drawn" && state.strokes.length) rig = bindDrawing(state.strokes, state.spec);
else state.mode = "spec";

// ── Canvas ──
const stage = $("#stage");
const canvas = $("#canvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
}
new ResizeObserver(resize).observe(stage);
resize();

let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ── Framing ──
function singleFrame(w = W, h = H, spec = state.spec) {
  const fh = figureHeight(spec);
  const k = Math.min((h * 0.8) / fh, w * 0.9);
  return { ox: w / 2, oy: h * 0.9, k };
}
function sheetFrames(w = W, h = H, spec = state.spec) {
  const views = [
    { yaw: 0, label: "FRONT" },
    { yaw: 45, label: "THREE-QUARTER" },
    { yaw: 90, label: "SIDE" },
    { yaw: 180, label: "BACK" },
  ];
  const fh = figureHeight(spec);
  const cell = w / views.length;
  const k = Math.min((h * 0.68) / fh, cell / 0.62);
  return views.map((v, i) => ({ ...v, ox: cell * (i + 0.5), oy: h * 0.84, k }));
}

// ── Pose ──
let pose = restPose(state.spec);
let capTarget = null; // latest mocap pose
let capFace = null;
const pointer = { x: 0.5, y: 0.4, inside: false, ts: 0 };
let headScreen = [0, 0], headR = 40;
const t0 = performance.now();

function targetPose(t) {
  const rest = restPose(state.spec);
  let p = clonePose(rest);
  const capturing = state.step === "animate" && state.src !== "cursor" && capTarget;
  if (capturing) {
    p = clonePose(capTarget);
    if (capFace) {
      p.head = { ...capFace.head };
      p.face = { ...capFace.face };
    }
  } else if (state.step === "animate" || state.step === "character") {
    // follow the pointer
    const live = state.step === "animate";
    const f = live ? state.follow : 0.55;
    const dx = (pointer.x * W - headScreen[0]) / Math.max(200, W * 0.45);
    const dy = (pointer.y * H - headScreen[1]) / Math.max(200, H * 0.5);
    const idleLook = !pointer.inside;
    const yaw = idleLook ? Math.sin(t * 0.4) * 0.25 : clamp(dx * 1.4 * f, -1.25, 1.25);
    const pitch = idleLook ? Math.sin(t * 0.33) * 0.06 : clamp(dy * 1.1 * f, -0.6, 0.7);
    p.head = { yaw, pitch, roll: -yaw * 0.08 };
    p.face.gazeX = clamp(dx * 2, -1, 1);
    p.face.gazeY = clamp(dy * 2, -1, 1);
    if (live && state.bodyFollow && !idleLook) {
      // turn the whole body a little toward the pointer
      const by = yaw * 0.22;
      const c = Math.cos(by), s = Math.sin(by);
      for (const k in p.joints) {
        const j = p.joints[k];
        p.joints[k] = { x: j.x * c + j.z * s, y: j.y, z: -j.x * s + j.z * c };
      }
    }
  }
  if (state.step === "rig") {
    p.head = { yaw: 0, pitch: 0, roll: 0 };
  }
  const fm = state.faceManual;
  if (!capturing) {
    p.face.smile = fm.smile;
    p.face.jaw = fm.jaw;
    p.face.brow = fm.brow;
    p.face.blinkL = p.face.blinkR = fm.blink;
  }
  return capturing ? p : idle(p, t, 1);
}

// ── Render ──
function paintBackground(c, w, h, theme) {
  const th = THEMES[theme];
  c.fillStyle = th.paper;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = th.grid;
  c.lineWidth = 1;
  const g = 28;
  c.beginPath();
  for (let x = ((w / 2) % g); x < w; x += g) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); }
  for (let y = ((h / 2) % g); y < h; y += g) { c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); }
  c.stroke();
}
function ground(c, x0, x1, y, theme) {
  c.strokeStyle = THEMES[theme].ink;
  c.globalAlpha = 0.25;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0, y + 0.5);
  c.lineTo(x1, y + 0.5);
  c.stroke();
  c.globalAlpha = 1;
}

function drawScene(c, w, h, p, { forExport = false } = {}) {
  const theme = state.theme;
  paintBackground(c, w, h, theme);
  const ink = THEMES[theme].ink;
  const opts = (f, extra = {}) => ({ ...f, theme, fills: state.fills, weight: state.weight, accent: ACCENT, ...extra });

  if (state.step === "character" && state.charTab === "draw") {
    const f = singleFrame(w, h);
    if ($("#guideOn").checked) {
      c.save();
      c.globalAlpha = 0.16;
      drawCharacter(c, state.spec, restPose(state.spec), opts(f, { fills: false, viewYaw: 0 }));
      c.restore();
    }
    c.save();
    c.strokeStyle = ink;
    c.lineCap = "round";
    c.lineJoin = "round";
    const lw = Math.max(1, state.weight * (f.k / 330));
    for (const s of [...state.strokes, ...(liveStroke ? [liveStroke] : [])]) {
      c.lineWidth = lw * (s.w ?? 1);
      c.beginPath();
      s.pts.forEach((q, i) => {
        const x = f.ox + q.x * f.k, y = f.oy - q.y * f.k;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      if (s.pts.length === 1) c.lineTo(f.ox + s.pts[0].x * f.k + 0.1, f.oy - s.pts[0].y * f.k);
      c.stroke();
    }
    c.restore();
    ground(c, w * 0.25, w * 0.75, f.oy, theme);
    return;
  }

  if (state.step === "rig" && state.view === "sheet") {
    const frames = sheetFrames(w, h);
    const rest = p;
    ground(c, 0, w, frames[0].oy, theme);
    c.fillStyle = ink;
    c.font = `600 ${Math.max(10, Math.round(h * 0.016))}px "Geist Mono", monospace`;
    c.textAlign = "center";
    const drawnPoses = [
      ["FRONT", 0, 0],
      ["HEAD LEFT · 45°", -0.8, 0],
      ["HEAD RIGHT · 45°", 0.8, 0],
      ["LOOK UP", 0, -0.4],
    ];
    for (const [i, f] of frames.entries()) {
      if (state.mode === "drawn") {
        const [label, yaw, pitch] = drawnPoses[i];
        const dp = clonePose(rest);
        dp.head = { yaw, pitch, roll: 0 };
        drawRigged(c, rig, dp, { ...f, ink, weight: state.weight, viewYaw: 0 });
        c.globalAlpha = 0.55;
        c.fillText(label, f.ox, f.oy + h * 0.06);
        c.globalAlpha = 1;
        continue;
      } else {
        drawCharacter(c, state.spec, rest, opts(f, { viewYaw: f.yaw * deg, bones: state.bones && !forExport }));
      }
      c.globalAlpha = 0.55;
      c.fillText(`${f.label} · ${f.yaw}°`, f.ox, f.oy + h * 0.06);
      c.globalAlpha = 1;
    }
    c.textAlign = "left";
    c.font = `600 ${Math.max(12, Math.round(h * 0.024))}px "Geist", sans-serif`;
    c.fillText(state.mode === "drawn" ? "Your drawing" : state.spec.name, 24, 40);
    return;
  }

  const f = singleFrame(w, h);
  ground(c, w * 0.3, w * 0.7, f.oy, theme);
  let viewYaw = 0;
  if (state.step === "rig") viewYaw = (state.spin ? ((performance.now() - t0) / 1000) * 40 : state.yaw) * deg;
  let res;
  if (state.mode === "drawn") res = drawRigged(c, rig, p, { ...f, ink, weight: state.weight, viewYaw });
  else res = drawCharacter(c, state.spec, p, opts(f, { viewYaw, bones: state.step === "rig" && state.bones && !forExport }));
  if (!forExport) {
    headScreen = [res.headScreen[0], res.headScreen[1]];
    headR = res.headR;
  }
  if (state.step === "animate" && state.src === "cursor" && pointer.inside && !forExport) {
    c.save();
    c.strokeStyle = ACCENT;
    c.lineWidth = 1.5;
    c.setLineDash([4, 5]);
    c.globalAlpha = 0.8;
    c.beginPath();
    c.moveTo(headScreen[0], headScreen[1]);
    c.lineTo(pointer.x * w, pointer.y * h);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.arc(pointer.x * w, pointer.y * h, 5, 0, Math.PI * 2);
    c.fillStyle = ACCENT;
    c.fill();
    c.restore();
  }
}

let last = performance.now();
function frame(now) {
  const t = (now - t0) / 1000;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const target = targetPose(t);
  const capturing = state.step === "animate" && state.src !== "cursor" && capTarget;
  // smoothing: frame-rate independent exponential
  const base = capturing ? 1 - state.smoothing * 0.95 : 0.16;
  const a = 1 - Math.pow(1 - base, dt * 60);
  pose = blendPose(pose, target, clamp(a, 0.02, 1));
  if (!capturing) {
    // blinks shouldn't be smoothed away
    pose.face.blinkL = target.face.blinkL;
    pose.face.blinkR = target.face.blinkR;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawScene(ctx, W, H, state.step === "rig" ? target : pose);
  if (capActive) captureTick(now);
  requestAnimationFrame(frame);
}

// ── Pointer ──
stage.addEventListener("pointermove", (e) => {
  const r = stage.getBoundingClientRect();
  pointer.x = (e.clientX - r.left) / r.width;
  pointer.y = (e.clientY - r.top) / r.height;
  pointer.inside = true;
});
stage.addEventListener("pointerleave", () => (pointer.inside = false));

// ── Drawing ──
let tool = "pen";
let liveStroke = null;
let undo = [];
const toWorld = (e) => {
  const r = stage.getBoundingClientRect();
  const f = singleFrame();
  return { x: (e.clientX - r.left - f.ox) / f.k, y: -(e.clientY - r.top - f.oy) / f.k };
};
const isDrawing = () => state.step === "character" && state.charTab === "draw";
function eraseAt(p) {
  const f = singleFrame();
  const rad = 12 / f.k;
  const before = state.strokes.length;
  state.strokes = state.strokes.filter((s) => !s.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < rad));
  return before !== state.strokes.length;
}
stage.addEventListener("pointerdown", (e) => {
  if (!isDrawing()) return;
  stage.setPointerCapture(e.pointerId);
  const p = toWorld(e);
  undo.push(JSON.stringify(state.strokes));
  if (undo.length > 60) undo.shift();
  if (tool === "erase") {
    eraseAt(p);
    return;
  }
  liveStroke = { pts: [p], w: +$("#penWeight").value };
});
stage.addEventListener("pointermove", (e) => {
  if (!isDrawing() || !stage.hasPointerCapture(e.pointerId)) return;
  const p = toWorld(e);
  if (tool === "erase") {
    eraseAt(p);
    return;
  }
  if (!liveStroke) return;
  const lastP = liveStroke.pts[liveStroke.pts.length - 1];
  const f = singleFrame();
  if (Math.hypot(p.x - lastP.x, p.y - lastP.y) * f.k < 2.2) return;
  // light smoothing while drawing
  liveStroke.pts.push({ x: lastP.x * 0.35 + p.x * 0.65, y: lastP.y * 0.35 + p.y * 0.65 });
});
const endStroke = () => {
  if (liveStroke) {
    state.strokes.push(liveStroke);
    liveStroke = null;
    save();
  }
};
stage.addEventListener("pointerup", endStroke);
stage.addEventListener("pointercancel", endStroke);

$$("[data-tool]").forEach((b) =>
  b.addEventListener("click", () => {
    tool = b.dataset.tool;
    $$("[data-tool]").forEach((x) => x.classList.toggle("on", x === b));
    syncStageClass();
  }),
);
$("#undoBtn").addEventListener("click", () => {
  if (!undo.length) return;
  state.strokes = JSON.parse(undo.pop());
  save();
});
$("#clearBtn").addEventListener("click", () => {
  if (!state.strokes.length) return;
  undo.push(JSON.stringify(state.strokes));
  state.strokes = [];
  save();
});
$("#rigDrawBtn").addEventListener("click", () => {
  if (state.strokes.length < 3) return toast("Draw a few strokes first: a head, a body and some limbs.");
  rig = bindDrawing(state.strokes, state.spec);
  state.mode = "drawn";
  const counts = rig.strokes.reduce((a, s) => ((a[s.part || (s.kind === "head" ? (s.feature ? "face" : "head") : "body")] = (a[s.part || (s.kind === "head" ? (s.feature ? "face" : "head") : "body")] || 0) + 1), a), {});
  const found = [counts.eyeL || counts.eyeR ? "eyes" : null, counts.mouth ? "mouth" : null].filter(Boolean);
  toast(`Rigged ${state.strokes.length} strokes${found.length ? `, found the ${found.join(" and ")}` : ""}.`);
  save();
  setStep("rig");
});
$("#fitBtn").addEventListener("click", () => {
  if (state.strokes.length < 3) return toast("Draw a few strokes first.");
  const r = bindDrawing(state.strokes, state.spec);
  state.spec = normalize(fitSpec(r, state.spec));
  state.mode = "spec";
  toast("Made a clean rig with your drawing's proportions. Fine-tune it in Build.");
  buildForm();
  save();
  setStep("rig");
});

// ── Steps and tabs ──
function setStep(step) {
  state.step = step;
  $$(".steps button").forEach((b) => b.classList.toggle("on", b.dataset.step === step));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== step));
  if (step !== "animate") stopCapture();
  else if (state.src !== "cursor") startSource(state.src);
  rigFacts();
  syncStageClass();
  save();
}
$$(".steps button").forEach((b) => b.addEventListener("click", () => setStep(b.dataset.step)));

function setCharTab(tab) {
  state.charTab = tab;
  $$("#charTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $$("[data-tab-panel]").forEach((p) => (p.hidden = p.dataset.tabPanel !== tab));
  syncStageClass();
  save();
}
$$("#charTabs button").forEach((b) => b.addEventListener("click", () => setCharTab(b.dataset.tab)));

function syncStageClass() {
  stage.classList.toggle("drawing", isDrawing() && tool === "pen");
  stage.classList.toggle("erasing", isDrawing() && tool === "erase");
  stage.classList.toggle("night", state.theme === "night");
  stage.style.background = THEMES[state.theme].paper;
  const note = $("#stageNote");
  if (isDrawing()) note.textContent = `${state.strokes.length} strokes`;
  else if (state.step === "animate" && state.src === "cursor") note.textContent = "Move the pointer";
  else if (state.step === "rig" && state.view === "sheet") note.textContent = "";
  else note.textContent = state.mode === "drawn" ? "Your drawing" : state.spec.name;
}
setInterval(syncStageClass, 500);

// ── Describe ──
const EXAMPLES = ["A sleepy DJ with curly hair, a black hoodie and headphones", "Tall explorer with a ponytail, jacket and boots", "Cheerful kid with a bob, glasses and a yellow dress", "Grumpy bearded chef with a cap", "Skinny punk with a mohawk and a red tank"];
const ex = $("#examples");
for (const e of EXAMPLES) {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = e.length > 34 ? e.slice(0, 32) + "…" : e;
  b.title = e;
  b.addEventListener("click", () => {
    $("#prompt").value = e;
    generate();
  });
  ex.appendChild(b);
}
async function generate() {
  const text = $("#prompt").value.trim();
  if (!text) return toast("Write a short description first.");
  const btn = $("#genBtn");
  btn.disabled = true;
  btn.textContent = "Designing…";
  try {
    const { spec, via } = await describe(text);
    state.spec = spec;
    state.mode = "spec";
    pose = restPose(spec);
    buildForm();
    save();
    $("#genHint").textContent = via === "claude" ? `Designed by Claude: ${spec.name}. Tweak any part in Build.` : `Matched from your words: ${spec.name}. Tweak any part in Build.`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Make character";
  }
}
$("#genBtn").addEventListener("click", generate);
$("#prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
});

// presets with live thumbnails
const presetBox = $("#presets");
PRESETS.forEach((p) => {
  const b = document.createElement("button");
  b.className = "preset";
  b.title = p.name;
  const cv = document.createElement("canvas");
  cv.width = 180;
  cv.height = 240;
  b.append(cv);
  const s = document.createElement("span");
  s.textContent = p.name;
  b.append(s);
  const c = cv.getContext("2d");
  c.fillStyle = "#f3efe6";
  c.fillRect(0, 0, 180, 240);
  const fh = figureHeight(p);
  const pr = restPose(p);
  pr.head.yaw = 0.35;
  drawCharacter(c, p, pr, { ox: 90, oy: 228, k: 215 / fh, viewYaw: 0.25, theme: "paper", fills: true, weight: 2.6 });
  b.addEventListener("click", () => {
    state.spec = normalize(JSON.parse(JSON.stringify(p)));
    state.mode = "spec";
    buildForm();
    save();
    toast(`${p.name} loaded.`);
  });
  presetBox.append(b);
});

// ── Build form ──
function buildForm() {
  const box = $("#buildForm");
  box.innerHTML = "";
  const nameRow = document.createElement("div");
  nameRow.className = "row";
  nameRow.innerHTML = `<span>Name</span>`;
  const name = document.createElement("input");
  name.value = state.spec.name;
  Object.assign(name.style, { flex: 1, height: "30px", borderRadius: "9px", border: "1px solid var(--line)", background: "var(--panel-2)", padding: "0 10px", fontSize: "12.5px" });
  name.addEventListener("input", () => { state.spec.name = name.value.slice(0, 40) || "Untitled"; save(); });
  nameRow.append(name);
  box.append(nameRow);
  for (const k of ["head", "hair", "eyes", "brows", "nose", "mouth", "top", "bottom", "shoes", "extras"]) {
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<div class="sub">${LABELS[k]}</div>`;
    const chips = document.createElement("div");
    chips.className = "chips";
    chips.style.marginTop = "0";
    for (const o of OPTIONS[k]) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = o;
      const on = k === "extras" ? state.spec.extras.includes(o) : state.spec[k] === o;
      b.classList.toggle("on", on);
      b.addEventListener("click", () => {
        if (k === "extras") {
          const set = new Set(state.spec.extras);
          set.has(o) ? set.delete(o) : set.add(o);
          state.spec = normalize({ ...state.spec, extras: [...set] });
        } else state.spec = normalize({ ...state.spec, [k]: o });
        state.mode = "spec";
        buildForm();
        save();
      });
      chips.append(b);
    }
    g.append(chips);
    box.append(g);
  }
  const sh = document.createElement("div");
  sh.innerHTML = `<div class="sub">Proportions</div>`;
  for (const p of SHAPE) {
    const r = document.createElement("div");
    r.className = "row";
    r.innerHTML = `<span>${p.label}</span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${state.spec.shape[p.k]}" />`;
    r.querySelector("input").addEventListener("input", (e) => {
      state.spec = normalize({ ...state.spec, shape: { ...state.spec.shape, [p.k]: +e.target.value } });
      state.mode = "spec";
      save();
    });
    r.querySelector("input").addEventListener("dblclick", () => { state.spec = normalize({ ...state.spec, shape: { ...state.spec.shape, [p.k]: p.def } }); buildForm(); save(); });
    sh.append(r);
  }
  box.append(sh);
  const cl = document.createElement("div");
  cl.innerHTML = `<div class="sub">Flat colours</div>`;
  const sw = document.createElement("div");
  sw.className = "swatches";
  for (const k of ["hair", "top", "bottom", "shoes", "accent", "skin"]) {
    const l = document.createElement("label");
    l.className = "swatch";
    l.innerHTML = `<input type="color" value="${state.spec.colors[k]}" />${k}`;
    l.querySelector("input").addEventListener("input", (e) => {
      state.spec = normalize({ ...state.spec, colors: { ...state.spec.colors, [k]: e.target.value } });
      if (!state.fills) { state.fills = true; $("#fillsOn").checked = true; }
      save();
    });
    sw.append(l);
  }
  cl.append(sw);
  box.append(cl);
}

// ── Rig panel ──
$$("#viewTabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.view = b.dataset.view;
    $$("#viewTabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("#yawRow").hidden = $("#spinRow").hidden = state.view !== "spin";
    save();
  }),
);
$("#yaw").addEventListener("input", (e) => {
  state.yaw = +e.target.value;
  $("#yawOut").textContent = `${state.yaw}°`;
  state.spin = false;
  $("#spinOn").checked = false;
});
$("#spinOn").addEventListener("change", (e) => (state.spin = e.target.checked));
$("#bonesOn").addEventListener("change", (e) => { state.bones = e.target.checked; save(); });
const FACE = [
  { k: "smile", label: "Smile", min: 0, max: 1 },
  { k: "jaw", label: "Mouth open", min: 0, max: 1 },
  { k: "blink", label: "Blink", min: 0, max: 1 },
  { k: "brow", label: "Brows", min: -1, max: 1 },
];
for (const f of FACE) {
  const r = document.createElement("div");
  r.className = "row";
  r.innerHTML = `<span>${f.label}</span><input type="range" min="${f.min}" max="${f.max}" step="0.01" value="0" />`;
  r.querySelector("input").addEventListener("input", (e) => (state.faceManual[f.k] = +e.target.value));
  r.querySelector("input").addEventListener("dblclick", (e) => { e.target.value = 0; state.faceManual[f.k] = 0; });
  $("#faceSliders").append(r);
}
function rigFacts() {
  const ul = $("#rigFacts");
  const m = measure(state.spec);
  const items =
    state.mode === "drawn"
      ? [
          ["Source", "your drawing"],
          ["Strokes bound", rig?.strokes.length ?? 0],
          ["Bones", 10],
          ["Head", "2.5D, ±50°"],
          ["Eyes / mouth found", `${rig?.strokes.some((s) => s.part?.startsWith("eye")) ? "yes" : "no"} / ${rig?.strokes.some((s) => s.part === "mouth") ? "yes" : "no"}`],
          ["Views", "front (use Clean rig for all)"],
        ]
      : [
          ["Joints", 17],
          ["Bones", 15],
          ["Head", "yaw · pitch · roll"],
          ["Face", "blink · jaw · smile · brows · gaze"],
          ["Views", "any angle, 360°"],
          ["Height", `${(figureHeight(state.spec) * 100).toFixed(0)} units`],
          ["Head radius", `${(m.headR * 100).toFixed(1)} units`],
        ];
  ul.innerHTML = items.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join("");
}

// ── Style ──
$$("#themeSeg button").forEach((b) =>
  b.addEventListener("click", () => {
    state.theme = b.dataset.theme;
    $$("#themeSeg button").forEach((x) => x.classList.toggle("on", x === b));
    syncStageClass();
    save();
  }),
);
$("#fillsOn").addEventListener("change", (e) => { state.fills = e.target.checked; save(); });
$("#weight").addEventListener("input", (e) => { state.weight = +e.target.value; save(); });

// ── Animate: sources ──
const video = $("#video");
let capActive = false;
let trackers = null;
let stream = null;
let lastTs = 0;
let lastVideoTime = -1;
let lastResult = null;
const pip = $("#pip"), pipCtx = $("#pipCanvas").getContext("2d");

function setSrc(src) {
  state.src = src;
  $$("#srcTabs button").forEach((b) => b.classList.toggle("on", b.dataset.src === src));
  $$("[data-src-panel]").forEach((p) => (p.hidden = p.dataset.srcPanel !== src));
  $("#captureOpts").hidden = src === "cursor";
  // a mirror feels right for a webcam; a clip should play the right way round
  if (src !== "cursor") $("#mirrorOn").checked = state.mirror = src === "webcam";
  stopCapture();
  if (src !== "cursor") startSource(src);
}
$$("#srcTabs button").forEach((b) => b.addEventListener("click", () => setSrc(b.dataset.src)));
$("#follow").addEventListener("input", (e) => (state.follow = +e.target.value));
$("#bodyFollow").addEventListener("change", (e) => (state.bodyFollow = e.target.checked));
$("#mirrorOn").addEventListener("change", (e) => (state.mirror = e.target.checked));
$("#legsMode").addEventListener("change", (e) => (state.legs = e.target.value));
$("#smoothing").addEventListener("input", (e) => (state.smoothing = +e.target.value));

const status = (s) => ($("#capStatus").textContent = s);

async function ensureTrackers() {
  if (trackers) return trackers;
  const { loadTrackers } = await import("./capture.js");
  trackers = await loadTrackers(status);
  return trackers;
}

let videoUrl = null;
async function startSource(src) {
  if (src === "webcam") {
    $("#camBtn").textContent = stream ? "Stop webcam" : "Start webcam";
    if (!stream) return;
  }
  if (src === "video" && !videoUrl) return status("Choose a clip to start.");
  if (src === "video") {
    video.srcObject = null;
    video.src = videoUrl;
    video.loop = true;
    if ($("#videoPlay").checked) await video.play().catch(() => {});
  }
  try {
    await ensureTrackers();
  } catch (e) {
    status(`Could not load the trackers: ${e.message || e}. Check your connection and try again.`);
    return;
  }
  capActive = true;
  pip.hidden = false;
  $("#pipLabel").textContent = src === "webcam" ? "Webcam · on device" : "Video · on device";
  status("Tracking. Step back so your shoulders and arms are in frame.");
}
function stopCapture() {
  capActive = false;
  capTarget = null;
  capFace = null;
  pip.hidden = true;
  if (state.src !== "video" && !video.paused) video.pause();
  if (state.src === "video" && state.step !== "animate") video.pause();
}
$("#camBtn").addEventListener("click", async () => {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    stopCapture();
    $("#camBtn").textContent = "Start webcam";
    status("Webcam off.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
  } catch (e) {
    status(e.name === "NotAllowedError" ? "Camera access was blocked. Allow it in the address bar, then try again." : `No camera available: ${e.message || e}`);
    return;
  }
  video.src = "";
  video.srcObject = stream;
  await video.play().catch(() => {});
  $("#camBtn").textContent = "Stop webcam";
  status("Loading the trackers…");
  startSource("webcam");
});
$("#videoFile").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(f);
  e.target.value = "";
  status("Loading the trackers…");
  startSource("video");
});
$("#videoPlay").addEventListener("change", (e) => (e.target.checked ? video.play().catch(() => {}) : video.pause()));

function captureTick(now) {
  if (!trackers || video.readyState < 2) return;
  if (video.currentTime !== lastVideoTime || state.src === "webcam") {
    lastVideoTime = video.currentTime;
    const ts = Math.max(lastTs + 1, Math.round(now));
    lastTs = ts;
    const res = (lastResult = trackersApi.track(trackers, video, ts));
    if (res.pose) capTarget = poseFromLandmarks(state.spec, res.pose, { mirror: state.mirror, legs: state.legs === "off" ? "never" : state.legs });
    const face = res.face ? faceFromResult(res.face, state.mirror) : null;
    if (face) capFace = face;
    if (!res.pose && !res.face) status("Looking for a person…");
    else status(res.pose ? (res.face ? "Tracking body and face." : "Tracking body. Face the camera for the head and expressions.") : "Tracking face. Step back to show your shoulders and arms.");
  }
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const pc = $("#pipCanvas");
  const ph = Math.round((pc.width * vh) / vw);
  if (pc.height !== ph) pc.height = ph;
  trackersApi.drawPreview(pipCtx, video, lastResult, pc.width, pc.height, state.mirror && state.src === "webcam", ACCENT);
}
let trackersApi = null;
import("./capture.js").then((m) => (trackersApi = m));

// ── Record ──
let rec = null;
function toggleRecord() {
  if (rec) {
    rec.stop();
    return;
  }
  const mime = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) return toast("This browser can't record the canvas.");
  const s = canvas.captureStream(60);
  const chunks = [];
  rec = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    download(blob, `${slug()}-${stamp()}.${mime.includes("mp4") ? "mp4" : "webm"}`);
    rec = null;
    $("#recBtn").classList.remove("rec");
    $("#recBtn span").textContent = "Record";
  };
  rec.start(250);
  $("#recBtn").classList.add("rec");
  $("#recBtn span").textContent = "Stop";
  toast("Recording the stage. Press R or Stop to save.");
}
$("#recBtn").addEventListener("click", toggleRecord);

// ── Export ──
const slug = () => (state.spec.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("#exportBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#exportMenu").hidden = !$("#exportMenu").hidden;
});
document.addEventListener("click", () => ($("#exportMenu").hidden = true));
$("#exportMenu").addEventListener("click", (e) => e.stopPropagation());
$$("[data-export]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#exportMenu").hidden = true;
    const kind = b.dataset.export;
    if (kind === "json") {
      download(new Blob([JSON.stringify({ spec: state.spec, strokes: state.strokes, mode: state.mode }, null, 2)], { type: "application/json" }), `${slug()}.json`);
      return;
    }
    const w = kind === "sheet" ? 3200 : Math.round(W * 2), h = kind === "sheet" ? 1600 : Math.round(H * 2);
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const c = off.getContext("2d");
    const prev = { step: state.step, view: state.view, charTab: state.charTab };
    if (kind === "sheet") Object.assign(state, { step: "rig", view: "sheet" });
    drawScene(c, w, h, kind === "sheet" ? restPose(state.spec) : pose, { forExport: true });
    Object.assign(state, prev);
    off.toBlob((blob) => download(blob, `${slug()}-${kind === "sheet" ? "turnaround" : "stage"}.png`), "image/png");
  }),
);
$("#openJson").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  $("#exportMenu").hidden = true;
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    state.spec = normalize(d.spec ?? d);
    state.strokes = Array.isArray(d.strokes) ? d.strokes : [];
    state.mode = d.mode === "drawn" && state.strokes.length ? "drawn" : "spec";
    if (state.mode === "drawn") rig = bindDrawing(state.strokes, state.spec);
    buildForm();
    save();
    toast(`Opened ${state.spec.name}.`);
  } catch {
    toast("That file isn't a Line Rig character.");
  }
});

// ── Keys ──
window.addEventListener("keydown", (e) => {
  if (e.target.closest("textarea, input")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("#undoBtn").click(); }
  else if (e.key === "r" || e.key === "R") toggleRecord();
  else if (e.key === "1") setStep("character");
  else if (e.key === "2") setStep("rig");
  else if (e.key === "3") setStep("animate");
  else if (isDrawing() && (e.key === "p" || e.key === "e")) $(`[data-tool="${e.key === "p" ? "pen" : "erase"}"]`).click();
});

// ── Init ──
buildForm();
setCharTab(state.charTab);
$$("#themeSeg button").forEach((x) => x.classList.toggle("on", x.dataset.theme === state.theme));
$("#fillsOn").checked = state.fills;
$("#weight").value = state.weight;
$("#bonesOn").checked = state.bones;
$$("#viewTabs button").forEach((x) => x.classList.toggle("on", x.dataset.view === state.view));
$("#yawRow").hidden = $("#spinRow").hidden = state.view !== "spin";
$("#yaw").value = state.yaw;
$("#yawOut").textContent = `${state.yaw}°`;
$("#mirrorOn").checked = state.mirror;
$("#legsMode").value = state.legs;
$("#smoothing").value = state.smoothing;
$("#follow").value = state.follow;
$("#bodyFollow").checked = state.bodyFollow;
setSrc(state.src);
setStep(state.step);
requestAnimationFrame(frame);

// for automated checks
window.__lineRig = { state, setStep, setSrc, setCharTab, get pose() { return pose; }, get capTarget() { return capTarget; }, get capFace() { return capFace; }, startVideoUrl(u) { videoUrl = u; setSrc("video"); } };
