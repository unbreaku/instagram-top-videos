/**
 * Anthropic / Claude Haiku client for extracting structured insights from
 * a video transcript + caption.
 *
 * We ask the model to return JSON with hook (first-3-seconds line), CTA,
 * and 3-7 format_tags describing the structural pattern of the video.
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export interface VideoAnalysis {
  hook: string;
  cta: string;
  format_tags: string[];
}

const SYSTEM_PROMPT = `Eres un analista de contenido viral en Instagram Reels. Tu trabajo es
descomponer un video en su ESTRUCTURA reutilizable, no en su contenido específico.
Devuelves SOLO JSON válido con tres campos:

{
  "hook": "string — la frase exacta o paráfrasis corta (≤140 chars) de lo que se dice o muestra en los primeros 3 segundos. Si no hay transcripción usable, infiere del caption.",
  "cta": "string — la llamada a la acción explícita o implícita al final (≤140 chars). Si no hay, devuelve cadena vacía.",
  "format_tags": ["3-7 tags en kebab-case que describan la ESTRUCTURA del video. Ejemplos: 'pregunta-controversial', 'lista-3-puntos', 'mito-vs-realidad', 'transformacion-antes-despues', 'testimonio-cliente', 'pov-personaje', 'tutorial-paso-a-paso', 'storytime-personal', 'reaccion-a-clip', 'analisis-numerico', 'contraste-opinion-popular', 'cta-comentario', 'cta-guardar', 'cta-compartir', 'cta-perfil'. No uses tags sobre el TEMA, solo sobre la ESTRUCTURA y mecánica."]
}

Reglas:
- Responde SOLO el objeto JSON. Sin markdown, sin texto antes ni después.
- Si el transcript está vacío, usa el caption como única señal.
- Si nada está claro, hook="", cta="", format_tags=[].
- format_tags siempre en español, kebab-case, sin tildes ni espacios.`;

export async function analyzeVideo(input: {
  caption: string | null;
  transcript: string | null;
  durationSeconds: number | null;
}): Promise<VideoAnalysis> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");

  const userMessage = [
    `CAPTION:\n${input.caption || "(vacío)"}`,
    "",
    `TRANSCRIPT:\n${input.transcript || "(no disponible)"}`,
    "",
    `DURACION_SEGUNDOS: ${input.durationSeconds ?? "desconocida"}`,
  ].join("\n");

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }

  const j = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = j.content?.find((c) => c.type === "text")?.text || "";

  // Strip code fences if the model decided to wrap.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: Partial<VideoAnalysis>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: try to find the first {...} blob.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`Claude returned non-JSON: ${cleaned.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }

  return {
    hook: typeof parsed.hook === "string" ? parsed.hook.slice(0, 280) : "",
    cta: typeof parsed.cta === "string" ? parsed.cta.slice(0, 280) : "",
    format_tags: Array.isArray(parsed.format_tags)
      ? parsed.format_tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.toLowerCase().trim())
          .filter(Boolean)
          .slice(0, 10)
      : [],
  };
}
