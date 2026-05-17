/**
 * Star account "DNA" extraction.
 *
 * Takes the entire transcribed corpus of the star account, picks the top
 * 100 by views, summarizes each compactly, and asks Sonnet to extract:
 *   - voice profile (tone, vocab signature, register)
 *   - thematic pillars (what the creator talks about, with proportions)
 *   - hook patterns + best-performing examples
 *   - CTA patterns
 *   - format mix from existing format_tags
 *   - growth/cadence numbers (computed in JS, not LLM)
 *
 * The LLM call uses Sonnet (better at synthesizing patterns across many
 * documents) rather than Haiku. Cost is one-shot per re-run: ~$0.50-$2
 * depending on corpus size.
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const TOP_N_FOR_LLM = 100;

export interface StarDissection {
  voice: {
    tone: string;
    register: string;
    vocabulary_signature: string[];
    summary: string;
  };
  pillars: Array<{
    theme: string;
    percentage: number;
    sample_hooks: string[];
  }>;
  hooks: {
    patterns: string[];
    best_examples: Array<{ hook: string; views: number; shortcode: string }>;
  };
  ctas: {
    patterns: string[];
    coverage_percentage: number;
  };
  format_mix: {
    reels_pct: number;
    sidecar_pct: number;
    image_pct: number;
    other_pct: number;
  };
  cadence: {
    posts_per_week: number;
    total_posts_analyzed: number;
    window_days: number;
  };
  dna_summary: string;
  // Provenance — useful for the UI to show "computed at X, on N posts"
  generated_at: string;
  source_post_count: number;
  llm_model: string;
}

interface VideoForDissection {
  shortcode: string;
  caption: string | null;
  posted_at: string | null;
  type: string | null;
  latest_views: number | null;
  latest_likes: number | null;
  hook: string | null;
  cta: string | null;
  transcript: string | null;
  format_tags: string[] | null;
}

const SYSTEM_PROMPT = `Eres un analista de creadores en Instagram. Te dan el corpus de un creador
(captions + hooks + transcripts de sus mejores videos). Tu trabajo es
extraer el "ADN" del creador en JSON. NO inventes nada — solo describe lo
que está en los datos.

Devolvés SOLO JSON válido (sin markdown, sin texto extra) con esta forma:

{
  "voice": {
    "tone": "breve etiqueta (ej: 'experto-cercano', 'sarcástico-confrontativo', 'didáctico-formal')",
    "register": "frase de ≤140 chars describiendo cómo habla (1ª persona, jerga, ritmo, qué le interesa al lector)",
    "vocabulary_signature": ["6-10 palabras/frases que el creador usa repetidamente y son DISTINTIVAS de él (no palabras comunes del idioma)"],
    "summary": "2-3 oraciones describiendo su voz, como se la describirías a un copywriter"
  },
  "pillars": [
    {
      "theme": "nombre del pilar temático (ej: 'Marketing digital', 'Mindset emprendedor')",
      "percentage": número 0-100 (qué % aprox de su contenido es de este tema),
      "sample_hooks": ["2-3 hooks reales del corpus que ejemplifican este pilar"]
    }
  ],
  "hooks": {
    "patterns": ["4-6 patrones estructurales de hook que el creador usa repetidamente (ej: 'pregunta provocativa al lector', 'estadística contraintuitiva', 'POV de error que comete el lector')"]
  },
  "ctas": {
    "patterns": ["3-5 patrones de CTA que el creador usa (ej: 'pide guardar el post', 'manda a comentar X palabra para link en DM')"],
    "coverage_estimate": número 0-100 (% aprox de posts que tienen CTA explícita)
  },
  "dna_summary": "Un párrafo de 4-6 oraciones que explica QUÉ HACE A ESTE CREADOR ÚNICO. Como si tuvieras que decirle a otro creador 'estudia a X porque hace exactamente esto que nadie más hace'."
}

Reglas:
- 3-6 pilares máximo. Si todo el corpus es del mismo tema, usá 1-2 pilares.
- Los hooks de ejemplo y sample_hooks deben ser TEXTO REAL del corpus, no inventados.
- vocabulary_signature: palabras realmente distintivas. Si no las encontrás, devolvé array vacío.
- No te inventes percentages — estimá basándote en cuántos posts caen en cada pilar.`;

export async function dissectStar(
  videos: VideoForDissection[],
  windowDays: number,
): Promise<StarDissection> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  if (videos.length === 0) {
    throw new Error("No hay videos en el corpus para diseccionar");
  }

  // Computed fields (we don't trust the LLM to count things correctly).
  const totalPosts = videos.length;
  // Format mix from existing types (no LLM needed)
  const typeCounts = videos.reduce<Record<string, number>>((acc, v) => {
    const t = (v.type || "Other").toLowerCase();
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const pct = (n: number) => Math.round((n / totalPosts) * 100);
  const format_mix = {
    reels_pct: pct((typeCounts.reel ?? 0) + (typeCounts.video ?? 0) + (typeCounts.igtv ?? 0)),
    sidecar_pct: pct(typeCounts.sidecar ?? 0),
    image_pct: pct(typeCounts.image ?? 0),
    other_pct: pct(typeCounts.other ?? 0),
  };

  // Cadence: posts/week from oldest to newest post in the corpus
  const dated = videos
    .filter((v) => v.posted_at)
    .map((v) => new Date(v.posted_at!).getTime())
    .sort((a, b) => a - b);
  let postsPerWeek = 0;
  if (dated.length >= 2) {
    const spanMs = dated[dated.length - 1] - dated[0];
    const spanWeeks = Math.max(1, spanMs / (7 * 24 * 3600 * 1000));
    postsPerWeek = +(dated.length / spanWeeks).toFixed(2);
  }

  // Best hook examples (top 10 by views)
  const topByViews = [...videos]
    .filter((v) => v.hook && v.latest_views)
    .sort((a, b) => (b.latest_views ?? 0) - (a.latest_views ?? 0))
    .slice(0, 10);

  // Build compact corpus for the LLM
  const sample = [...videos]
    .sort((a, b) => (b.latest_views ?? 0) - (a.latest_views ?? 0))
    .slice(0, TOP_N_FOR_LLM);

  const corpusText = sample
    .map((v, i) => {
      const cap = (v.caption || "").slice(0, 200).replace(/\n+/g, " ");
      const tr = (v.transcript || "").slice(0, 400).replace(/\n+/g, " ");
      return [
        `--- POST ${i + 1} (views=${v.latest_views ?? "?"}, likes=${v.latest_likes ?? "?"}) ---`,
        v.hook ? `HOOK: ${v.hook}` : "",
        cap ? `CAPTION: ${cap}` : "",
        tr ? `TRANSCRIPT: ${tr}` : "",
        v.cta ? `CTA: ${v.cta}` : "",
        v.format_tags?.length ? `TAGS: ${v.format_tags.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userMessage = [
    `Creador analizado: cuenta estrella de la herramienta de BI.`,
    `Total posts en corpus completo: ${totalPosts}`,
    `Muestra para análisis (top ${sample.length} por views):`,
    "",
    corpusText,
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
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 500)}`);
  }

  const j = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = j.content?.find((c) => c.type === "text")?.text || "";

  // Strip markdown fences if Claude added them.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: {
    voice?: {
      tone?: string;
      register?: string;
      vocabulary_signature?: string[];
      summary?: string;
    };
    pillars?: Array<{
      theme?: string;
      percentage?: number;
      sample_hooks?: string[];
    }>;
    hooks?: { patterns?: string[] };
    ctas?: { patterns?: string[]; coverage_estimate?: number };
    dna_summary?: string;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 300)}`);
    parsed = JSON.parse(m[0]);
  }

  return {
    voice: {
      tone: parsed.voice?.tone ?? "",
      register: parsed.voice?.register ?? "",
      vocabulary_signature: parsed.voice?.vocabulary_signature ?? [],
      summary: parsed.voice?.summary ?? "",
    },
    pillars: (parsed.pillars ?? []).map((p) => ({
      theme: p.theme ?? "",
      percentage:
        typeof p.percentage === "number"
          ? Math.max(0, Math.min(100, Math.round(p.percentage)))
          : 0,
      sample_hooks: p.sample_hooks ?? [],
    })),
    hooks: {
      patterns: parsed.hooks?.patterns ?? [],
      best_examples: topByViews.map((v) => ({
        hook: v.hook!,
        views: v.latest_views ?? 0,
        shortcode: v.shortcode,
      })),
    },
    ctas: {
      patterns: parsed.ctas?.patterns ?? [],
      coverage_percentage:
        typeof parsed.ctas?.coverage_estimate === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.ctas.coverage_estimate)))
          : 0,
    },
    format_mix,
    cadence: {
      posts_per_week: postsPerWeek,
      total_posts_analyzed: totalPosts,
      window_days: windowDays,
    },
    dna_summary: parsed.dna_summary ?? "",
    generated_at: new Date().toISOString(),
    source_post_count: totalPosts,
    llm_model: MODEL,
  };
}
