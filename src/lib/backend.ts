import {
  makeImportRun,
  sampleDjSet,
  sampleReviewItems,
  sampleStatus
} from "../data/sampleData";
import type {
  AssistantResult,
  BackendStatus,
  DjSet,
  ImportRun,
  ReviewItem
} from "../types";

type CommandArgs = Record<string, unknown>;

export type LocalAiSettings = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

type GenerateDjSetResponse = {
  ok: boolean;
  djSet?: DjSet;
  error?: string;
};

type AssistantResponse = AssistantResult;

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `API returned an empty response (${response.status}). Make sure the local API proxy is running.`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `API returned non-JSON response (${response.status}): ${text.slice(0, 500)}`
    );
  }
}

type LibraryTrack = {
  id: string;
  position: number;
  timestamp: string;
  title: string;
  artist: string;
  confidence: number;
  inferredArtist?: boolean;
  needsReview?: boolean;
  raw?: string;
};

type LibraryPlaylist = {
  id: string;
  status: "active";
  ingestion: {
    sourceStatus: string;
    approvedForDistillation: boolean;
    needsManualTracks: boolean;
  };
  source: {
    bvid: string;
    title: string;
    url: string;
    coverUrl: string;
    pubdateText: string;
    durationText: string;
  };
  collection?: {
    title?: string;
    name?: string;
  } | null;
  theme: {
    primary: string;
    englishTitle: string;
    tags: string[];
    scenes: string[];
    moods: string[];
  };
  trackCount: number;
  tracks: LibraryTrack[];
};

type MusicKnowledge = {
  playlists: LibraryPlaylist[];
};

function mapPlaylistToReviewItem(playlist: LibraryPlaylist): ReviewItem {
  const moodParts = [...playlist.theme.scenes, ...playlist.theme.moods];
  return {
    id: playlist.id,
    sourceBvid: playlist.source.bvid,
    sourceTitle: playlist.source.title,
    sourceUrl: playlist.source.url,
    coverUrl: playlist.source.coverUrl,
    theme: playlist.theme.primary,
    mood: moodParts.length > 0 ? moodParts.join(" / ") : "已入库",
    collectionTitle: playlist.collection?.title ?? playlist.collection?.name,
    pubdateText: playlist.source.pubdateText,
    durationText: playlist.source.durationText,
    themeTags: playlist.theme.tags,
    trackCount: playlist.trackCount,
    status: "approved",
    tracks: playlist.tracks.map((track) => ({
      id: track.id,
      timestamp: track.timestamp,
      title: track.title,
      artist: track.artist,
      confidence: track.confidence,
      inferredArtist: track.inferredArtist,
      needsReview: track.needsReview,
      raw: track.raw
    }))
  };
}

async function loadBilibiliReviewItems(): Promise<ReviewItem[]> {
  const response = await fetch("/data/library/leo_music_knowledge.json", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Unable to load music knowledge: ${response.status}`);
  }

  const payload = (await response.json()) as MusicKnowledge;
  return payload.playlists.map(mapPlaylistToReviewItem);
}

async function loadProxyHealth(): Promise<Partial<BackendStatus>> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store"
    });

    if (!response.ok) return {};

    const payload = await readJsonResponse<{
      ok?: boolean;
      deepseekConfigured?: boolean;
    }>(response);

    return {
      databaseReady: Boolean(payload.ok),
      installable: true
    };
  } catch {
    return {};
  }
}

async function generateDeepSeekDjSet(
  theme: string,
  settings?: LocalAiSettings
): Promise<DjSet> {
  const response = await fetch("/api/dj-set", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme, settings })
  });

  const payload = await readJsonResponse<GenerateDjSetResponse>(response);
  if (!response.ok || !payload.ok || !payload.djSet) {
    throw new Error(payload.error || `DeepSeek proxy failed: ${response.status}`);
  }

  return payload.djSet;
}

async function runDeepSeekAssistant(
  input: string,
  settings?: LocalAiSettings,
  localMoment?: string
): Promise<AssistantResult> {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, localMoment, settings })
  });

  const payload = await readJsonResponse<AssistantResponse>(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `DeepSeek assistant failed: ${response.status}`);
  }

  return payload;
}

async function invokeMock<T>(command: string, args?: CommandArgs): Promise<T> {
  await new Promise((resolve) => window.setTimeout(resolve, 220));

  switch (command) {
    case "app_status":
      return { ...sampleStatus, ...(await loadProxyHealth()) } as T;
    case "list_review_items":
      try {
        return (await loadBilibiliReviewItems()) as T;
      } catch (error) {
        console.warn(error);
        return sampleReviewItems as T;
      }
    case "start_bili_import":
      return makeImportRun(String(args?.source ?? "")) as T;
    case "generate_dj_set":
      return (await generateDeepSeekDjSet(
        String(args?.theme ?? sampleDjSet.sourceTheme),
        args?.settings as LocalAiSettings | undefined
      )) as T;
    case "run_assistant":
      return (await runDeepSeekAssistant(
        String(args?.input ?? ""),
        args?.settings as LocalAiSettings | undefined,
        String(args?.localMoment ?? "")
      )) as T;
    default:
      throw new Error(`Mock command not implemented: ${command}`);
  }
}

export async function backend<T>(command: string, args?: CommandArgs): Promise<T> {
  return invokeMock<T>(command, args);
}

export const api = {
  status: () => backend<BackendStatus>("app_status"),
  listReviewItems: () => backend<ReviewItem[]>("list_review_items"),
  startBiliImport: (source: string) =>
    backend<ImportRun>("start_bili_import", { source }),
  generateDjSet: (theme: string, settings?: LocalAiSettings) =>
    backend<DjSet>("generate_dj_set", { theme, settings }),
  runAssistant: (
    input: string,
    settings?: LocalAiSettings,
    options?: { localMoment?: string }
  ) =>
    backend<AssistantResult>("run_assistant", {
      input,
      localMoment: options?.localMoment,
      settings
    })
};
