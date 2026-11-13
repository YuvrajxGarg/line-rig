// Optional: turns a description into a character spec with Claude.
// Needs ANTHROPIC_API_KEY in the deployment's env. Without it the app uses
// its built-in word matcher, so the page always works with no server.
import Anthropic from "@anthropic-ai/sdk";
import { OPTIONS, SHAPE, normalize } from "../src/spec.js";

const enumOf = (k) => ({ type: "string", enum: OPTIONS[k] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "head", "hair", "eyes", "brows", "nose", "mouth", "top", "bottom", "shoes", "extras", "shape", "colors"],
  properties: {
    name: { type: "string" },
    ...Object.fromEntries(["head", "hair", "eyes", "brows", "nose", "mouth", "top", "bottom", "shoes"].map((k) => [k, enumOf(k)])),
    extras: { type: "array", items: enumOf("extras") },
    shape: {
      type: "object",
      additionalProperties: false,
      required: SHAPE.map((p) => p.k),
      properties: Object.fromEntries(SHAPE.map((p) => [p.k, { type: "number" }])),
    },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["skin", "hair", "top", "bottom", "shoes", "accent"],
      properties: Object.fromEntries(["skin", "hair", "top", "bottom", "shoes", "accent"].map((k) => [k, { type: "string" }])),
    },
  },
};

const SYSTEM = `You design minimal 2D line-art characters for a rigging tool. Pick the parts that best match the description.
Shape values are multipliers: ${SHAPE.map((p) => `${p.k} ${p.min}–${p.max} (default ${p.def})`).join(", ")}.
Colours are 6-digit hex flat fills shown in "flat colour" mode; keep a restrained palette (off-white skin #ffffff unless asked, near-black #1a1a1a for dark things, one accent). The name is a short first name that fits.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST a JSON body with a prompt" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "No ANTHROPIC_API_KEY on this deployment" });
  const prompt = String(req.body?.prompt ?? "").trim().slice(0, 1000);
  if (!prompt) return res.status(400).json({ error: "Describe a character first" });
  try {
    const client = new Anthropic({ maxRetries: 1, timeout: 60_000 });
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (msg.stop_reason === "refusal") return res.status(422).json({ error: "Claude declined that description. Try rewording it." });
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return res.status(200).json({ spec: normalize(JSON.parse(text)) });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status ?? 502 : 502;
    return res.status(status).json({ error: e instanceof Error ? e.message : "Generation failed" });
  }
}
