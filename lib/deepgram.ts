/**
 * Deepgram transcription client.
 * Uses the nova-2 model with smart formatting + diarization off.
 * Auto-detects language (es/en) so we don't need to pre-classify.
 */

const DEEPGRAM_API = "https://api.deepgram.com/v1/listen";

export interface TranscribeResult {
  transcript: string;
  language: string | null;
  durationSeconds: number | null;
}

/**
 * Sends a direct media URL to Deepgram and returns the transcript.
 * Throws on any non-2xx response.
 */
export async function transcribeUrl(mediaUrl: string): Promise<TranscribeResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set");

  const params = new URLSearchParams({
    model: "nova-2",
    smart_format: "true",
    punctuate: "true",
    detect_language: "true",
  });

  const res = await fetch(`${DEEPGRAM_API}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: mediaUrl }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${t.slice(0, 300)}`);
  }

  const j = (await res.json()) as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string }>;
        detected_language?: string;
      }>;
    };
    metadata?: { duration?: number };
  };

  const channel = j.results?.channels?.[0];
  const transcript = channel?.alternatives?.[0]?.transcript || "";
  const language = channel?.detected_language || null;
  const durationSeconds = j.metadata?.duration ?? null;

  return { transcript, language, durationSeconds };
}
