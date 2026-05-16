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
 * Takes raw Apify items for one account and:
 *   - Upserts the account profile fields (from parent data if available)
 *   - Inserts an account_snapshot if profile data is present
 *   - Upserts each video and appends a video_snapshot row
 */
export async function ingestApifyItems(
  username: string,
  items: ApifyInstagramItem[],
): Promise<IngestResult> {
  const sb = getServerSupabase();
  const cleanUsername = username.replace(/^@/, "").toLowerCase();

  // 1) Profile fields are repeated on each post when addParentData=true.
  //    Take the first item that has them.
  const profileItem = items.find(
    (it) =>
      typeof it.ownerFollowersCount === "number" ||
      typeof it.ownerPostsCount === "number",
  );

  if (profileItem) {
    await sb
      .from("accounts")
      .update({
        display_name: profileItem.ownerFullName ?? undefined,
      })
      .eq("username", cleanUsername);

    await sb.from("account_snapshots").insert({
      account_username: cleanUsername,
      followers_count: profileItem.ownerFollowersCount ?? null,
      following_count: profileItem.ownerFollowingCount ?? null,
      posts_count: profileItem.ownerPostsCount ?? null,
      videos_count: items.filter(isVideoItem).length,
    });
  }

  // 2) Videos
  const videos = items.filter(isVideoItem);
  let videosAdded = 0;
  let videosUpdated = 0;
  let snapshotsAdded = 0;

  for (const item of videos) {
    const shortcode = item.shortCode;
    if (!shortcode) continue;
    const url =
      item.url || `https://www.instagram.com/p/${shortcode}/`;

    // Upsert video. We use ignoreDuplicates=false to merge fields.
    const { data: existing } = await sb
      .from("videos")
      .select("shortcode")
      .eq("shortcode", shortcode)
      .maybeSingle();

    const views = extractViews(item);
    const payload = {
      shortcode,
      account_username: cleanUsername,
      type: classifyType(item),
      caption: (item.caption || "").trim() || null,
      posted_at: item.timestamp || null,
      url,
      // Direct CDN URL to the mp4 file, used by the transcription pipeline.
      // It expires after ~1h, so we re-store it on every ingest.
      video_url: item.videoUrl || null,
      thumbnail_url: item.displayUrl || null,
      duration_seconds:
        typeof item.videoDuration === "number"
          ? Math.round(item.videoDuration)
          : null,
      latest_views: views || null,
      latest_likes: item.likesCount ?? null,
      latest_comments: item.commentsCount ?? null,
      latest_captured_at: new Date().toISOString(),
    };

    if (existing) {
      await sb.from("videos").update(payload).eq("shortcode", shortcode);
      videosUpdated += 1;
    } else {
      await sb.from("videos").insert(payload);
      videosAdded += 1;
    }

    await sb.from("video_snapshots").insert({
      video_shortcode: shortcode,
      views: views || null,
      likes: item.likesCount ?? null,
      comments: item.commentsCount ?? null,
    });
    snapshotsAdded += 1;
  }

  // 3) Mark the account as scraped
  await sb
    .from("accounts")
    .update({ last_full_scrape_at: new Date().toISOString() })
    .eq("username", cleanUsername);

  return { videosAdded, videosUpdated, snapshotsAdded };
}
