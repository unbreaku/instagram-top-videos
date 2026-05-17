/**
 * Wrapper around Apify's `apify/instagram-scraper` actor.
 *
 * Two modes:
 *   - sync: run-sync-get-dataset-items — single round-trip, blocks until the
 *     actor finishes. Capped by Vercel function timeout (60s on Hobby).
 *     Good for small jobs (cron daily, fetching latest N posts).
 *   - async: starts a run, returns immediately with run_id, datasetId.
 *     Use polling (`getRunStatus`) or webhooks to know when it's done.
 *     Required for full-history scrapes that may take minutes.
 */

const APIFY_ACTOR = "apify~instagram-scraper";
const APIFY_BASE = "https://api.apify.com/v2";

export interface ApifyInstagramItem {
  type?: string;
  productType?: string;
  shortCode?: string;
  caption?: string;
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  timestamp?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  displayUrl?: string;
  videoDuration?: number;
  isVideo?: boolean;
  videoUrl?: string;
  // From parent profile data — the actor returns these under different paths
  // depending on version. We accept all common shapes and unify them via
  // extractProfileData() below.
  ownerFollowersCount?: number;
  ownerFollowingCount?: number;
  ownerPostsCount?: number;
  // Some versions stick the profile data on a sub-object.
  owner?: {
    username?: string;
    fullName?: string;
    followersCount?: number;
    followsCount?: number;
    postsCount?: number;
    biography?: string;
    profilePicUrl?: string;
    profilePicUrlHD?: string;
  };
  // Or on a parentData field (older shape, kept for safety).
  parentData?: {
    followersCount?: number;
    followsCount?: number;
    postsCount?: number;
    fullName?: string;
    biography?: string;
    profilePicUrl?: string;
  };
  // Or just top-level (rare but seen on some scrapers).
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  fullName?: string;
  biography?: string;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  ownerProfilePicUrl?: string;
}

/**
 * Returns unified profile-level metrics for an item if present. Tries every
 * known shape so the system survives Apify actor schema bumps.
 */
export function extractProfileData(item: ApifyInstagramItem): {
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  fullName: string | null;
  biography: string | null;
  profilePicUrl: string | null;
} | null {
  const followers =
    item.ownerFollowersCount ??
    item.owner?.followersCount ??
    item.parentData?.followersCount ??
    item.followersCount ??
    null;
  const following =
    item.ownerFollowingCount ??
    item.owner?.followsCount ??
    item.parentData?.followsCount ??
    item.followsCount ??
    null;
  const posts =
    item.ownerPostsCount ??
    item.owner?.postsCount ??
    item.parentData?.postsCount ??
    item.postsCount ??
    null;
  const fullName =
    item.ownerFullName ??
    item.owner?.fullName ??
    item.parentData?.fullName ??
    item.fullName ??
    null;
  const biography =
    item.owner?.biography ?? item.parentData?.biography ?? item.biography ?? null;
  const profilePicUrl =
    item.owner?.profilePicUrlHD ??
    item.owner?.profilePicUrl ??
    item.parentData?.profilePicUrl ??
    item.profilePicUrlHD ??
    item.profilePicUrl ??
    item.ownerProfilePicUrl ??
    null;

  // If nothing was found, this item doesn't have profile data attached.
  if (
    followers === null &&
    following === null &&
    posts === null &&
    fullName === null &&
    biography === null &&
    profilePicUrl === null
  ) {
    return null;
  }
  return {
    followersCount: typeof followers === "number" ? followers : null,
    followingCount: typeof following === "number" ? following : null,
    postsCount: typeof posts === "number" ? posts : null,
    fullName: typeof fullName === "string" ? fullName : null,
    biography: typeof biography === "string" ? biography : null,
    profilePicUrl: typeof profilePicUrl === "string" ? profilePicUrl : null,
  };
}

export function isVideoItem(item: ApifyInstagramItem): boolean {
  if (item.isVideo === true) return true;
  if ((item.type || "").toLowerCase() === "video") return true;
  const pt = (item.productType || "").toLowerCase();
  if (pt === "clips" || pt === "igtv") return true;
  if (typeof item.videoPlayCount === "number" && item.videoPlayCount > 0)
    return true;
  if (typeof item.videoViewCount === "number" && item.videoViewCount > 0)
    return true;
  if (item.videoUrl) return true;
  return false;
}

export function classifyType(item: ApifyInstagramItem): string {
  const pt = (item.productType || "").toLowerCase();
  if (pt === "clips") return "Reel";
  if (pt === "igtv") return "IGTV";
  const t = (item.type || "").toLowerCase();
  if (t === "video") return "Video";
  if (t === "image") return "Image";
  if (t === "sidecar") return "Sidecar";
  return "Other";
}

export function extractViews(item: ApifyInstagramItem): number {
  const v1 = typeof item.videoPlayCount === "number" ? item.videoPlayCount : 0;
  const v2 = typeof item.videoViewCount === "number" ? item.videoViewCount : 0;
  return Math.max(v1, v2);
}

function buildBody(
  username: string,
  resultsLimit: number,
  includeProfileData: boolean,
) {
  const u = username.replace(/^@/, "").trim();
  return {
    directUrls: [`https://www.instagram.com/${u}/`],
    resultsType: "posts",
    resultsLimit,
    addParentData: includeProfileData,
  };
}

function token(): string {
  const t = process.env.APIFY_API_TOKEN;
  if (!t) throw new Error("APIFY_API_TOKEN is not set");
  return t;
}

/**
 * Synchronous run for small/fast scrapes. Returns dataset items.
 * Will time out if the actor takes too long.
 */
export async function runSync(
  username: string,
  resultsLimit: number,
  includeProfileData = false,
): Promise<ApifyInstagramItem[]> {
  const url = `${APIFY_BASE}/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(
    token(),
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody(username, resultsLimit, includeProfileData)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify sync failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const items = (await res.json()) as ApifyInstagramItem[];
  if (!Array.isArray(items)) throw new Error("Apify sync: not an array");
  return items;
}

/**
 * Starts an async run and returns the run + dataset IDs immediately.
 */
export async function startRun(
  username: string,
  resultsLimit: number,
  includeProfileData = true,
): Promise<{ runId: string; datasetId: string }> {
  const url = `${APIFY_BASE}/acts/${APIFY_ACTOR}/runs?token=${encodeURIComponent(
    token(),
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildBody(username, resultsLimit, includeProfileData)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify start failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as {
    data?: { id?: string; defaultDatasetId?: string };
  };
  const runId = j.data?.id;
  const datasetId = j.data?.defaultDatasetId;
  if (!runId || !datasetId)
    throw new Error("Apify start: missing run/dataset ID");
  return { runId, datasetId };
}

export interface RunStatus {
  status:
    | "READY"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "ABORTED"
    | "TIMING-OUT"
    | "TIMED-OUT"
    | "ABORTING";
  itemCount?: number;
}

export async function getRunStatus(runId: string): Promise<RunStatus> {
  const url = `${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(
    token(),
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apify status failed (${res.status})`);
  const j = (await res.json()) as {
    data?: { status?: RunStatus["status"]; stats?: { inputBodyLen?: number } };
  };
  // Throw instead of defaulting to RUNNING — a missing status field means
  // the response is malformed (transient Apify edge / rate limit / changed
  // schema) and the caller should know rather than spin forever.
  if (!j?.data?.status) {
    throw new Error("Apify status response missing data.status");
  }
  return { status: j.data.status };
}

/**
 * Fetches all items from a finished run's dataset.
 */
export async function fetchDataset(
  datasetId: string,
): Promise<ApifyInstagramItem[]> {
  const url = `${APIFY_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(
    token(),
  )}&format=json&clean=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apify dataset fetch failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const items = (await res.json()) as ApifyInstagramItem[];
  if (!Array.isArray(items)) throw new Error("Apify dataset: not an array");
  return items;
}
