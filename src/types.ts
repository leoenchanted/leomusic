export type ReviewStatus = "pending" | "approved" | "needs_fix";

export type TrackCandidate = {
  id: string;
  timestamp?: string;
  title: string;
  artist: string;
  confidence: number;
  inferredArtist?: boolean;
  needsReview?: boolean;
  raw?: string;
  spotifyUri?: string;
};

export type ReviewItem = {
  id: string;
  sourceBvid?: string;
  sourceTitle: string;
  sourceUrl: string;
  coverUrl: string;
  theme: string;
  mood: string;
  collectionTitle?: string;
  pubdateText?: string;
  durationText?: string;
  themeTags?: string[];
  trackCount?: number;
  status: ReviewStatus;
  tracks: TrackCandidate[];
};

export type DjTrack = {
  id: string;
  title: string;
  artist: string;
  themeReason: string;
  isDiscovery?: boolean;
  sourcePlaylistId?: string;
  sourcePlaylistTheme?: string;
  spotifyUri?: string;
};

export type DjSegment = {
  id: string;
  beforeTrackId: string;
  script: string;
  estimatedSeconds: number;
  voiceStatus: "cached" | "ready" | "missing";
};

export type DjSet = {
  id: string;
  title: string;
  sourceTheme: string;
  provider?: string;
  tracks: DjTrack[];
  segments: DjSegment[];
  notes?: string[];
};

export type AssistantMode = "chat" | "radio" | "mood" | "daily" | "focus";

export type AssistantIntent = {
  mode: AssistantMode;
  shouldGenerateRadio: boolean;
  assistantReply: string;
  stationTheme: string;
  retrievalQuery: {
    keywords: string[];
    tags: string[];
    scenes: string[];
    moods: string[];
    artists: string[];
    avoid: string[];
    energy: string;
    timeOfDay: string;
  };
  suggestedPrompts: string[];
};

export type AssistantResult = {
  ok: boolean;
  mode?: AssistantMode;
  intent?: AssistantIntent;
  message?: string;
  suggestions?: string[];
  djSet?: DjSet;
  error?: string;
};

export type ImportRun = {
  id: string;
  status: "queued" | "scanning" | "ready";
  message: string;
};

export type BackendStatus = {
  mode: "pwa" | "browser-preview";
  kokoroConfigured: boolean;
  minimaxConfigured: boolean;
  spotifyConfigured: boolean;
  databaseReady: boolean;
  installable: boolean;
};
