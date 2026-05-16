import { getServerSupabase } from "./supabase";
import {
  ApifyInstagramItem,
  classifyType,
  extractViews,
  isVideoItem,
} from "./apify";

export interface IngestResult {
  videosAdded: number;
  videosUpdated: number;
  snapshotsAdded: number;
}

/**
 * Takes raw Apify items for one account and persists them.
 *
 * Uses bulk upsert for videos and batched inserts for snapshots so the whole
 * thing finishes well under the 60s Vercel function timeout even with 1k+
 * items. Previous implementation did one round-trip per video, which blew up
 * past ~300 videos.
 */
export async function ingestApifyItems(
  username: string,
  items: ApifyInstagramItem[],
): Promise<IngestResult> {
  const sb = getServerSupabase();
  const cleanUsername = username.replace(/^@/, "").toLowerCase();
  const now = new Date().toISOString();

  // ---------- profile snapshot ----------
  const profileItem = items.find(
    (it) =>
      typeof it.ownerFollowersCount === "number" ||
      typeof it.ownerPostsCount === "number",
  );

  if (profileItem) {
    if (profileItem.ownerFullName) {
      await sb
        .from("accounts")
        .update({ display_name: profileItem.ownerFullName })
        .eq("username", cleanUsername);
    }
    await sb.from("account_snapshots").insert({
      account_username: cleanUsername,
      followers_count: profileItem.ownerFollowersCount ?? null,
      following_count: profileItem.ownerFollowingCount ?? null,
      posts_count: profileItem.ownerPostsCount ?? null,
      videos_count: items.filter(isVideoItem).length,
    });
  }

  // ---------- videos ----------
  const videos = items.filter(isVideoItem).filter((i) => i.shortCode);

  // Find which shortcodes already exist so we can report added vs updated.
  const shortcodes = videos.map((v) => v.shortCode!);
  const existingSet = new Set<string>();
  for (let i = 0; i < shortcodes.length; i += 1000) {
    const slice = shortcodes.slice(i, i + 1000);
    const { data } = await sb
      .from("videos")
      .select("shortcode")
      .in("shortcode", slice);
    (data || []).forEach((r) => existingSet.add(r.shortcode as string));
  }

  const videoRows = videos.map((item) => {
    const shortcode = item.shortCode!;
    const views = extractViews(item);
    return {
      shortcode,
      account_username: cleanUsername,
      type: classifyType(item),
      caption: (item.caption || "").trim() || null,
      posted_at: item.timestamp || null,
      url: item.url || `https://www.instagram.com/p/${shortcode}/`,
      // Time-limited Instagram CDN URL. Re-stored on each ingest so the
      // transcription pipeline always gets a fresh one.
      video_url: item.videoUrl || null,
      thumbnail_url: item.displayUrl || null,
      duration_seconds:
        typeof item.videoDuration === "number"
          ? Math.round(item.videoDuration)
          : null,
      latest_views: views || null,
      latest_likes: item.likesCount ?? null,
      latest_comments: item.commentsCount ?? null,
      latest_captured_at: now,
    };
  });

  // Bulk upsert in chunks of 500 to stay under request size limits.
  let videosAdded = 0;
  let videosUpdated = 0;
  for (let i = 0; i < videoRows.length; i += 500) {
    const chunk = videoRows.slice(i, i + 500);
    const { error } = await sb
      .from("videos")
      .upsert(chunk, { onConflict: "shortcode" });
    if (error) throw new Error(`videos upsert: ${error.message}`);
    for (const row of chunk) {
      if (existingSet.has(row.shortcode)) videosUpdated += 1;
      else videosAdded += 1;
    }
  }

  // Snapshot every video in one (or a few) batch insert(s).
  const snapshotRows = videos.map((item) => ({
    video_shortcode: item.shortCode!,
    views: extractViews(item) || null,
    likes: item.likesCount ?? null,
    comments: item.commentsCount ?? null,
    captured_at: now,
  }));

  let snapshotsAdded = 0;
  for (let i = 0; i < snapshotRows.length; i += 1000) {
    const chunk = snapshotRows.slice(i, i + 1000);
    const { error } = await sb.from("video_snapshots").insert(chunk);
    if (error) throw new Error(`video_snapshots insert: ${error.message}`);
    snapshotsAdded += chunk.length;
  }

  // ---------- mark scrape time ----------
  await sb
    .from("accounts")
    .update({ last_full_scrape_at: now })
    .eq("username", cleanUsername);

  return { videosAdded, videosUpdated, snapshotsAdded };
}
