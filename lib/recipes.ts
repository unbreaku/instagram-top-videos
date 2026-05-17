/**
 * "Recipes engine": cross-references the star account's DNA with the top-
 * performing patterns of guide accounts, and surfaces actionable gaps the
 * star could exploit.
 *
 * Two-stage pipeline:
 *   1) Quantitative gap analysis in JS (no LLM): which format_tags are
 *      common in guides but absent from star? Which guide hooks have
 *      outsized engagement vs star's baseline?
 *   2) Sonnet generates 5-8 "recipes" (actionable content templates) using
 *      the gap data + star's voice DNA so suggestions sound like the star.
 *
 * Each recipe has: title, premise, format suggestion, hook template, why
 * (cited evidence), confidence (0-100).
 */

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

export interface Recipe {
  title: string;
  premise: string;
  format_suggestion: string;
  hook_template: string;
  why: string;
  confidence: number;
  source_guides: string[];
  format_tag: string | null;
}

export interface RecipesPayload {
  recipes: Recipe[];
  gap_analysis: {
    star_top_format_tags: Array<{ tag: string; count: number; avg_views: number }>;
    guides_top_format_tags: Array<{ tag: string; count: number; avg_views: number }>;
    star_missing_tags: Array<{ tag: string; guide_avg_views: number; guide_count: number; guides: string[] }>;
    star_strong_tags: Array<{ tag: string; star_avg_views: number; star_count: number }>;
  };
  generated_at: string;
  llm_model: string;
  star_post_count: number;
  guide_post_count: number;
}

interface VideoLite {
  account_username: string;
  shortcode: string;
  hook: string | null;
  cta: string | null;
  format_tags: string[] | null;
  latest_views: number | null;
  latest_likes: number | null;
}

interface StarDissectionLite {
  voice: { tone: string; register: string; summary: string };
  pillars: Array<{ theme: string; percentage: number }>;
  dna_summary: string;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, x) => s + x, 0) / nums.length;
}

/**
 * Aggregates a corpus by format_tag → count + avg views.
 * Only counts videos with >0 views (excludes photos/unviewed).
 */
interface TagAggregate {
  count: number;
  avg_views: number;
  usernames: Set<string>;
  hooks: string[];
}

function aggregateByTag(videos: VideoLite[]): Map<string, TagAggregate> {
  const out = new Map<
    string,
    { count: number; views: number[]; usernames: Set<string>; hooks: string[] }
  >();
  for (const v of videos) {
    if (!v.format_tags || v.format_tags.length === 0) continue;
    const views = v.latest_views || 0;
    if (views <= 0) continue;
    for (const t of v.format_tags) {
      if (!out.has(t)) {
        out.set(t, { count: 0, views: [], usernames: new Set(), hooks: [] });
      }
      const e = out.get(t)!;
      e.count += 1;
      e.views.push(views);
      e.usernames.add(v.account_username);
      if (v.hook && e.hooks.length < 5) e.hooks.push(v.hook);
    }
  }
  // Convert to final shape. Explicit tuple type annotation prevents TS strict
  // from widening to `(string | TagAggregate)[]`, which would make `new Map`
  // reject the iterable on Vercel's build.
  const entries: [string, TagAggregate][] = [];
  for (const [tag, e] of out.entries()) {
    entries.push([
      tag,
      {
        count: e.count,
        avg_views: Math.round(avg(e.views)),
        usernames: e.usernames,
        hooks: e.hooks,
      },
    ]);
  }
  return new Map(entries);
}

export async function generateRecipes(
  starUsername: string,
  starVideos: VideoLite[],
  guideVideos: VideoLite[],
  starDissection: StarDissectionLite,
): Promise<RecipesPayload> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");

  // Stage 1: gap analysis (deterministic, no LLM)
  const starAgg = aggregateByTag(starVideos);
  const guideAgg = aggregateByTag(guideVideos);

  // Top format tags for star
  const starTop = [...starAgg.entries()]
    .sort((a, b) => b[1].avg_views - a[1].avg_views)
    .slice(0, 10)
    .map(([tag, e]) => ({ tag, count: e.count, avg_views: e.avg_views }));

  // Top format tags for guides
  const guidesTop = [...guideAgg.entries()]
    .sort((a, b) => b[1].avg_views - a[1].avg_views)
    .slice(0, 15)
    .map(([tag, e]) => ({ tag, count: e.count, avg_views: e.avg_views }));

  // Star MISSING tags: high-performing in guides, star uses 0 or <=2 times
  // and at least 2 guides use it (so it's a real pattern, not one-off).
  const starMissing: RecipesPayload["gap_analysis"]["star_missing_tags"] = [];
  for (const [tag, gEntry] of guideAgg.entries()) {
    const sEntry = starAgg.get(tag);
    const starUses = sEntry?.count ?? 0;
    if (starUses > 2) continue;
    if (gEntry.usernames.size < 2) continue;
    if (gEntry.count < 3) continue;
    starMissing.push({
      tag,
      guide_avg_views: gEntry.avg_views,
      guide_count: gEntry.count,
      guides: [...gEntry.usernames],
    });
  }
  starMissing.sort((a, b) => b.guide_avg_views - a.guide_avg_views);
  const starMissingTop = starMissing.slice(0, 15);

  // Star STRONG tags: where star already crushes (avg views > 1.5× their own
  // mean view count). These are formats Pablo should DOUBLE down on.
  const starOverallAvg = avg(
    starVideos.map((v) => v.latest_views || 0).filter((x) => x > 0),
  );
  const starStrong: RecipesPayload["gap_analysis"]["star_strong_tags"] = [];
  for (const [tag, sEntry] of starAgg.entries()) {
    if (sEntry.count < 2) continue;
    if (sEntry.avg_views < starOverallAvg * 1.5) continue;
    starStrong.push({
      tag,
      star_avg_views: sEntry.avg_views,
      star_count: sEntry.count,
    });
  }
  starStrong.sort((a, b) => b.star_avg_views - a.star_avg_views);
  const starStrongTop = starStrong.slice(0, 10);

  // Stage 2: LLM turns the gap data into actionable recipes
  // We feed it: star DNA summary, star strong tags, missing tags w/ guides,
  // and ask for 5-8 recipes Pablo could try.
  const userMessage = `Cuenta estrella: @${starUsername}

DNA del creador (resumen):
${starDissection.dna_summary}

Voz: ${starDissection.voice.tone} — ${starDissection.voice.register}

Pilares temáticos: ${starDissection.pillars.map((p) => `${p.theme} (${p.percentage}%)`).join(", ")}

DATOS DURO 1 — formatos donde la estrella YA RINDE (≥1.5× su promedio de views):
${starStrongTop.length === 0 ? "(ninguno destacado todavía)" : starStrongTop.map((s) => `  • ${s.tag}: ${s.star_count} posts, avg ${s.star_avg_views.toLocaleString()} views`).join("\n")}

DATOS DURO 2 — formatos que MÚLTIPLES GUIDES usan exitosamente y la estrella NO usa (≤2 veces):
${starMissingTop.length === 0 ? "(ninguno; la estrella ya cubre todo lo que hacen los guides)" : starMissingTop.slice(0, 10).map((g) => `  • ${g.tag}: ${g.guide_count} posts en ${g.guides.length} guides (${g.guides.join(", ")}), avg ${g.guide_avg_views.toLocaleString()} views`).join("\n")}

DATOS DURO 3 — ejemplos de hooks que funcionan para guides con formatos similares (top 5 por views):
${guideVideos
  .filter((v) => v.hook && (v.latest_views ?? 0) > 0)
  .sort((a, b) => (b.latest_views ?? 0) - (a.latest_views ?? 0))
  .slice(0, 5)
  .map(
    (v) =>
      `  • @${v.account_username} (${(v.latest_views ?? 0).toLocaleString()} views, tags: ${(v.format_tags || []).join(",")}): "${v.hook}"`,
  )
  .join("\n")}`;

  const SYSTEM_PROMPT = `Eres un estratega de contenido para una cuenta de Instagram que quiere crecer.
Te paso el DNA del creador estrella + análisis cuantitativo de qué hacen los
guides que él no. Tu trabajo es generar 5-8 RECETAS accionables que el
creador estrella pueda probar la próxima semana.

Cada receta debe estar adaptada a la VOZ del creador estrella (no inventes
una voz nueva). Citas evidencia real del análisis cuantitativo.

Devuelves SOLO JSON válido con la forma:

{
  "recipes": [
    {
      "title": "Título corto y memorable (≤80 chars). Imperativo o promesa.",
      "premise": "1 oración: ¿qué hipótesis estamos probando? ¿por qué creemos que va a funcionar?",
      "format_suggestion": "Descripción concreta de cómo construir el post (estructura, beats, formato visual sugerido). 2-4 oraciones.",
      "hook_template": "Un hook PARAFRASEADO en la voz del creador. NO copies el hook de un guide. Adaptalo al tono que el DNA describe.",
      "why": "Por qué esta receta tiene sentido. Cita números reales del análisis: 'Guide X y Y promedian Z views con este formato; tu mejor promedio es W'.",
      "confidence": número 0-100,
      "source_guides": ["lista de guides cuya evidencia respalda esta receta"],
      "format_tag": "el format_tag relevante (o null si la receta es más conceptual)"
    }
  ]
}

Reglas:
- 5-8 recetas, no más, no menos.
- Mezclá: (a) DOBLAR donde la estrella ya rinde, (b) PROBAR formatos missing de guides, (c) opcionalmente una sobre cadence/temas si ves un patrón claro.
- confidence alto (>75) solo si hay ≥3 guides usando el patrón con buenos números.
- NO sugerencias genéricas ("subí más calidad"). Cada receta es un experimento concreto que se puede ejecutar mañana.
- source_guides: solo guides que aparecen en los datos duros que te pasé.
- NO uses markdown, solo JSON.`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
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
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: { recipes?: Recipe[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 300)}`);
    parsed = JSON.parse(m[0]);
  }

  const recipes = (parsed.recipes ?? []).map((r) => ({
    title: r.title ?? "",
    premise: r.premise ?? "",
    format_suggestion: r.format_suggestion ?? "",
    hook_template: r.hook_template ?? "",
    why: r.why ?? "",
    confidence:
      typeof r.confidence === "number"
        ? Math.max(0, Math.min(100, Math.round(r.confidence)))
        : 50,
    source_guides: Array.isArray(r.source_guides) ? r.source_guides : [],
    format_tag: r.format_tag ?? null,
  }));

  return {
    recipes,
    gap_analysis: {
      star_top_format_tags: starTop,
      guides_top_format_tags: guidesTop,
      star_missing_tags: starMissingTop,
      star_strong_tags: starStrongTop,
    },
    generated_at: new Date().toISOString(),
    llm_model: MODEL,
    star_post_count: starVideos.length,
    guide_post_count: guideVideos.length,
  };
}
