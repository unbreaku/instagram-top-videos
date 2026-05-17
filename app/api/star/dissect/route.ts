import { NextResponse } from "next/server";
import { dissectStar } from "@/lib/star-dissect";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/star/dissect → returns the cached dissection on the star
 *                         account, or 404 if not run yet.
 * POST /api/star/dissect → runs the dissection now and caches it.
 *
 * Only works while there is exactly one account with account_role='star'.
 */

async function getStar(sb: ReturnType<typeof getServerSupabase>) {
  const { data } = await sb
    .from("accounts")
    .select("username, display_name, profile_pic_url, star_dissection")
    .eq("account_role", "star")
    .maybeSingle();
  return data;
}

export async function GET() {
  const sb = getServerSupabase();
  const star = await getStar(sb);
  if (!star) {
    return NextResponse.json(
      { error: "No hay cuenta estrella configurada. Marcá una en /accounts." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    account: {
      username: star.username,
      display_name: star.display_name,
      profile_pic_url: star.profile_pic_url,
    },
    dissection: star.star_dissection ?? null,
  });
}

export async function POST() {
  const sb = getServerSupabase();
  const star = await getStar(sb);
  if (!star) {
    return NextResponse.json(
      { error: "No hay cuenta estrella configurada. Marcá una en /accounts." },
      { status: 404 },
    );
  }

  // Pull the corpus. We include only posts with at least a hook OR caption OR
  // transcript so the LLM has something to work with. No 90d window for star.
  const { data: videos, error } = await sb
    .from("videos")
    .select(
      "shortcode, caption, posted_at, type, latest_views, latest_likes, hook, cta, transcript, format_tags",
    )
    .eq("account_username", star.username)
    .order("latest_views", { ascending: false, nullsFirst: false })
    .order("shortcode", { ascending: true })
    .limit(999);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const usable = (videos || []).filter(
    (v) => v.caption || v.hook || v.transcript,
  );
  if (usable.length === 0) {
    return NextResponse.json(
      {
        error:
          "El corpus está vacío: la cuenta star no tiene posts con caption / hook / transcript todavía. Esperá a que termine el scrape histórico y el drenado de transcripts.",
      },
      { status: 400 },
    );
  }

  // Window: from oldest post to today, in days.
  const oldest = Math.min(
    ...usable
      .filter((v) => v.posted_at)
      .map((v) => new Date(v.posted_at!).getTime()),
  );
  const windowDays = Math.max(
    1,
    Math.round((Date.now() - oldest) / (24 * 3600 * 1000)),
  );

  let dissection;
  try {
    dissection = await dissectStar(usable, windowDays);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `LLM dissect: ${msg}` },
      { status: 500 },
    );
  }

  // Cache on the account row.
  await sb
    .from("accounts")
    .update({ star_dissection: dissection })
    .eq("username", star.username);

  return NextResponse.json({
    account: {
      username: star.username,
      display_name: star.display_name,
      profile_pic_url: star.profile_pic_url,
    },
    dissection,
  });
}
