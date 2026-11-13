// Description → character spec. Tries Claude (api/character.js) when the
// page is served with that function; otherwise matches words locally, so
// describing works offline too.
import { defaultSpec, normalize } from "./spec.js";

const WORDS = [
  [/\b(bald|shaved head)\b/, { hair: "bald" }],
  [/\bbuzz|crew ?cut\b/, { hair: "buzz" }],
  [/\bbob\b/, { hair: "bob" }],
  [/\blong hair|long-haired|flowing hair\b/, { hair: "long" }],
  [/\bspik(y|es)|punk\b/, { hair: "spiky" }],
  [/\bcurl(y|s)|afro\b/, { hair: "curly" }],
  [/\bbun\b/, { hair: "bun" }],
  [/\bpony ?tail\b/, { hair: "ponytail" }],
  [/\bmohawk\b/, { hair: "mohawk" }],
  [/\bsquare (jaw|head)|blocky|robot\b/, { head: "square" }],
  [/\boval|long face\b/, { head: "oval" }],
  [/\bbean|goofy\b/, { head: "bean" }],
  [/\bsleepy|tired|bored|chill\b/, { eyes: "sleepy", mouth: "flat" }],
  [/\bhappy|cheerful|joyful|smiling\b/, { eyes: "happy", mouth: "smile" }],
  [/\bsurprised|curious|wide[- ]eyed|anime\b/, { eyes: "wide" }],
  [/\bserious|grumpy|stern\b/, { eyes: "open", brows: "thick", mouth: "flat" }],
  [/\bpointy nose|witch|sharp\b/, { nose: "pointy" }],
  [/\blong nose|big nose\b/, { nose: "long" }],
  [/\bhood(ie)?\b/, { top: "hoodie" }],
  [/\bjacket|blazer|coat\b/, { top: "jacket" }],
  [/\bshirt|office|formal\b/, { top: "shirt" }],
  [/\btank|vest|gym|athlete\b/, { top: "tank", bottom: "shorts" }],
  [/\bdress\b/, { top: "dress" }],
  [/\bskirt\b/, { bottom: "skirt" }],
  [/\bshorts|summer|beach\b/, { bottom: "shorts" }],
  [/\bboots|hiker|explorer\b/, { shoes: "boots" }],
  [/\bbarefoot\b/, { shoes: "none" }],
  [/\btall|lanky\b/, { shape: { height: 1.15, legs: 1.12, headSize: 1.1 } }],
  [/\b(short(?! hair)|small|tiny|kid|child|chibi)\b/, { shape: { height: 0.88, headSize: 1.5, legs: 0.85 } }],
  [/\bstrong|buff|muscular|big\b/, { shape: { shoulders: 1.3, limbs: 1.35 } }],
  [/\bskinny|thin|slim\b/, { shape: { limbs: 0.75, shoulders: 0.88 } }],
];
const EXTRAS = { glasses: /\bglasses|specs|nerd|scientist\b/, cap: /\bcap|hat\b/, headphones: /\bheadphones|dj|music\b/, beard: /\bbeard(ed)?\b/, moustache: /\bmou?stache\b/, freckles: /\bfreckle/, scarf: /\bscarf|winter\b/ };
const COLORS = { red: "#e5484d", orange: "#f76b15", yellow: "#ffc93c", green: "#30a46c", blue: "#3e63dd", purple: "#8e4ec6", pink: "#e93d82", black: "#1a1a1a", white: "#ffffff", grey: "#8b8d98", gray: "#8b8d98", brown: "#8a5a3b", blonde: "#f2c94c", ginger: "#d9622b" };

export function describeLocal(text) {
  const t = ` ${text.toLowerCase()} `;
  let spec = defaultSpec();
  spec.extras = [];
  for (const [re, patch] of WORDS) if (re.test(t)) spec = { ...spec, ...patch, shape: { ...spec.shape, ...(patch.shape ?? {}) } };
  for (const [k, re] of Object.entries(EXTRAS)) if (re.test(t)) spec.extras.push(k);
  // "red hoodie", "blonde hair", "blue pants"
  for (const [c, hex] of Object.entries(COLORS)) {
    const m = t.match(new RegExp(`\\b${c}\\s+(\\w+)`));
    if (!m) continue;
    const what = m[1];
    if (/hair|curls|bun|ponytail|mohawk/.test(what)) spec.colors.hair = hex;
    else if (/pants|jeans|shorts|skirt|trousers/.test(what)) spec.colors.bottom = hex;
    else if (/shoes|sneakers|boots/.test(what)) spec.colors.shoes = hex;
    else if (/cap|hat|headphones|scarf/.test(what)) spec.colors.accent = hex;
    else spec.colors.top = hex;
  }
  if (/\bblonde\b/.test(t) && spec.colors.hair === "#1a1a1a") spec.colors.hair = COLORS.blonde;
  const name = text.match(/\b(?:named|called)\s+([A-Z][a-z]+)/);
  const NAMES = ["Ivo", "Noor", "Pip", "Kai", "Lumi", "Otto", "Sana", "Juno", "Remy", "Tavi", "Wren", "Ezra"];
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  spec.name = name ? name[1] : NAMES[hash % NAMES.length];
  return normalize(spec);
}

export async function describe(text) {
  try {
    const r = await fetch("api/character", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text }) });
    if (r.ok) {
      const { spec } = await r.json();
      if (spec) return { spec: normalize(spec), via: "claude" };
    }
  } catch {
    /* no function here: fall through */
  }
  return { spec: describeLocal(text), via: "local" };
}
