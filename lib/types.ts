// Database row shapes
export interface AccountRow {
  username: string;
  display_name: string | null;
  bio: string | null;
  is_pinned: boolean;
  last_full_scrape_at: string | null;
  created_at: string;
}

export interface AccountSnapshotRow {
  id: number;
  account_username: string;
  captured_at: string;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  videos_count: number | null;
}

export interface VideoRow {
  shortcode: string;
  account_username: string;
  type: string | null; // Reel | Video | IGTV
  caption: string | null;
  posted_at: string | null;
  url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  first_seen_at: string;
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  latest_captured_at: string | null;
  transcript: string | null;
  transcript_lang: string | null;
  transcribed_at: string | null;
  cta: string | null;
  hook: string | null;
  format_tags: string[] | null;
  analyzed_at: string | null;
}

export interface VideoSnapshotRow {
  id: number;
  video_shortcode: string;
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface ApifyRunRow {
  run_id: string;
  account_username: string | null;
  kind: string | null; // 'full_history' | 'daily_snapshot'
  status: string | null;
  started_at: string;
  finished_at: string | null;
  videos_added: number | null;
  videos_updated: number | null;
  error: string | null;
  dataset_id: string | null;
}

// API responses
export interface AccountSummary extends AccountRow {
  video_count: number;
  followers_latest: number | null;
  followers_change_7d: number | null;
}
