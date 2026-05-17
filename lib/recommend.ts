/**
 * Recommendation scoring for "should I copy this video?"
 *
 * Combines three orthogonal signals:
 *   1. PERFORMANCE   — how viral the post was *within* this account.
 *                      Normalized 0..1 against the account's own ceiling so
 *                      we don't punish small creators for not having millions.
 *   2. REPRODUCIBILITY — do we actually have what we'd need to clone it?
 *                      Transcript + hook + CTA + format tags.
 *   3. CROSS-CREATOR VALIDATION — is the format something multiple creators
 *                      use? A pattern used by 3 accounts is more likely to be
 *                      a template than a one-off win.
 *
 * Returned `total` is 0..100 so it shows nicely in the UI. We also return
 * the raw component scores + plain-language reasons so the user can see
 * *why* the algorithm recommended (or didn't recommend) a post.
 */

export interface ScoreBreakdown {
  performance: number;
  reproducibility: number;
  cross_creator: number;
  total: number;
  reasons: string[];
  warnings: string[];
}

interface ScorableVideo {
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  // Made optional: callers no longer always pass the transcript text (bulk
  // /videos endpoint stripped it to avoid response-size truncation bugs).
  // The scorer only reads !!transcript for the reproducibility heuristic,
  // so undefined / null / "" all behave the same.
  transcript?: string | null;
  hook: string | null;
  cta: string | null;
  format_tags: string[] | null;
  analyzed_at: string | null;
}

const W_PERFORMANCE = 0.55;
const W_REPRODUCIBILITY = 0.3;
const W_CROSS = 0.15;

export function scoreVideoForCopy(
  v: ScorableVideo,
  accountMaxViews: number,
  sharedTags: Set<string>,
): ScoreBreakdown {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // ---- 1) PERFORMANCE
  const perf =
    accountMaxViews > 0
      ? Math.min(1, (v.latest_views || 0) / accountMaxViews)
      : 0;
  if (perf >= 0.8)
    reasons.push(`Top ~${Math.max(1, Math.round((1 - perf) * 100))}% por vistas en esta cuenta`);
  else if (perf >= 0.4)
    reasons.push(`Performance arriba del promedio para esta cuenta`);
  else warnings.push("Vistas debajo del promedio de la cuenta");

  // ---- 2) REPRODUCIBILITY
  let repro = 0;
  if (v.transcript && v.transcript.length > 30) {
    repro += 0.4;
    reasons.push("transcript completo disponible");
  } else {
    warnings.push("sin transcript (no se puede recrear el guión palabra por palabra)");
  }
  if (v.hook) {
    repro += 0.3;
    reasons.push("hook identificado");
  } else if (v.analyzed_at) {
    warnings.push("analizado pero no se detectó hook claro");
  } else {
    warnings.push("no analizado aún");
  }
  if (v.cta) {
    repro += 0.2;
    reasons.push("CTA claro");
  }
  if (v.format_tags && v.format_tags.length > 0) {
    repro += 0.1;
    reasons.push(`${v.format_tags.length} tags de formato`);
  }

  // ---- 3) CROSS-CREATOR VALIDATION
  const tags = v.format_tags || [];
  let cross = 0;
  if (tags.length > 0) {
    const sharedCount = tags.filter((t) => sharedTags.has(t)).length;
    cross = sharedCount / tags.length;
    if (cross >= 0.5)
      reasons.push(
        `${sharedCount}/${tags.length} formatos también los usan otras cuentas (señal fuerte de template)`,
      );
  }

  const total = Math.round(
    (W_PERFORMANCE * perf +
      W_REPRODUCIBILITY * repro +
      W_CROSS * cross) *
      100,
  );

  return {
    performance: perf,
    reproducibility: repro,
    cross_creator: cross,
    total,
    reasons,
    warnings,
  };
}

export function scoreLabel(score: number): {
  label: string;
  color: string;
  emoji: string;
} {
  if (score >= 75)
    return { label: "Imperdible", color: "text-emerald-700", emoji: "🏆" };
  if (score >= 55)
    return { label: "Recomendado", color: "text-emerald-600", emoji: "✨" };
  if (score >= 35)
    return { label: "Mirar", color: "text-amber-700", emoji: "👀" };
  return { label: "Saltar", color: "text-zinc-400", emoji: "·" };
}
