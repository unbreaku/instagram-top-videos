import { NextResponse } from "next/server";
import { extractProfileData, runSync, type ApifyInstagramItem } from "@/lib/apify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USERNAME_RE = /^[a-z0-9_.]{1,30}$/i;

interface PreviewPost {
  shortcode: string;
  type: string | null;
  posted_at: string | null;
  thumbnail_url: string | null;
  url: string | null;
  views: number | null;
  likes: number | null;
}

interface PreviewResponse {
  username: string;
  display_name: string | null;
  bio: string | null;
  profile_pic_url: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  recent_posts: PreviewPost[];
}

/**
 * POST /api/accounts/preview { username }
 *
 * Pulls a small (3 post) sample from Apify so the user can visually confirm
 * they're about to add the right Instagram account before paying for a full
 * historic scrape. Does NOT write to the database.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string };
  const username = (body.username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (!USERNAME_RE.test(username))
    return NextResponse.json({ error: "Username inválido" }, { status: 400 });

  let items: ApifyInstagramItem[];
  try {
    items = await runSync(username, 3, true);
  } catch (e) {
    return NextResponse.json(
      {
        error: `No pude leer @${username}: ${e instanceof Error ? e.message : e}. ¿Está bien escrito? ¿La cuenta es pública?`,
      },
      { status: 502 },
    );
  }

  if (items.length === 0) {
    return NextResponse.json(
      {
        error: `Apify no devolvió ningún post para @${username}. La cuenta puede no existir, ser privada, o no tener posts.`,
      },
      { status: 404 },
    );
  }

  let profile: ReturnType<typeof extractProfileData> = null;
  for (const it of items) {
    const p = extractProfileData(it);
    if (p) {
      profile = p;
      break;
    }
  }

  const recent: PreviewPost[] = items.slice(0, 3).map((it) => ({
    shortcode: it.shortCode || "",
    type: it.productType === "clips" ? "Reel" : (it.type ?? null),
    posted_at: it.timestamp ?? null,
    thumbnail_url: it.displayUrl ?? null,
    url: it.url ?? (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : null),
    views: it.videoPlayCount ?? it.videoViewCount ?? null,
    likes: it.likesCount ?? null,
  }));

  const response: PreviewResponse = {
    username,
    display_name: profile?.fullName ?? null,
    bio: profile?.biography ?? null,
    profile_pic_url: profile?.profilePicUrl ?? null,
    followers: profile?.followersCount ?? null,
    following: profile?.followingCount ?? null,
    posts_count: profile?.postsCount ?? null,
    recent_posts: recent,
  };
  return NextResponse.json(response);
}
