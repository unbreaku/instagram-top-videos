/**
 * Single source of truth for "how much impact did this post generate".
 *
 * Why a composite score instead of just views:
 *   - Photos / sidecars have no `views`, so weighting by views alone would
 *     give them 0 follower attribution even if they drove engagement.
 *   - Likes and comments are real signal — comments especially correlate
 *     with deep engagement and discovery via the algorithm.
 *
 * The weights below were chosen so:
 *   - For videos: views still dominate (typically 100× more views than
 *     likes), so a high-view Reel gets most of the attribution.
 *   - For photos/sidecars (no views): likes act as the reach proxy and
 *     comments amplify it.
 *
 * The output isn't followers — it's an arbitrary "impact unit". Used
 * to compute proportional shares of a known follower delta.
 */
export interface PostMetrics {
  latest_views?: number | null;
  latest_likes?: number | null;
  latest_comments?: number | null;
}

export function postImpact(v: PostMetrics): number {
  const views = v.latest_views || 0;
  const likes = v.latest_likes || 0;
  const comments = v.latest_comments || 0;
  if (views > 0) {
    // Videos / reels: views are the primary reach signal; likes/comments
    // add a small bonus for posts that punch above their view count in
    // engagement quality.
    return views + likes * 5 + comments * 25;
  }
  // Photos / sidecars: no views available, so likes is the reach proxy.
  // Weights are higher because there are fewer "currency units" to split.
  return likes * 25 + comments * 100;
}

/**
 * Attributes a follower delta across N posts proportionally to their impact.
 * Returns each post's share, rounded to integer.
 *
 * If total impact is 0 (e.g. all posts have no engagement yet), falls back
 * to an even split so newly-published posts aren't silently dropped.
 */
export function attributeDelta<T extends PostMetrics & { shortcode: string }>(
  delta: number,
  posts: T[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (posts.length === 0) return out;
  const impacts = posts.map((p) => postImpact(p));
  const total = impacts.reduce((s, x) => s + x, 0);
  for (let i = 0; i < posts.length; i++) {
    const share =
      total > 0 ? (impacts[i] / total) * delta : delta / posts.length;
    out.set(posts[i].shortcode, Math.round(share));
  }
  return out;
}
