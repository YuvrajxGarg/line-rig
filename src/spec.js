// A character is a small JSON spec. Every part is drawn by hand-written code
// from it, so any spec (picked, described, or measured from a drawing) gets
// the same full rig: front, three-quarter, side and back views.

export const OPTIONS = {
  head: ["round", "oval", "square", "bean"],
  hair: ["short", "buzz", "bob", "long", "spiky", "curly", "bun", "ponytail", "mohawk", "bald"],
  eyes: ["dot", "open", "wide", "sleepy", "happy"],
  brows: ["line", "thick", "none"],
  nose: ["button", "long", "pointy", "none"],
  mouth: ["line", "smile", "flat", "small"],
  top: ["tee", "hoodie", "jacket", "shirt", "tank", "dress"],
  bottom: ["pants", "shorts", "skirt"],
  shoes: ["sneakers", "boots", "none"],
  extras: ["glasses", "cap", "headphones", "beard", "moustache", "freckles", "scarf"],
};

export const LABELS = {
  head: "Head", hair: "Hair", eyes: "Eyes", brows: "Brows", nose: "Nose", mouth: "Mouth",
  top: "Top", bottom: "Bottom", shoes: "Shoes", extras: "Extras",
};

export const SHAPE = [
  { k: "headSize", label: "Head size", min: 0.8, max: 1.6, step: 0.01, def: 1.4 },
  { k: "height", label: "Height", min: 0.8, max: 1.2, step: 0.01, def: 1 },
  { k: "shoulders", label: "Shoulders", min: 0.7, max: 1.4, step: 0.01, def: 1 },
  { k: "hips", label: "Hips", min: 0.7, max: 1.4, step: 0.01, def: 1 },
  { k: "limbs", label: "Limb weight", min: 0.6, max: 1.6, step: 0.01, def: 1 },
  { k: "legs", label: "Leg length", min: 0.75, max: 1.25, step: 0.01, def: 1 },
];

export const COLORS = { skin: "#ffffff", hair: "#1a1a1a", top: "#ffffff", bottom: "#ffffff", shoes: "#ffffff", accent: "#ffc93c" };

export function defaultSpec() {
  return {
    name: "Rio",
    head: "round",
    hair: "short",
    eyes: "dot",
    brows: "line",
    nose: "button",
    mouth: "smile",
    top: "tee",
    bottom: "pants",
    shoes: "sneakers",
    extras: [],
    shape: Object.fromEntries(SHAPE.map((p) => [p.k, p.def])),
    colors: { ...COLORS },
  };
}

const pick = (v, list, def) => (list.includes(v) ? v : def);
const num = (v, p) => (Number.isFinite(+v) ? Math.min(p.max, Math.max(p.min, +v)) : p.def);
const hex = (v, def) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : def);

/** Turn anything (Claude output, saved JSON, hand edits) into a valid spec. */
export function normalize(raw) {
  const d = defaultSpec();
  const s = raw && typeof raw === "object" ? raw : {};
  const out = { name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 40) : d.name };
  for (const k of ["head", "hair", "eyes", "brows", "nose", "mouth", "top", "bottom", "shoes"]) out[k] = pick(s[k], OPTIONS[k], d[k]);
  out.extras = Array.isArray(s.extras) ? [...new Set(s.extras.filter((e) => OPTIONS.extras.includes(e)))] : [];
  out.shape = Object.fromEntries(SHAPE.map((p) => [p.k, num(s.shape?.[p.k], p)]));
  out.colors = Object.fromEntries(Object.keys(COLORS).map((k) => [k, hex(s.colors?.[k], d.colors[k])]));
  return out;
}

export const PRESETS = [
  defaultSpec(),
  normalize({ name: "Mira", hair: "long", eyes: "open", nose: "pointy", mouth: "small", top: "dress", bottom: "skirt", shoes: "boots", extras: ["freckles"], shape: { headSize: 1.3, shoulders: 0.88, hips: 1.05 }, colors: { hair: "#1a1a1a", top: "#ffc93c" } }),
  normalize({ name: "Kabir", head: "square", hair: "curly", eyes: "sleepy", brows: "thick", nose: "long", mouth: "flat", top: "hoodie", bottom: "pants", extras: ["beard", "headphones"], shape: { headSize: 1.15, shoulders: 1.15, limbs: 1.15 }, colors: { top: "#1a1a1a" } }),
  normalize({ name: "Tara", head: "oval", hair: "bun", eyes: "wide", nose: "button", mouth: "smile", top: "jacket", bottom: "shorts", extras: ["glasses"], shape: { headSize: 1.4, legs: 0.95 } }),
  normalize({ name: "Zed", head: "bean", hair: "spiky", eyes: "happy", nose: "none", mouth: "line", top: "tank", bottom: "shorts", extras: ["cap"], shape: { headSize: 1.5, height: 0.92, limbs: 0.85 }, colors: { hair: "#ffffff" } }),
];
