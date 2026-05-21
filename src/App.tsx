import {
  Activity,
  Bot,
  BookOpen,
  CalendarDays,
  Check,
  Headphones,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  Radio,
  Send,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  Volume2,
  X,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type LocalAiSettings } from "./lib/backend";
import type {
  AssistantIntent,
  AssistantResult,
  BackendStatus,
  DjSet,
  DjTrack,
  ReviewItem
} from "./types";

type ConsoleView = "chat" | "radio";

type ChatMessage = {
  id: string;
  role: "ai" | "user";
  text: string;
};

type VoiceProvider = "browser" | "minimax" | "kokoro";

type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
};

type SpotifyPlaybackState = {
  currently_playing_type?: string;
  is_playing?: boolean;
  item?: {
    duration_ms?: number;
    name?: string;
    uri?: string;
  };
  progress_ms?: number;
};

type StoredSettings = Required<LocalAiSettings> & {
  browserVoiceURI: string;
  kokoroEndpoint: string;
  minimaxApiKey: string;
  minimaxModel: string;
  minimaxVoiceId: string;
  speechRate: number;
  spotifyAccessToken: string;
  spotifyClientId: string;
  spotifyRedirectUri: string;
  spotifyRefreshToken: string;
  spotifyTokenExpiresAt: number;
  streamBuffer: number;
  voiceProvider: VoiceProvider;
};

const SETTINGS_KEY = "leo-dj-console-settings";
const SPOTIFY_PKCE_KEY = "leo-dj-spotify-pkce";
const SPOTIFY_AUTH_URL_KEY = "leo-dj-spotify-last-auth-url";
const DEFAULT_SPOTIFY_CLIENT_ID = "300a376fd99d424d891764fcc888c319";
const SPOTIFY_POLL_INTERVAL_MS = 1000;
const SPOTIFY_ADVANCE_WINDOW_MS = 1200;
const LOCAL_TRACK_DURATION_MS = 180_000;

function getDefaultSpotifyRedirectUri() {
  if (typeof window === "undefined") return "http://127.0.0.1:1420/";

  const url = new URL(`${window.location.origin}${window.location.pathname}`);
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}

const defaultSettings: StoredSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  browserVoiceURI: "",
  kokoroEndpoint: "http://127.0.0.1:8789/tts",
  model: "deepseek-v4-flash",
  minimaxApiKey: "",
  minimaxModel: "speech-2.8-turbo",
  minimaxVoiceId: "",
  temperature: 0.85,
  maxTokens: 8192,
  speechRate: 0.96,
  spotifyAccessToken: "",
  spotifyClientId: DEFAULT_SPOTIFY_CLIENT_ID,
  spotifyRedirectUri: getDefaultSpotifyRedirectUri(),
  spotifyRefreshToken: "",
  spotifyTokenExpiresAt: 0,
  streamBuffer: 450,
  voiceProvider: "browser"
};

const initialMessages: ChatMessage[] = [
  {
    id: "sys-online",
    role: "ai",
    text: "> SYSTEM_ONLINE. Awaiting your frequency."
  },
  {
    id: "hint",
    role: "ai",
    text: "> 输入一个主题，我会从你的本地音乐知识库里生成一段私人电台队列。"
  }
];

const modelOptions = [
  "deepseek-v4-flash",
  "deepseek-chat",
  "deepseek-reasoner",
  "custom-local-llm"
];

const spotifyScopes = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state"
];

const libraryGuidePrompt = `你是一个音乐知识库结构化助手。请把我提供的任意格式歌单数据，整理成 LEO DJ 项目可读取的 JSON。

输出要求：
1. 只输出一个合法 JSON 对象，不要 Markdown，不要解释。
2. JSON 顶层必须包含 version、generatedAt、source、ingestionPolicy、summary、vocabulary、playlists。
3. playlists 里的每个 playlist 必须包含 id、status、ingestion、source、collection、theme、trackCount、tracks。
4. 每首 track 必须包含 id、position、timestamp、title、artist、confidence。
5. theme 必须包含 primary、englishTitle、tags、scenes、moods。
6. source 必须包含 bvid、title、url、coverUrl、pubdateText、durationText。不是 B 站来源时 bvid 可填来源唯一 id 或空字符串。
7. summary 需要统计 collections、sourceVideos、activePlaylists、playlistsWithTracks、themeOnlyPlaylists、trackPlacements、uniqueTrackKeys、inferredArtistPlacements。
8. 不要编造不存在的歌曲。无法确定歌手时 artist 留空，并把 confidence 降低。
9. 输出的 JSON 要能直接保存为 leo_music_knowledge.json。

下面是我的原始歌单数据，请按上面的结构整理：

<<<在这里粘贴我的歌单数据>>>`;

function readStoredSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      maxTokens: Math.max(8192, Number(parsed.maxTokens || defaultSettings.maxTokens)),
      spotifyClientId:
        parsed.spotifyClientId?.trim() || defaultSettings.spotifyClientId
    };
  } catch {
    return defaultSettings;
  }
}

function writeStoredSettings(settings: StoredSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function makeMessage(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text
  };
}

function formatPlaybackTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isVoiceCancelError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.message === "Voice playback cancelled." ||
    error.message.toLowerCase().includes("abort")
  );
}

function formatLocalMoment(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "short"
  }).format(date);
}

function summarizeIntent(intent?: AssistantIntent) {
  if (!intent) return "";

  const query = intent.retrievalQuery;
  const parts = [
    `mode=${intent.mode}`,
    intent.stationTheme ? `station=${intent.stationTheme}` : "",
    query.scenes.length ? `scenes=${query.scenes.join("/")}` : "",
    query.moods.length ? `moods=${query.moods.join("/")}` : "",
    query.tags.length ? `tags=${query.tags.slice(0, 3).join("/")}` : ""
  ].filter(Boolean);

  return `> INTENT_DISTILLED. ${parts.join(" · ")}`;
}

function formatSuggestions(result: AssistantResult) {
  const suggestions = result.suggestions ?? result.intent?.suggestedPrompts ?? [];
  if (!suggestions.length) return "";
  return `> TRY_NEXT. ${suggestions.slice(0, 3).join("  |  ")}`;
}

function describeSpotifyApiError(status: number, text: string) {
  let message = text.trim();

  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string; reason?: string } | string;
      error_description?: string;
    };
    if (typeof payload.error === "string") {
      message = payload.error_description || payload.error;
    } else {
      message = payload.error?.reason || payload.error?.message || message;
    }
  } catch {
    // Keep the raw text from Spotify if it is not JSON.
  }

  if (status === 401) {
    return `${message || "Unauthorized"}. Reconnect Spotify in Settings.`;
  }

  if (status === 403) {
    return `${message || "Forbidden"}. Check Spotify Premium, scopes, and Development Mode allowlist.`;
  }

  if (status === 404) {
    return `${message || "No active device"}. Open Spotify on desktop/mobile and start any song once.`;
  }

  if (status === 429) {
    return `${message || "Rate limited"}. Wait a moment and try again.`;
  }

  return message || `Spotify ${status}`;
}

function randomString(length: number) {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => charset[value % charset.length]).join("");
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return window
    .btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function makeSpotifyChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

function App() {
  const [clock, setClock] = useState(() => new Date());
  const [isLight, setIsLight] = useState(false);
  const [view, setView] = useState<ConsoleView>("chat");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDjSpeaking, setIsDjSpeaking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [playbackDurationMs, setPlaybackDurationMs] = useState(LOCAL_TRACK_DURATION_MS);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [libraryGuideOpen, setLibraryGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<StoredSettings>(() => readStoredSettings());
  const [draftSettings, setDraftSettings] = useState<StoredSettings>(() =>
    readStoredSettings()
  );
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [djSet, setDjSet] = useState<DjSet | null>(null);
  const hasSpotifyLink = Boolean(settings.spotifyAccessToken.trim());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const spotifyAdvanceRef = useRef<{
    advanced: boolean;
    trackId: string;
    uri: string;
  } | null>(null);
  const spotifyCallbackHandledRef = useRef(false);
  const spotifyPollingErrorRef = useRef(false);
  const hasAnnouncedKnowledgeRef = useRef(false);
  const lastSpokenRef = useRef("");
  const voiceAbortRef = useRef<AbortController | null>(null);
  const voiceRunIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void api.status().then(setStatus);
    void api.listReviewItems().then(setReviewItems);
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const loadVoices = () => {
      setBrowserVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    if (spotifyCallbackHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const authError = params.get("error");
    if (authError) {
      spotifyCallbackHandledRef.current = true;
      setMessages((items) => [
        ...items,
        makeMessage("ai", `> SPOTIFY_AUTH_FAILED. ${authError}`)
      ]);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (!code || !state) return;

    const rawPkce = window.localStorage.getItem(SPOTIFY_PKCE_KEY);
    if (!rawPkce) return;
    spotifyCallbackHandledRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);

    const pkce = JSON.parse(rawPkce) as {
      codeVerifier: string;
      state: string;
      clientId: string;
      redirectUri: string;
    };

    if (pkce.state !== state) {
      setMessages((items) => [
        ...items,
        makeMessage("ai", "> SPOTIFY_AUTH_FAILED. State mismatch.")
      ]);
      window.localStorage.removeItem(SPOTIFY_PKCE_KEY);
      return;
    }

    void (async () => {
      try {
        const body = new URLSearchParams({
          client_id: pkce.clientId,
          code,
          code_verifier: pkce.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: pkce.redirectUri
        });

        const response = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(text.slice(0, 500));
        }

        const token = JSON.parse(text) as {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
        };
        const nextSettings = {
          ...readStoredSettings(),
          spotifyAccessToken: token.access_token,
          spotifyClientId: pkce.clientId,
          spotifyRedirectUri: pkce.redirectUri,
          spotifyRefreshToken: token.refresh_token ?? "",
          spotifyTokenExpiresAt: Date.now() + token.expires_in * 1000
        };

        setSettings(nextSettings);
        setDraftSettings(nextSettings);
        writeStoredSettings(nextSettings);
        window.localStorage.removeItem(SPOTIFY_PKCE_KEY);
        setMessages((items) => [
          ...items,
          makeMessage("ai", "> SPOTIFY_LINKED. Playback control token saved locally.")
        ]);
      } catch (error) {
        window.localStorage.removeItem(SPOTIFY_PKCE_KEY);
        setMessages((items) => [
          ...items,
          makeMessage(
            "ai",
            `> SPOTIFY_AUTH_FAILED. ${error instanceof Error ? error.message : String(error)}`
          )
        ]);
      }
    })();
  }, []);

  useEffect(() => {
    chatHistoryRef.current?.scrollTo({
      top: chatHistoryRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages]);

  useEffect(() => {
    if (!reviewItems.length || hasAnnouncedKnowledgeRef.current) return;

    hasAnnouncedKnowledgeRef.current = true;
    const trackCount = reviewItems.reduce((sum, item) => sum + item.tracks.length, 0);
    setMessages((items) => [
      ...items,
      makeMessage(
        "ai",
        `> BILIBILI_DISTILLATION_READY. ${reviewItems.length} playlists / ${trackCount} track placements loaded.`
      )
    ]);
  }, [reviewItems]);

  const stopVoicePlayback = useCallback((keepSpeakingState = false) => {
    voiceRunIdRef.current += 1;
    voiceAbortRef.current?.abort();
    voiceAbortRef.current = null;
    setIsDjSpeaking(keepSpeakingState);

    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isPlaying || !djSet?.tracks.length) return;
    if (hasSpotifyLink) return;
    if (isDjSpeaking) return;

    const timer = window.setInterval(() => {
      setPlaybackPositionMs((current) => {
        const duration = playbackDurationMs || LOCAL_TRACK_DURATION_MS;
        const next = current + Math.max(250, settings.streamBuffer);
        if (next < duration) {
          setProgress(Math.max(0, Math.min(0.995, next / duration)));
          return next;
        }

        const nextIndex = (activeTrackIndex + 1) % djSet.tracks.length;
        advanceToTrackIndex(nextIndex, "local-timer");
        return 0;
      });
    }, Math.max(250, settings.streamBuffer));

    return () => window.clearInterval(timer);
  }, [
    activeTrackIndex,
    djSet?.tracks.length,
    hasSpotifyLink,
    isDjSpeaking,
    isPlaying,
    playbackDurationMs,
    settings.streamBuffer
  ]);

  const activeTrack = djSet?.tracks[activeTrackIndex] ?? null;
  const activeSegment =
    djSet?.segments.find((segment) => segment.beforeTrackId === activeTrack?.id) ??
    djSet?.segments[activeTrackIndex] ??
    null;
  const activeSubtitle =
    activeSegment?.script ??
    "生成一个主题后，这里会显示 DJ 串场短句。";
  const progressDots = useMemo(() => Array.from({ length: 20 }, (_, index) => index), []);

  useEffect(() => {
    if (!isPlaying || !hasSpotifyLink || !djSet?.tracks.length) return;

    let cancelled = false;
    const tracks = djSet.tracks;

    async function pollSpotifyPlayback() {
      try {
        const accessToken = await getSpotifyAccessToken();
        const response = await fetch("https://api.spotify.com/v1/me/player", {
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        });

        if (response.status === 204) return;

        const text = await response.text();
        if (!response.ok) {
          throw new Error(describeSpotifyApiError(response.status, text));
        }
        if (cancelled) return;

        const playback = JSON.parse(text) as SpotifyPlaybackState;
        if (playback.currently_playing_type && playback.currently_playing_type !== "track") {
          return;
        }

        const durationMs = Number(playback.item?.duration_ms || 0);
        const progressMs = Number(playback.progress_ms || 0);
        const currentUri = String(playback.item?.uri || "");

        if (durationMs > 0) {
          setPlaybackDurationMs(durationMs);
          setPlaybackPositionMs(progressMs);
          setProgress(Math.max(0, Math.min(0.995, progressMs / durationMs)));
        }

        const sync = spotifyAdvanceRef.current;
        const remainingMs = durationMs - progressMs;
        const isCurrentSyncedTrack = Boolean(sync && currentUri && sync.uri === currentUri);
        const endedNearTrackEnd =
          !playback.is_playing && durationMs > 0 && remainingMs <= 2500;

        if (!playback.is_playing && !endedNearTrackEnd) {
          setIsPlaying(false);
          return;
        }

        if (
          sync &&
          isCurrentSyncedTrack &&
          !sync.advanced &&
          durationMs > 0 &&
          (remainingMs <= SPOTIFY_ADVANCE_WINDOW_MS || endedNearTrackEnd)
        ) {
          sync.advanced = true;
          const nextIndex = (activeTrackIndex + 1) % tracks.length;
          advanceToTrackIndex(nextIndex, "spotify-end");
        }

        spotifyPollingErrorRef.current = false;
      } catch (error) {
        if (cancelled || spotifyPollingErrorRef.current) return;
        spotifyPollingErrorRef.current = true;
        setMessages((items) => [
          ...items,
          makeMessage(
            "ai",
            `> SPOTIFY_SYNC_FAILED. ${error instanceof Error ? error.message : String(error)}`
          )
        ]);
      }
    }

    void pollSpotifyPlayback();
    const timer = window.setInterval(() => {
      void pollSpotifyPlayback();
    }, SPOTIFY_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTrackIndex, djSet?.tracks, hasSpotifyLink, isPlaying]);

  const playVoiceLine = useCallback(
    async (
      text: string,
      runtimeSettings: StoredSettings,
      options: { holdStationPlayback?: boolean } = {}
    ) => {
      const cleanText = text.trim();
      if (!cleanText) return;

      stopVoicePlayback(Boolean(options.holdStationPlayback));

      const runId = voiceRunIdRef.current + 1;
      const controller = new AbortController();
      voiceRunIdRef.current = runId;
      voiceAbortRef.current = controller;

      const assertActive = () => {
        if (controller.signal.aborted || voiceRunIdRef.current !== runId) {
          throw new Error("Voice playback cancelled.");
        }
      };

      const waitForAudioEnd = async (audio: HTMLAudioElement) => {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            audio.removeEventListener("ended", onEnded);
            audio.removeEventListener("error", onError);
            controller.signal.removeEventListener("abort", onAbort);
          };
          const onEnded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("Voice audio playback failed."));
          };
          const onAbort = () => {
            audio.pause();
            cleanup();
            reject(new Error("Voice playback cancelled."));
          };

          audio.addEventListener("ended", onEnded, { once: true });
          audio.addEventListener("error", onError, { once: true });
          controller.signal.addEventListener("abort", onAbort, { once: true });
          audio.play().catch((error: unknown) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      };

      assertActive();

      if (runtimeSettings.voiceProvider === "browser") {
        if (!("speechSynthesis" in window)) {
          throw new Error("Browser speechSynthesis is not available.");
        }

        await new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(cleanText);
          utterance.lang = "zh-CN";
          utterance.rate = runtimeSettings.speechRate;
          const selectedVoice =
            browserVoices.find((voice) => voice.voiceURI === runtimeSettings.browserVoiceURI) ??
            browserVoices.find((voice) => voice.lang.toLowerCase().startsWith("zh"));
          if (selectedVoice) utterance.voice = selectedVoice;
          utterance.onend = () => {
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          };
          utterance.onerror = (event) => {
            controller.signal.removeEventListener("abort", onAbort);
            reject(new Error(event.error || "Browser speech failed."));
          };
          const onAbort = () => {
            window.speechSynthesis.cancel();
            reject(new Error("Voice playback cancelled."));
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          window.speechSynthesis.speak(utterance);
        });
        assertActive();
        return;
      }

      if (runtimeSettings.voiceProvider === "minimax") {
        const response = await fetch("/api/tts/minimax", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: cleanText, settings: runtimeSettings }),
          signal: controller.signal
        });
        assertActive();
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(responseText.slice(0, 500));
        }
        const payload = JSON.parse(responseText) as {
          audioDataUrl?: string;
          error?: string;
          ok?: boolean;
        };
        if (!payload.ok || !payload.audioDataUrl) {
          throw new Error(payload.error || "MiniMax returned no audio.");
        }
        audioRef.current = new Audio(payload.audioDataUrl);
        await waitForAudioEnd(audioRef.current);
        assertActive();
        return;
      }

      const endpoint = runtimeSettings.kokoroEndpoint.trim() || defaultSettings.kokoroEndpoint;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
        signal: controller.signal
      });
      assertActive();
      if (!response.ok) {
        throw new Error((await response.text()).slice(0, 500));
      }
      const blob = await response.blob();
      assertActive();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      audio.onerror = () => URL.revokeObjectURL(audioUrl);
      audioRef.current = audio;
      await waitForAudioEnd(audio);
      assertActive();
    },
    [browserVoices, stopVoicePlayback]
  );

  useEffect(() => {
    if (!isPlaying) {
      stopVoicePlayback();
      return;
    }

    const speechKey = `${activeTrack?.id ?? "station"}:${activeSubtitle}`;
    if (!activeSubtitle.trim() || speechKey === lastSpokenRef.current) return;

    let cancelled = false;
    setIsDjSpeaking(true);
    setProgress(0);
    setPlaybackPositionMs(0);
    setPlaybackDurationMs((current) => current || LOCAL_TRACK_DURATION_MS);

    void (async () => {
      try {
        await playVoiceLine(activeSubtitle, settings, { holdStationPlayback: true });
        if (cancelled) return;
        lastSpokenRef.current = speechKey;
        setIsDjSpeaking(false);
        if (hasSpotifyLink && activeTrack) {
          await playTrackOnSpotify(activeTrack, "auto");
        }
      } catch (error) {
        if (cancelled || !isPlaying) return;
        setIsDjSpeaking(false);
        if (isVoiceCancelError(error)) return;
        setMessages((items) => [
          ...items,
          makeMessage(
            "ai",
            `> VOICE_FAILED. ${error instanceof Error ? error.message : String(error)}`
          )
        ]);
      }
    })();

    return () => {
      cancelled = true;
      stopVoicePlayback();
    };
  }, [
    activeSubtitle,
    activeTrack,
    activeTrack?.id,
    hasSpotifyLink,
    isPlaying,
    playVoiceLine,
    settings,
    stopVoicePlayback
  ]);

  const libraryStats = useMemo(() => {
    const tracks = reviewItems.reduce((sum, item) => sum + item.tracks.length, 0);
    const active = reviewItems.filter((item) => item.status === "approved").length;
    const tags = new Set(reviewItems.flatMap((item) => item.themeTags ?? []));

    return {
      active,
      playlists: reviewItems.length,
      tags: tags.size,
      tracks
    };
  }, [reviewItems]);

  const hasLocalApiKey = Boolean(settings.apiKey.trim());

  async function runAssistant(inputText: string) {
    const cleanInput = inputText.trim();
    if (!cleanInput || isBusy) return;

    setIsBusy(true);
    setMessages((items) => [...items, makeMessage("user", cleanInput)]);

    try {
      const result = await api.runAssistant(cleanInput, settings, {
        localMoment: formatLocalMoment(new Date())
      });
      const intentLine = summarizeIntent(result.intent);
      const suggestionLine = formatSuggestions(result);
      const responseMessages = [
        intentLine ? makeMessage("ai", intentLine) : null,
        result.message ? makeMessage("ai", `> ${result.message}`) : null,
        suggestionLine ? makeMessage("ai", suggestionLine) : null
      ].filter((message): message is ChatMessage => Boolean(message));

      if (result.djSet) {
        setDjSet(result.djSet);
        setActiveTrackIndex(0);
        setProgress(0);
        setPlaybackPositionMs(0);
        setPlaybackDurationMs(LOCAL_TRACK_DURATION_MS);
        lastSpokenRef.current = "";
        setView("radio");
        setIsPlaying(true);
        responseMessages.push(
          makeMessage(
            "ai",
            `> FREQUENCY_LOCKED. ${result.djSet.title} / ${result.djSet.tracks.length} tracks / mode=${result.mode ?? "radio"}.`
          )
        );
        if (hasSpotifyLink && result.djSet.tracks[0]) {
          responseMessages.push(
            makeMessage("ai", "> RADIO_OPENING_ARMED. DJ intro will play before Spotify starts.")
          );
        }
      } else {
        setView("chat");
      }

      setMessages((items) => [...items, ...responseMessages]);
    } catch (error) {
      setMessages((items) => [
        ...items,
        makeMessage(
          "ai",
          `> ASSISTANT_FAILED. ${error instanceof Error ? error.message : String(error)}`
        )
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  function handleSubmit() {
    const nextInput = input.trim();
    if (!nextInput) return;

    setInput("");
    void runAssistant(nextInput);
  }

  function insertCommand(command: string) {
    const withoutCommand = input.replace(/^\/(chat|radio|mood|daily|focus)\s*/i, "");
    const nextInput = `${command} ${withoutCommand}`.trimStart();
    setInput(nextInput);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function saveSettings() {
    const normalized: StoredSettings = {
      ...draftSettings,
      apiKey: draftSettings.apiKey.trim(),
      baseUrl: draftSettings.baseUrl.trim() || defaultSettings.baseUrl,
      browserVoiceURI: draftSettings.browserVoiceURI,
      kokoroEndpoint: draftSettings.kokoroEndpoint.trim() || defaultSettings.kokoroEndpoint,
      model: draftSettings.model.trim() || defaultSettings.model,
      maxTokens: Number(draftSettings.maxTokens) || defaultSettings.maxTokens,
      minimaxApiKey: draftSettings.minimaxApiKey.trim(),
      minimaxModel: draftSettings.minimaxModel.trim() || defaultSettings.minimaxModel,
      minimaxVoiceId: draftSettings.minimaxVoiceId.trim(),
      speechRate: Number(draftSettings.speechRate) || defaultSettings.speechRate,
      spotifyAccessToken: draftSettings.spotifyAccessToken,
      spotifyClientId: draftSettings.spotifyClientId.trim(),
      spotifyRedirectUri:
        draftSettings.spotifyRedirectUri.trim() || defaultSettings.spotifyRedirectUri,
      spotifyRefreshToken: draftSettings.spotifyRefreshToken,
      spotifyTokenExpiresAt: Number(draftSettings.spotifyTokenExpiresAt) || 0,
      streamBuffer: Number(draftSettings.streamBuffer) || defaultSettings.streamBuffer,
      temperature: Number(draftSettings.temperature) || defaultSettings.temperature,
      voiceProvider: draftSettings.voiceProvider
    };

    setSettings(normalized);
    writeStoredSettings(normalized);
    setSettingsOpen(false);
    setMessages((items) => [
      ...items,
      makeMessage(
        "ai",
        `> SETTINGS_SYNCED. model=${normalized.model} voice=${normalized.voiceProvider} spotify=${normalized.spotifyAccessToken ? "LINKED" : "NOT_LINKED"} local_secret=${normalized.apiKey ? "SET" : "ENV_OR_MISSING"}.`
      )
    ]);
  }

  async function testVoiceConnection(candidateSettings: StoredSettings) {
    const normalized: StoredSettings = {
      ...candidateSettings,
      browserVoiceURI: candidateSettings.browserVoiceURI,
      kokoroEndpoint: candidateSettings.kokoroEndpoint.trim() || defaultSettings.kokoroEndpoint,
      minimaxApiKey: candidateSettings.minimaxApiKey.trim(),
      minimaxModel: candidateSettings.minimaxModel.trim() || defaultSettings.minimaxModel,
      minimaxVoiceId: candidateSettings.minimaxVoiceId.trim(),
      speechRate: Number(candidateSettings.speechRate) || defaultSettings.speechRate,
      voiceProvider: candidateSettings.voiceProvider
    };

    await playVoiceLine("LEO DJ 声音测试。", normalized);
  }

  function injectDiagnostics() {
    const lines = [
      `> telemetry dump: stream_buffer=${settings.streamBuffer}ms`,
      `knowledge=${libraryStats.playlists} playlists/${libraryStats.tracks} tracks`,
      `database=${status?.databaseReady ? "READY" : "CHECKING"}`,
      `local_key=${hasLocalApiKey ? "SET" : "NOT_SET"}`
    ];
    setMessages((items) => [...items, makeMessage("ai", lines.join(" "))]);
    setView("chat");
  }

  function nudgeTrack() {
    if (!djSet?.tracks.length) {
      setMessages((items) => [
        ...items,
        makeMessage("ai", "> TUNING_WAITING. Generate a station before adjusting the queue.")
      ]);
      setView("chat");
      return;
    }

    const nextIndex = (activeTrackIndex + 1) % djSet.tracks.length;
    advanceToTrackIndex(nextIndex, "nudge");
  }

  function advanceToTrackIndex(
    nextIndex: number,
    source: "nudge" | "spotify-end" | "local-timer"
  ) {
    const nextTrack = djSet?.tracks[nextIndex];
    if (!nextTrack) return;

    setActiveTrackIndex(nextIndex);
    setProgress(0);
    setPlaybackPositionMs(0);
    setPlaybackDurationMs(LOCAL_TRACK_DURATION_MS);
    setView("radio");
    if (hasSpotifyLink) {
      void pauseSpotifyPlayback();
    }
  }

  async function connectSpotify(settingsOverride?: StoredSettings) {
    const sourceSettings = settingsOverride ?? settings;
    const clientId = sourceSettings.spotifyClientId.trim();
    const redirectUri = sourceSettings.spotifyRedirectUri.trim() || getDefaultSpotifyRedirectUri();

    if (!clientId) {
      setMessages((items) => [
        ...items,
        makeMessage("ai", "> SPOTIFY_NEEDS_CLIENT_ID. Paste Spotify Client ID in Settings, then click Open Spotify Login.")
      ]);
      setSettingsOpen(true);
      return;
    }

    const codeVerifier = randomString(96);
    const state = randomString(24);
    const codeChallenge = await makeSpotifyChallenge(codeVerifier);
    const nextSettings = {
      ...sourceSettings,
      spotifyClientId: clientId,
      spotifyRedirectUri: redirectUri
    };

    setSettings(nextSettings);
    setDraftSettings(nextSettings);
    writeStoredSettings(nextSettings);

    window.localStorage.setItem(
      SPOTIFY_PKCE_KEY,
      JSON.stringify({
        clientId,
        codeVerifier,
        redirectUri,
        state
      })
    );

    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", spotifyScopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", codeChallenge);
    window.localStorage.setItem(SPOTIFY_AUTH_URL_KEY, url.toString());
    setMessages((items) => [
      ...items,
      makeMessage("ai", "> SPOTIFY_AUTH_REDIRECT. Leaving local console for Spotify login.")
    ]);
    setSettingsOpen(false);
    window.setTimeout(() => {
      window.location.href = url.toString();
    }, 80);
  }

  async function getSpotifyAccessToken() {
    if (!settings.spotifyAccessToken.trim()) {
      throw new Error("Spotify is not linked.");
    }

    const hasValidToken =
      !settings.spotifyTokenExpiresAt || settings.spotifyTokenExpiresAt - Date.now() > 60_000;
    if (hasValidToken || !settings.spotifyRefreshToken.trim()) {
      return settings.spotifyAccessToken.trim();
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.spotifyClientId,
        grant_type: "refresh_token",
        refresh_token: settings.spotifyRefreshToken
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text.slice(0, 500));
    }

    const token = JSON.parse(text) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    const nextSettings = {
      ...settings,
      spotifyAccessToken: token.access_token,
      spotifyRefreshToken: token.refresh_token ?? settings.spotifyRefreshToken,
      spotifyTokenExpiresAt: Date.now() + token.expires_in * 1000
    };

    setSettings(nextSettings);
    setDraftSettings(nextSettings);
    writeStoredSettings(nextSettings);
    return token.access_token;
  }

  async function getSpotifyPlaybackDevice(accessToken: string) {
    const response = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(describeSpotifyApiError(response.status, text));
    }

    const payload = JSON.parse(text) as { devices?: SpotifyDevice[] };
    const devices = payload.devices ?? [];
    const device =
      devices.find((item) => item.is_active && !item.is_restricted) ??
      devices.find((item) => !item.is_restricted);

    if (!device) {
      throw new Error(
        "No controllable Spotify device found. Open Spotify on desktop/mobile and start any song once, then try again."
      );
    }

    return device;
  }

  async function findSpotifyTrack(track: DjTrack, accessToken: string) {
    if (track.spotifyUri?.trim()) {
      return {
        durationMs: 0,
        uri: track.spotifyUri.trim()
      };
    }

    const queryText = track.artist.trim()
      ? `track:${track.title} artist:${track.artist}`
      : track.title;
    const query = encodeURIComponent(queryText);
    const searchResponse = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=1&q=${query}`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      }
    );
    const searchText = await searchResponse.text();
    if (!searchResponse.ok) {
      throw new Error(describeSpotifyApiError(searchResponse.status, searchText));
    }

    const searchPayload = JSON.parse(searchText) as {
      tracks?: { items?: Array<{ duration_ms?: number; name: string; uri: string }> };
    };
    const item = searchPayload.tracks?.items?.[0];
    if (!item?.uri) {
      throw new Error(`No Spotify track match found for ${track.title}.`);
    }

    return {
      durationMs: Number(item.duration_ms || 0),
      uri: item.uri
    };
  }

  async function playTrackOnSpotify(
    track: DjTrack,
    source: "auto" | "button" | "local-timer" | "nudge" | "play" | "spotify-end"
  ) {
    if (!settings.spotifyAccessToken.trim()) {
      setMessages((items) => [
        ...items,
        makeMessage("ai", "> SPOTIFY_NOT_LINKED. Connect Spotify in Settings first.")
      ]);
      setSettingsOpen(true);
      return;
    }

    try {
      const accessToken = await getSpotifyAccessToken();
      const device = await getSpotifyPlaybackDevice(accessToken);
      const spotifyTrack = await findSpotifyTrack(track, accessToken);
      const endpoint = new URL("https://api.spotify.com/v1/me/player/play");
      if (device.id) endpoint.searchParams.set("device_id", device.id);
      const playResponse = await fetch(endpoint.toString(), {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ uris: [spotifyTrack.uri] })
      });
      const playText = await playResponse.text();
      if (!playResponse.ok && playResponse.status !== 204) {
        throw new Error(describeSpotifyApiError(playResponse.status, playText));
      }

      spotifyAdvanceRef.current = {
        advanced: false,
        trackId: track.id,
        uri: spotifyTrack.uri
      };
      setPlaybackPositionMs(0);
      setPlaybackDurationMs(spotifyTrack.durationMs || LOCAL_TRACK_DURATION_MS);
      setProgress(0);
      setMessages((items) => [
        ...items,
        makeMessage(
          "ai",
          `> SPOTIFY_PLAYBACK_SENT. ${track.title} -> ${device.name} / source=${source}.`
        )
      ]);
    } catch (error) {
      setMessages((items) => [
        ...items,
        makeMessage(
          "ai",
          `> SPOTIFY_PLAYBACK_FAILED. ${error instanceof Error ? error.message : String(error)}`
        )
      ]);
    }
  }

  async function pauseSpotifyPlayback() {
    if (!settings.spotifyAccessToken.trim()) return;

    try {
      const accessToken = await getSpotifyAccessToken();
      const response = await fetch("https://api.spotify.com/v1/me/player/pause", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });
      const text = await response.text();
      if (!response.ok && response.status !== 204) {
        throw new Error(describeSpotifyApiError(response.status, text));
      }
    } catch (error) {
      setMessages((items) => [
        ...items,
        makeMessage(
          "ai",
          `> SPOTIFY_PAUSE_FAILED. ${error instanceof Error ? error.message : String(error)}`
        )
      ]);
    }
  }

  async function playCurrentOnSpotify() {
    if (!activeTrack) {
      setMessages((items) => [
        ...items,
        makeMessage("ai", "> SPOTIFY_WAITING. Generate a station before sending playback.")
      ]);
      return;
    }

    await playTrackOnSpotify(activeTrack, "button");
  }

  const playbackModeLabel = isDjSpeaking
    ? "DJ INTRO"
    : hasSpotifyLink
      ? "SPOTIFY"
      : "LOCAL";
  const playbackTimeLabel = `${formatPlaybackTime(playbackPositionMs)} / ${formatPlaybackTime(
    playbackDurationMs
  )}`;
  const trackPositionLabel = djSet?.tracks.length
    ? `${String(activeTrackIndex + 1).padStart(2, "0")} / ${String(djSet.tracks.length).padStart(2, "0")}`
    : "00 / 00";

  return (
    <main className={isLight ? "console-shell light-mode" : "console-shell"}>
      <DotMatrixCanvas isLight={isLight} isPlaying={isPlaying} />

      <section className="console-container" aria-label="LEO DJ console">
        <div className="card-wrapper">
          <div className={isPlaying ? "card-backlight playing" : "card-backlight paused"} />
          <section className="nothing-card">
            <div className="screw tl" />
            <div className="screw tr" />
            <div className="screw bl" />
            <div className="screw br" />

            <header className="card-header">
              <div className="time-display">
                <span>
                  {clock.getHours().toString().padStart(2, "0")}:
                  {clock.getMinutes().toString().padStart(2, "0")}
                </span>
                <span className="time-sec">
                  {clock.getSeconds().toString().padStart(2, "0")}
                </span>
              </div>
              <button
                aria-label="Toggle theme"
                className="toggle-switch"
                onClick={() => setIsLight((value) => !value)}
                type="button"
              >
                <span className="toggle-knob" />
              </button>
            </header>

            <div className="view-tabs" role="tablist" aria-label="Console view">
              <span
                className="tab-indicator"
                style={{ transform: view === "radio" ? "translateX(100%)" : "translateX(0)" }}
              />
              <button
                className={view === "chat" ? "tab active" : "tab"}
                onClick={() => setView("chat")}
                type="button"
              >
                AI Chat
              </button>
              <button
                className={view === "radio" ? "tab active" : "tab"}
                onClick={() => setView("radio")}
                type="button"
              >
                Radio
              </button>
            </div>

            <div className="content-container">
              <section
                className={view === "chat" ? "home-view active" : "home-view"}
                aria-hidden={view !== "chat"}
              >
                <div className="knowledge-strip">
                  <Activity size={14} />
                  <span>
                    Library distilled: {libraryStats.playlists || "--"} playlists ·{" "}
                    {libraryStats.tracks || "--"} tracks
                  </span>
                </div>
                <div className="chat-history" ref={chatHistoryRef}>
                  {messages.map((message) => (
                    <div className={`msg ${message.role}`} key={message.id}>
                      {message.text}
                    </div>
                  ))}
                  {isBusy ? (
                    <div className="msg ai loading-msg">
                      <Loader2 className="spin" size={15} />
                      <span>&gt; DeepSeek scanning local wavelengths...</span>
                    </div>
                    ) : null}
                </div>

                <div className="command-deck">
                  <button
                    onClick={() => insertCommand("/chat")}
                    type="button"
                  >
                    <Bot size={14} />
                    <span>聊天</span>
                  </button>
                  <button
                    onClick={() => insertCommand("/radio")}
                    type="button"
                  >
                    <Radio size={14} />
                    <span>电台</span>
                  </button>
                  <button
                    onClick={() => insertCommand("/mood")}
                    type="button"
                  >
                    <Activity size={14} />
                    <span>心情</span>
                  </button>
                  <button
                    onClick={() => insertCommand("/daily")}
                    type="button"
                  >
                    <CalendarDays size={14} />
                    <span>今日</span>
                  </button>
                  <button
                    onClick={() => insertCommand("/focus")}
                    type="button"
                  >
                    <Zap size={14} />
                    <span>专注</span>
                  </button>
                  <button
                    onClick={() => setLibraryGuideOpen(true)}
                    type="button"
                  >
                    <BookOpen size={14} />
                    <span>歌单结构</span>
                  </button>
                </div>

                <div className="chat-input-box">
                  <input
                    className="chat-input"
                    disabled={isBusy}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleSubmit();
                    }}
                    placeholder="输入 /chat 聊天，或 /radio /mood /daily /focus..."
                    ref={inputRef}
                    value={input}
                  />
                  <button
                    aria-label="Generate station"
                    className="send-btn"
                    disabled={isBusy}
                    onClick={handleSubmit}
                    type="button"
                  >
                    {isBusy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                  </button>
                </div>
              </section>

              <section
                className={view === "radio" ? "player-view active" : "player-view"}
                aria-hidden={view !== "radio"}
              >
                <div className="radio-info">
                  <div className="radio-badge">
                    <Radio size={13} />
                    <span>Live · LEO 102.4</span>
                  </div>
                  <h1 className="song-title">
                    {activeTrack?.title ?? djSet?.title ?? "Awaiting Frequency"}
                  </h1>
                  <p className="song-artist">
                    {activeTrack ? activeTrack.artist || "Unknown Artist" : "AI DJ _ local console"}
                  </p>
                  <div className="subtitle-box">
                    <span className="subtitle-text">{activeSubtitle}</span>
                    <span className="subtitle-cursor" />
                  </div>
                  <TrackQueue
                    activeTrack={activeTrack}
                    activeTrackIndex={activeTrackIndex}
                    tracks={djSet?.tracks ?? []}
                  />
                </div>

                <div className="controls">
                  <button
                    className={isPlaying ? "play-btn playing" : "play-btn"}
                    onClick={() => {
                      const nextPlaying = !isPlaying;
                      setIsPlaying(nextPlaying);
                      if (nextPlaying) {
                        const speechKey = `${activeTrack?.id ?? "station"}:${activeSubtitle}`;
                        if (
                          hasSpotifyLink &&
                          activeTrack &&
                          lastSpokenRef.current === speechKey
                        ) {
                          void playTrackOnSpotify(activeTrack, "play");
                        }
                      } else {
                        stopVoicePlayback();
                        void pauseSpotifyPlayback();
                      }
                    }}
                    type="button"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause size={26} /> : <Play size={26} />}
                  </button>
                  <div className="progress-stack">
                    <div className="progress-container" aria-hidden="true">
                      {progressDots.map((dot) => {
                        const activeIndex = Math.floor(progress * progressDots.length);
                        const className =
                          dot === activeIndex
                            ? "progress-dot accent"
                            : dot < activeIndex
                              ? "progress-dot active"
                              : "progress-dot";
                        return <span className={className} key={dot} />;
                      })}
                    </div>
                    <div className="progress-readout">
                      <span>{playbackTimeLabel}</span>
                      <strong>{playbackModeLabel}</strong>
                      <span>{trackPositionLabel}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>

        <div className="control-rack" aria-label="Console controls">
          <button
            className="rack-btn"
            data-tooltip="Settings"
            onClick={() => {
              setDraftSettings(settings);
              setSettingsOpen(true);
            }}
            type="button"
          >
            <Settings className="icon-gear" size={22} />
          </button>
          <button
            className="rack-btn"
            data-tooltip="Next / Tune"
            onClick={nudgeTrack}
            type="button"
          >
            <SlidersHorizontal size={22} />
          </button>
          <button
            className="rack-btn"
            data-tooltip="Inject Logs"
            onClick={injectDiagnostics}
            type="button"
          >
            <TerminalSquare size={22} />
          </button>
          <button
            className="rack-btn"
            data-tooltip="Spotify"
            onClick={() => void playCurrentOnSpotify()}
            type="button"
          >
            <Headphones size={22} />
          </button>
        </div>
      </section>

      <SettingsModal
        browserVoices={browserVoices}
        connectSpotify={connectSpotify}
        draftSettings={draftSettings}
        hasEnvFallback={Boolean(status)}
        libraryStats={libraryStats}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onTestVoice={testVoiceConnection}
        open={settingsOpen}
        setDraftSettings={setDraftSettings}
        status={status}
      />
      <LibraryGuideModal
        onClose={() => setLibraryGuideOpen(false)}
        open={libraryGuideOpen}
      />
    </main>
  );
}

function DotMatrixCanvas({
  isLight,
  isPlaying
}: {
  isLight: boolean;
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const surface = canvas;
    const ctx = context;

    let frame = 0;
    let rafId = 0;

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.floor(window.innerWidth * ratio);
      surface.height = Math.floor(window.innerHeight * ratio);
      surface.style.width = `${window.innerWidth}px`;
      surface.style.height = `${window.innerHeight}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw() {
      frame += 0.018;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const bg = isLight ? "#f4f4f4" : "#030303";
      const dot = isLight ? "rgba(0, 0, 0, " : "rgba(255, 255, 255, ";
      const baseAlpha = isLight ? 0.12 : 0.1;
      const activeAlpha = isPlaying ? 0.24 : 0.08;

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const gap = width < 700 ? 20 : 18;
      for (let y = 8; y < height; y += gap) {
        for (let x = 8; x < width; x += gap) {
          const wave = Math.sin(frame + x * 0.012 + y * 0.018) * 0.5 + 0.5;
          const alpha = baseAlpha + wave * activeAlpha;
          ctx.beginPath();
          ctx.fillStyle = `${dot}${alpha})`;
          ctx.arc(x, y, isPlaying ? 1.35 + wave * 0.75 : 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafId = window.requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [isLight, isPlaying]);

  return <canvas className="webgl-container" ref={canvasRef} />;
}

function TrackQueue({
  activeTrack,
  activeTrackIndex,
  tracks
}: {
  activeTrack: DjTrack | null;
  activeTrackIndex: number;
  tracks: DjTrack[];
}) {
  if (!tracks.length) {
    return (
      <div className="queue-mini empty">
        <Music2 size={15} />
        <span>等待 DeepSeek 生成播放队列</span>
      </div>
    );
  }

  const nearby = tracks.slice(activeTrackIndex, activeTrackIndex + 3);
  const wrapped =
    nearby.length < 3 ? [...nearby, ...tracks.slice(0, 3 - nearby.length)] : nearby;

  return (
    <div className="queue-mini">
      {wrapped.map((track, index) => (
        <div
          className={track.id === activeTrack?.id ? "queue-mini-row active" : "queue-mini-row"}
          key={`${track.id}-${index}`}
        >
          <span>{String((tracks.indexOf(track) + 1) || 1).padStart(2, "0")}</span>
          <div>
            <strong>
              {track.title}
              {track.isDiscovery ? <em>DISC</em> : null}
            </strong>
            <small>{track.themeReason}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsModal({
  browserVoices,
  connectSpotify,
  draftSettings,
  hasEnvFallback,
  libraryStats,
  onClose,
  onSave,
  onTestVoice,
  open,
  setDraftSettings,
  status
}: {
  browserVoices: SpeechSynthesisVoice[];
  connectSpotify: (settingsOverride?: StoredSettings) => Promise<void>;
  draftSettings: StoredSettings;
  hasEnvFallback: boolean;
  libraryStats: { active: number; playlists: number; tags: number; tracks: number };
  onClose: () => void;
  onSave: () => void;
  onTestVoice: (settings: StoredSettings) => Promise<void>;
  open: boolean;
  setDraftSettings: (settings: StoredSettings) => void;
  status: BackendStatus | null;
}) {
  const [voiceTestState, setVoiceTestState] = useState<"idle" | "testing" | "ok" | "error">(
    "idle"
  );
  const [voiceTestMessage, setVoiceTestMessage] = useState("not tested");

  function patchSettings(patch: Partial<StoredSettings>) {
    setDraftSettings({ ...draftSettings, ...patch });
    if (
      "voiceProvider" in patch ||
      "kokoroEndpoint" in patch ||
      "minimaxApiKey" in patch ||
      "minimaxModel" in patch ||
      "minimaxVoiceId" in patch ||
      "browserVoiceURI" in patch
    ) {
      setVoiceTestState("idle");
      setVoiceTestMessage("not tested");
    }
  }

  async function runVoiceTest() {
    setVoiceTestState("testing");
    setVoiceTestMessage("playing test line");

    try {
      await onTestVoice(draftSettings);
      setVoiceTestState("ok");
      setVoiceTestMessage("audio route is working");
    } catch (error) {
      setVoiceTestState("error");
      setVoiceTestMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const spotifyLinked = Boolean(draftSettings.spotifyAccessToken.trim());
  const spotifyReady = Boolean(draftSettings.spotifyClientId.trim());
  const spotifyExpiry = draftSettings.spotifyTokenExpiresAt
    ? new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(draftSettings.spotifyTokenExpiresAt))
    : "not issued";

  return (
    <div className={open ? "settings-overlay active" : "settings-overlay"}>
      <section className="settings-window" aria-modal="true" role="dialog">
        <header className="settings-header">
          <div>
            <p className="settings-title">&gt; CONSOLE_SETTINGS</p>
            <span>local owner mode</span>
          </div>
          <button className="settings-close-btn" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>

        <div className="settings-body">
          <label className="form-group">
            <span className="form-label">AI Intelligence Model</span>
            <select
              className="form-select"
              onChange={(event) => patchSettings({ model: event.target.value })}
              value={draftSettings.model}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>

          <label className="form-group">
            <span className="form-label">Secure API Secret Key</span>
            <input
              className="form-input"
              onChange={(event) => patchSettings({ apiKey: event.target.value })}
              placeholder="sk-...................."
              type="password"
              value={draftSettings.apiKey}
            />
          </label>

          <label className="form-group">
            <span className="form-label">API Core Base URL</span>
            <input
              className="form-input"
              onChange={(event) => patchSettings({ baseUrl: event.target.value })}
              placeholder="https://api.deepseek.com"
              value={draftSettings.baseUrl}
            />
          </label>

          <div className="form-grid">
            <label className="form-group">
              <span className="form-label">Temperature</span>
              <input
                className="form-input"
                max="1.5"
                min="0"
                onChange={(event) =>
                  patchSettings({ temperature: Number(event.target.value) })
                }
                step="0.05"
                type="number"
                value={draftSettings.temperature}
              />
            </label>

            <label className="form-group">
              <span className="form-label">Max Tokens</span>
              <input
                className="form-input"
                max="8192"
                min="512"
                onChange={(event) =>
                  patchSettings({ maxTokens: Number(event.target.value) })
                }
                step="256"
                type="number"
                value={draftSettings.maxTokens}
              />
            </label>
          </div>

          <label className="form-group">
            <span className="form-label">Radio Stream Buffer</span>
            <div className="range-slider-box">
              <input
                className="form-range"
                max="2000"
                min="100"
                onChange={(event) =>
                  patchSettings({ streamBuffer: Number(event.target.value) })
                }
                step="50"
                type="range"
                value={draftSettings.streamBuffer}
              />
              <span className="range-val">{draftSettings.streamBuffer}ms</span>
            </div>
          </label>

          <div className="settings-section-title">
            <Mic2 size={15} />
            <span>Voice Model</span>
          </div>

          <div className="form-grid">
            <label className="form-group">
              <span className="form-label">Provider</span>
              <select
                className="form-select"
                onChange={(event) =>
                  patchSettings({ voiceProvider: event.target.value as VoiceProvider })
                }
                value={draftSettings.voiceProvider}
              >
                <option value="browser">Browser Speech (local preview)</option>
                <option value="minimax">MiniMax TTS (configured)</option>
                <option value="kokoro">Local TTS Helper (Kokoro / ChatTTS)</option>
              </select>
            </label>

            <label className="form-group">
              <span className="form-label">Speech Rate</span>
              <input
                className="form-input"
                max="1.3"
                min="0.65"
                onChange={(event) =>
                  patchSettings({ speechRate: Number(event.target.value) })
                }
                step="0.05"
                type="number"
                value={draftSettings.speechRate}
              />
            </label>
          </div>

          <label className="form-group">
            <span className="form-label">Browser Voice</span>
            <select
              className="form-select"
              onChange={(event) => patchSettings({ browserVoiceURI: event.target.value })}
              value={draftSettings.browserVoiceURI}
            >
              <option value="">Auto Chinese voice</option>
              {browserVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} / {voice.lang}
                </option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <label className="form-group">
              <span className="form-label">MiniMax API Key</span>
              <input
                className="form-input"
                onChange={(event) => patchSettings({ minimaxApiKey: event.target.value })}
                placeholder="local only"
                type="password"
                value={draftSettings.minimaxApiKey}
              />
            </label>

            <label className="form-group">
              <span className="form-label">MiniMax Model</span>
              <input
                className="form-input"
                onChange={(event) => patchSettings({ minimaxModel: event.target.value })}
                value={draftSettings.minimaxModel}
              />
            </label>
          </div>

          <label className="form-group">
            <span className="form-label">MiniMax Voice ID</span>
              <input
                className="form-input"
                onChange={(event) => patchSettings({ minimaxVoiceId: event.target.value })}
                placeholder="voice id"
                value={draftSettings.minimaxVoiceId}
              />
          </label>

          <label className="form-group">
            <span className="form-label">Local TTS Helper Endpoint</span>
            <input
              className="form-input"
              onChange={(event) => patchSettings({ kokoroEndpoint: event.target.value })}
              placeholder="http://127.0.0.1:8789/tts"
              value={draftSettings.kokoroEndpoint}
            />
          </label>

          <div className={`voice-test-card ${voiceTestState}`}>
            <div className="voice-test-head">
              <Volume2 size={17} />
              <div>
                <strong>Voice Check</strong>
                <span>{voiceTestMessage}</span>
              </div>
            </div>
            <button
              className="voice-test-btn"
              disabled={voiceTestState === "testing"}
              onClick={() => void runVoiceTest()}
              type="button"
            >
              {voiceTestState === "testing" ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Volume2 size={16} />
              )}
              <span>{voiceTestState === "testing" ? "Testing" : "Test Voice"}</span>
            </button>
          </div>

          <div className="settings-section-title">
            <Headphones size={15} />
            <span>Spotify</span>
          </div>

          <label className="form-group">
            <span className="form-label">Spotify Client ID</span>
            <input
              className="form-input"
              onChange={(event) => patchSettings({ spotifyClientId: event.target.value })}
              placeholder="client id from Spotify Developer Dashboard"
              value={draftSettings.spotifyClientId}
            />
          </label>

          <label className="form-group">
            <span className="form-label">Spotify Redirect URI</span>
            <input
              className="form-input"
              onChange={(event) => patchSettings({ spotifyRedirectUri: event.target.value })}
              value={draftSettings.spotifyRedirectUri}
            />
            <span className="form-hint">Use the same 127.0.0.1 URI in Spotify Dashboard.</span>
          </label>

          <div className="spotify-auth-card">
            <div className="spotify-auth-head">
              <Headphones size={17} />
              <div>
                <strong>{spotifyLinked ? "Spotify Linked" : "Spotify Login"}</strong>
                <span>
                  {spotifyLinked
                    ? `token refresh: ${spotifyExpiry}`
                    : spotifyReady
                      ? "ready to redirect"
                      : "client id required"}
                </span>
              </div>
            </div>
            <p className="spotify-auth-copy">
              Paste Client ID, then this button opens Spotify login and returns here after authorization.
            </p>
            <button
              className="spotify-login-btn"
              onClick={() => void connectSpotify(draftSettings)}
              type="button"
            >
              <Headphones size={16} />
              <span>{spotifyLinked ? "Reauthorize Spotify" : "Open Spotify Login"}</span>
            </button>
          </div>

          <div className="system-matrix">
            <div className="matrix-row">
              <span>LOCAL_SECRET:</span>
              <strong className={draftSettings.apiKey ? "matrix-status" : ""}>
                {draftSettings.apiKey ? "SET" : hasEnvFallback ? "ENV FALLBACK" : "MISSING"}
              </strong>
            </div>
            <div className="matrix-row">
              <span>KNOWLEDGE:</span>
              <strong>
                {libraryStats.playlists} playlists / {libraryStats.tracks} tracks
              </strong>
            </div>
            <div className="matrix-row">
              <span>CORE_KERNEL:</span>
              <strong>{status?.mode ?? "browser-preview"}</strong>
            </div>
            <div className="matrix-row">
              <span>VOICE:</span>
              <strong>{draftSettings.voiceProvider.toUpperCase()}</strong>
            </div>
            <div className="matrix-row">
              <span>SPOTIFY:</span>
              <strong className={draftSettings.spotifyAccessToken ? "matrix-status" : ""}>
                {draftSettings.spotifyAccessToken ? "LINKED" : "NOT_LINKED"}
              </strong>
            </div>
          </div>
        </div>

        <button className="settings-save-btn" onClick={onSave} type="button">
          <Check size={16} />
          <span>Save & Sync Matrix</span>
        </button>
      </section>
      <button aria-label="Close settings" className="settings-scrim" onClick={onClose} type="button" />
      <Zap className="settings-pulse" size={18} />
    </div>
  );
}

function LibraryGuideModal({
  onClose,
  open
}: {
  onClose: () => void;
  open: boolean;
}) {
  return (
    <div className={open ? "settings-overlay active" : "settings-overlay"}>
      <section className="settings-window library-guide-window" aria-modal="true" role="dialog">
        <header className="settings-header">
          <div>
            <p className="settings-title">&gt; OWN_LIBRARY</p>
            <span>local knowledge distillation</span>
          </div>
          <button className="settings-close-btn" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>

        <div className="settings-body">
          <div className="library-guide-block">
            <strong>1. 让自己的 AI 生成结构</strong>
            <p>
              把下面提示词和任意格式歌单一起发给你自己的 AI。它可以处理 Markdown、表格粘贴、
              Spotify/网易云导出、B 站视频列表、Notion 笔记等。
            </p>
          </div>

          <textarea
            className="guide-textarea"
            readOnly
            value={libraryGuidePrompt}
          />

          <div className="library-guide-block">
            <strong>2. 保存到这两个位置</strong>
            <code>data/library/leo_music_knowledge.json</code>
            <code>public/data/library/leo_music_knowledge.json</code>
          </div>

          <div className="library-guide-block">
            <strong>3. 不要提交个人数据</strong>
            <code>data/bilibili/</code>
            <code>data/library/</code>
            <code>data/debug/</code>
            <code>public/data/</code>
          </div>

          <div className="system-matrix">
            <div className="matrix-row">
              <span>FULL_DOC:</span>
              <strong>docs/user-library.md</strong>
            </div>
            <div className="matrix-row">
              <span>TEMPLATE:</span>
              <strong>docs/templates/leo_music_knowledge.example.json</strong>
            </div>
          </div>
        </div>
      </section>
      <button aria-label="Close library guide" className="settings-scrim" onClick={onClose} type="button" />
    </div>
  );
}

export default App;
