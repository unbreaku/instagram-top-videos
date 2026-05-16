import type { VideoRow } from "./types";

const APIFY_ACTOR = "apify~instagram-scraper";
const APIFY_BASE = "https://api.apify.com/v2";

// Shape of items returned by the apify/instagram-scraper actor (subset we care about).
// See: https://apify.com/apify/instagram-scraper
interface ApifyInstagramItem {
  type?: string;
  productType?: string; // "clips" = Reel, "feed" = post
  shortCode?: string;
  caption?: string;
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  timestamp?: string;
  ownerUsername?: string;
  displayUrl?: string;
  videoDuration?: number;
  isVideo?: boolean;
}

function classifyType(item: ApifyInstagramItem): VideoRow["type"] {
  const pt = (item.productType || "").toLowerCase();
  if (pt === "clips") return "Reel";
  if (pt === "igtv") return "IGTV";
  const t = (item.type || "").toLowerCase();
  if (t === "video") return "Video";
  return "Other";
}

function isVideoItem(item: ApifyInstagramItem): boolean {
  if (item.isVideo === true) return true;
  if ((item.type || "").toLowerCase() === "video") return true;
  const pt = (item.productType || "").toLowerCase();
  if (pt === "clips" || pt === "igtv") return true;
  // Some reels come back with only videoPlayCount populated
  if (typeof item.videoPlayCount === "number" && item.videoPlayCount > 0) return true;
  if (typeof item.videoViewCount === "number" && item.videoViewCount > 0) return true;
  return false;
}

function extractViews(item: ApifyInstagramItem): number {
  // Reels expose videoPlayCount; older video posts expose videoViewCount.
  // We pick whichever is larger / available.
  const v1 = typeof item.videoPlayCount === "number" ? item.videoPlayCount : 0;
  const v2 = typeof item.videoViewCount === "number" ? item.videoViewCount : 0;
  return Math.max(v1, v2);
}

function toRow(item: ApifyInstagramItem, fallbackUsername: string): VideoRow {
  const shortCode = item.shortCode || "";
  const url =
    item.url ||
    (shortCode ? `https://www.instagram.com/p/${shortCode}/` : "");
  return {
    username: item.ownerUsername || fallbackUsername,
    views: extractViews(item),
    likes: item.likesCount ?? 0,
    comments: item.commentsCount ?? 0,
    caption: (item.caption || "").trim(),
    url,
    timestamp: item.timestamp || "",
    thumbnailUrl: item.displayUrl,
    durationSeconds:
      typeof item.videoDuration === "number" ? item.videoDuration : undefined,
    type: classifyType(item),
  };
}

export interface ScrapeOptions {
  topN: number;
  resultsLimit: number; // how many posts to ask Apify for per account
  apiToken: string;
}

/**
 * Calls Apify's Instagram Scraper actor synchronously for one username and
 * returns the top N video posts ordered by view count (descending).
 *
 * Uses `run-sync-get-dataset-items` so we get the dataset back in one call.
 */
export async function scrapeTopVideosForAccount(
  username: string,
  opts: ScrapeOptions,
): Promise<VideoRow[]> {
  const cleanUsername = username.replace(/^@/, "").trim();
  if (!cleanUsername) return [];

  const url = `${APIFY_BASE}/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(
    opts.apiToken,
  )}`;

  // The actor expects `directUrls` pointing to profile pages.
  // The legacy `username` field is no longer honored by the current build.
  const body = {
    directUrls: [`https://www.instagram.com/${cleanUsername}/`],
    resultsType: "posts",
    resultsLimit: opts.resultsLimit,
    addParentData: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Apify can take a while; bump the timeout via Next.js route config.
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apify request failed for @${cleanUsername} (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const items = (await res.json()) as ApifyInstagramItem[];
  if (!Array.isArray(items)) {
    throw new Error(
      `Unexpected Apify response for @${cleanUsername}: not an array`,
    );
  }

  const videos = items
    .filter(isVideoItem)
    .map((item) => toRow(item, cleanUsername))
    .sort((a, b) => b.views - a.views)
    .slice(0, opts.topN);

  return videos;
}
