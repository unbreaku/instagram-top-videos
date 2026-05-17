import { NextResponse } from "next/server";
import { generateRecipes } from "@/lib/recipes";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET  /api/recipes → cached recipes for the current star (or 404).
 * POST /api/recipes → regenerate now. Requires a star with a star_dissection.
 *
 * The engine pulls top-by-views videos from the star (any time) AND from
 * all guides (last 90 days, to bias toward currently-working content),
 * runs gap analysis, then asks Sonnet to author actionable recipes.
 */

const GUIDES_WINDOW_DAYS = 90;
const STAR_MAX_VIDEOS = 200;
const GUIDES_MAX_VIDEOS = 400;

async function getStar(sb: ReturnType<typeof getServerSupabase>) {
  const { data } = await sb
    .from("accounts")
    .select(
      "username, display_name, profile_pic_url, star_dissection, recipes_payload",
    )
    .eq("account_role", "star")
    .maybeSingle();
  return data;
}

export async function GET() {
  const sb = getServerSupabase();
  const star = await getStar(sb);
  if (!star) {
    return NextResponse.json(
      { error: "No hay cuenta estrella configurada." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    account: {
      username: star.username,
      display_name: star.display_name,
      profile_pic_url: star.profile_pic_url,
    },
    recipes: star.recipes_payload ?? null,
  });
}

export async function POST() {
  const sb = getServerSupabase();
  const star = await getStar(sb);
  if (!star) {
    return NextResponse.json(
      { error: "No hay cuenta estrella configurada en /accounts." },
      { status: 404 },
    );
  }
  if (!star.star_dissection) {
    return NextResponse.json(
      {
        error:
          "Primero corré la disección DNA en /star. Las recetas se construyen sobre ella.",
      },
      { status: 400 },
    );
  }

  const guideCutoff = new Date(
    Date.now() - GUIDES_WINDOW_DAYS * 86400 * 1000,
  ).toISOString();

  const [starRes, guidesRes] = await Promise.all([
    sb
      .from("videos")
      .select(
        "account_username, shortcode, hook, cta, format_tags, latest_views, latest_likes",
      )
      .eq("account_username", star.username)
      .not("format_tags", "is", null)
      .order("latest_views", { ascending: false, nullsFirst: false })
      .limit(STAR_MAX_VIDEOS),
    sb
      .from("videos")
      .select(
        "account_username, shortcode, hook, cta, format_tags, latest_views, latest_likes",
      )
      .neq("account_username", star.username)
      .not("format_tags", "is", null)
      .gte("posted_at", guideCutoff)
      .order("latest_views", { ascending: false, nullsFirst: false })
      .limit(GUIDES_MAX_VIDEOS),
  ]);

  if (starRes.error || guidesRes.error) {
    return NextResponse.json(
      { error: starRes.error?.message || guidesRes.error?.message },
      { status: 500 },
    );
  }

  if ((starRes.data || []).length === 0) {
    return NextResponse.json(
      {
        error:
          "La cuenta estrella no tiene posts con format_tags analizados todavía. Corré el drenado primero.",
      },
      { status: 400 },
    );
  }

  let payload;
  try {
    payload = await generateRecipes(
      star.username,
      starRes.data || [],
      guidesRes.data || [],
      star.star_dissection,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await sb
    .from("accounts")
    .update({ recipes_payload: payload })
    .eq("username", star.username);

  return NextResponse.json({
    account: {
      username: star.username,
      display_name: star.display_name,
      profile_pic_url: star.profile_pic_url,
    },
    recipes: payload,
  });
}
