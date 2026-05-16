export interface VideoRow {
  username: string;
  views: number;
  likes: number;
  comments: number;
  caption: string;
  url: string;
  timestamp: string; // ISO
  thumbnailUrl?: string;
  durationSeconds?: number;
  type: "Video" | "Reel" | "IGTV" | "Other";
}

export interface ScrapeResponse {
  results: VideoRow[];
  perAccount: Array<{ username: string; videoCount: number; error?: string }>;
  fetchedAt: string;
}

export interface ScrapeRequest {
  usernames: string[];
  topN?: number;
}
