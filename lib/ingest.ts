import { getServerSupabase } from "./supabase";
import {
  ApifyInstagramItem,
  classifyType,
  extractProfileData,
  extractViews,
  isVideoItem,
} from "./apify";

export interface IngestResult {
  videosAdded: number;
  videosUpdated: number;
  snapshotsAdded: number;
  postsTotal: number; // includes images + sidecars
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
  // Profile fields come back attached to each post when addParentData=true,
  // but the Apify actor has changed which path holds them across versions
  // (ownerFollowersCount / owner.followersCount / parentData.followersCount).
  // extractProfileData walks all known shapes; we take the first item with
  // any of them populated.
  let profile: ReturnType<typeof extractProfileData> = null;
  for (const it of items) {
    const p = extractProfileData(it);
    if (p) {
      profile = p;
      break;
    }
  }

  if (profile) {
    const update: Record<string, unknown> = {};
    if (profile.fullName) update.display_name = profile.fullName;
    if (profile.biography) update.bio = profile.biography;
    if (Object.keys(update).length > 0) {
      await sb.from("accounts").update(update).eq("username", cleanUsername);
    }
    await sb.from("account_snapshots").insert({
      account_username: cleanUsername,
      followers_count: profile.followersCount,
      following_count: profile.followingCount,
      posts_count: profile.postsCount,
      videos_count: items.filter(isVideoItem).length,
    });
  }

  // ---------- posts (videos + images + sidecars) ----------
  // We store every post so the totals on the dashboard match the count the
  // user sees on Instagram. Photos just have null video_url / null views and
  // are naturally skipped by the analyze pipeline.
  const videos = items.filter((i) => i.shortCode);

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

  // Snapshot only the actual videos (avoids inserting useless null rows for
  // photo-only posts).
  const snapshotRows = videos
    .filter((item) => isVideoItem(item))
    .map((item) => ({
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

  return { videosAdded, videosUpdated, snapshotsAdded, postsTotal: videos.length };
}
