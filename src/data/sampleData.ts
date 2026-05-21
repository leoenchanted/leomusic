import type { BackendStatus, DjSet, ImportRun, ReviewItem } from "../types";

export const sampleStatus: BackendStatus = {
  mode: "browser-preview",
  kokoroConfigured: false,
  minimaxConfigured: false,
  spotifyConfigured: false,
  databaseReady: true,
  installable: true
};

export const sampleReviewItems: ReviewItem[] = [
  {
    id: "rvw-001",
    sourceTitle: "凌晨三点适合把城市关小声的歌",
    sourceUrl: "https://www.bilibili.com/",
    coverUrl:
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80",
    theme: "夜行 / 城市 / 慢速",
    mood: "低亮度、私密、留白",
    status: "pending",
    tracks: [
      {
        id: "trk-001",
        title: "Midnight Pretenders",
        artist: "Tomoko Aran",
        confidence: 0.91
      },
      {
        id: "trk-002",
        title: "Plastic Love",
        artist: "Mariya Takeuchi",
        confidence: 0.86
      },
      {
        id: "trk-003",
        title: "Sweet Love",
        artist: "Anita Baker",
        confidence: 0.79
      }
    ]
  },
  {
    id: "rvw-002",
    sourceTitle: "像电影片尾字幕一样离开的 R&B",
    sourceUrl: "https://www.bilibili.com/",
    coverUrl:
      "https://images.unsplash.com/photo-1483412033650-1015ddeb83d1?auto=format&fit=crop&w=900&q=80",
    theme: "片尾 / R&B / 情绪退场",
    mood: "柔软、克制、后劲",
    status: "needs_fix",
    tracks: [
      {
        id: "trk-004",
        title: "Japanese Denim",
        artist: "Daniel Caesar",
        confidence: 0.94
      },
      {
        id: "trk-005",
        title: "Bad Religion",
        artist: "Frank Ocean",
        confidence: 0.83
      },
      {
        id: "trk-006",
        title: "Untitled",
        artist: "Unknown",
        confidence: 0.41
      }
    ]
  }
];

export const sampleDjSet: DjSet = {
  id: "set-001",
  title: "LEO 私人夜航",
  sourceTheme: "夜行、慢速城市、低亮度 R&B",
  tracks: [
    {
      id: "dj-001",
      title: "Midnight Pretenders",
      artist: "Tomoko Aran",
      themeReason: "开场用霓虹感的低速律动建立夜间城市感。"
    },
    {
      id: "dj-002",
      title: "Japanese Denim",
      artist: "Daniel Caesar",
      themeReason: "从城市灯光过渡到更贴近耳边的人声。"
    },
    {
      id: "dj-003",
      title: "Bad Religion",
      artist: "Frank Ocean",
      themeReason: "情绪继续下沉，但旋律保留足够的可听性。"
    }
  ],
  segments: [
    {
      id: "seg-001",
      beforeTrackId: "dj-001",
      script:
        "现在把灯光降一点。先从一首像夜车窗外反光的歌开始，让节奏慢慢把房间推远。",
      estimatedSeconds: 14,
      voiceStatus: "missing"
    },
    {
      id: "seg-002",
      beforeTrackId: "dj-002",
      script:
        "下一首往更近的地方走。不是突然煽情，是把刚才那点霓虹收回来，放到人声里。",
      estimatedSeconds: 13,
      voiceStatus: "missing"
    },
    {
      id: "seg-003",
      beforeTrackId: "dj-003",
      script:
        "这段适合留一点空白。让歌自己说完，像片尾字幕滚到最后还舍不得关掉。",
      estimatedSeconds: 12,
      voiceStatus: "missing"
    }
  ]
};

export function makeImportRun(source: string): ImportRun {
  return {
    id: `imp-${Date.now()}`,
    status: "queued",
    message: `已创建公开投稿扫描任务：${source}`
  };
}
