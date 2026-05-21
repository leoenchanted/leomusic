import { mkdir, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MID = "184745701";
const RAW_PATH = path.join(ROOT, "data", "bilibili", "raw", `${MID}.review.json`);
const OUT_DIR = path.join(ROOT, "data", "bilibili", "processed");
const PUBLIC_OUT_DIR = path.join(ROOT, "public", "data", "bilibili", "processed");
const OUT_JSON = path.join(OUT_DIR, `${MID}.playlists.json`);
const PUBLIC_JSON = path.join(PUBLIC_OUT_DIR, `${MID}.playlists.json`);
const OUT_MD = path.join(OUT_DIR, `${MID}.playlists.md`);

const SCENE_KEYWORDS = [
  "清晨",
  "上午",
  "午后",
  "傍晚",
  "黄昏",
  "深夜",
  "夜晚",
  "春日",
  "夏日",
  "秋日",
  "冬日",
  "雨",
  "海边",
  "城市",
  "校园",
  "咖啡馆",
  "旅行",
  "通勤",
  "开车",
  "散步",
  "学习",
  "写作业",
  "冥想",
  "入眠",
  "独处",
  "放空",
  "思考",
  "钢琴",
  "爵士",
  "R&B",
  "Piano",
  "Jazz",
  "CHILL",
  "Chill"
];

const MOOD_KEYWORDS = [
  "安静",
  "放松",
  "慵懒",
  "朦胧",
  "浪漫",
  "氛围",
  "自由",
  "深邃",
  "温暖",
  "悠闲",
  "治愈",
  "孤独",
  "克制",
  "梦游",
  "休憩",
  "蓝调",
  "chill",
  "relax",
  "quiet",
  "soft",
  "dream",
  "romantic"
];

function cleanText(value) {
  return String(value ?? "")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanThemePart(value) {
  return cleanText(value)
    .replace(/^【|】$/g, "")
    .replace(/^playlist\b\s*/i, "")
    .replace(/\bplaylist\b/gi, "")
    .replace(/\bhi-?res\b/gi, "")
    .replace(/音乐电台|纯音乐电台|电台/g, "")
    .replace(/^[🎵🎧🎶🌅🌃🌇🍃❄️🌙🍊☕️]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTitleParts(title) {
  return title
    .split(/[|｜]/g)
    .map(cleanThemePart)
    .filter(Boolean);
}

function isUsefulThemePart(part) {
  const normalized = part.normalize("NFKC").toLowerCase();
  if (!normalized) return false;
  if (normalized === "playlist") return false;
  if (normalized === "hi-res") return false;
  if (normalized === "音乐电台") return false;
  return true;
}

function classifyKeywords(parts, keywords) {
  const haystack = parts.join(" ").normalize("NFKC").toLowerCase();
  return keywords.filter((keyword) =>
    haystack.includes(keyword.normalize("NFKC").toLowerCase())
  );
}

function inferPrimaryTheme(title, parts) {
  const useful = parts.filter(isUsefulThemePart);
  const chinese = useful.find((part) => /[\u3400-\u9FFF]/.test(part));
  if (chinese) return chinese;

  const ascii = useful.find((part) => /[A-Za-z]/.test(part.normalize("NFKC")));
  if (ascii) return ascii.normalize("NFKC");

  return cleanText(title);
}

function inferEnglishTitle(parts) {
  const found = parts.find((part) => {
    const normalized = part.normalize("NFKC");
    return /[A-Za-z]/.test(normalized) && !/playlist|hi-?res/i.test(normalized);
  });
  return found ? found.normalize("NFKC") : "";
}

function inferDefaultArtist(video) {
  const text = `${video.title} ${video.collections
    .map((collection) => `${collection.title} ${collection.name}`)
    .join(" ")}`.toLowerCase();

  if (text.includes("taylorswift") || text.includes("taylor swift")) {
    return "Taylor Swift";
  }

  if (text.includes("weeknd")) {
    return "The Weeknd";
  }

  return "";
}

function cleanTrackTitle(title) {
  return cleanText(title)
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/^-\s*/, "")
    .trim();
}

function cleanArtist(artist) {
  return cleanText(artist).replace(/\s*[/／]\s*/g, " / ");
}

function normalizeTracks(video) {
  const defaultArtist = inferDefaultArtist(video);
  return video.extractedTracks.map((track, index) => {
    const inferredArtist = !track.artist && Boolean(defaultArtist);
    const artist = cleanArtist(track.artist || defaultArtist);
    return {
      id: `${video.bvid}-${String(index + 1).padStart(2, "0")}`,
      position: index + 1,
      timestamp: track.timestamp,
      title: cleanTrackTitle(track.title),
      artist,
      raw: track.raw,
      confidence: inferredArtist ? 0.72 : track.confidence,
      inferredArtist,
      needsReview: true,
      sourceRpid: track.sourceRpid,
      sourceAuthor: track.sourceAuthor,
      sourceIsOwner: track.sourceIsOwner
    };
  });
}

function normalizePlaylist(video) {
  const parts = splitTitleParts(video.title);
  const tags = [...new Set(parts.filter(isUsefulThemePart))];
  const scenes = classifyKeywords(tags, SCENE_KEYWORDS);
  const moods = classifyKeywords(tags, MOOD_KEYWORDS);
  const tracks = normalizeTracks(video);

  return {
    id: video.bvid,
    status: tracks.length > 0 ? "pending" : "needs_manual_tracks",
    source: {
      bvid: video.bvid,
      aid: video.aid,
      url: video.videoUrl,
      title: video.title,
      coverUrl: video.coverUrl,
      pubdate: video.pubdate,
      pubdateText: video.pubdateText,
      durationText: video.durationText,
      stats: video.stats
    },
    collection: video.collections[0] ?? null,
    theme: {
      primary: inferPrimaryTheme(video.title, parts),
      englishTitle: inferEnglishTitle(parts),
      tags,
      scenes,
      moods,
      rawParts: parts
    },
    description: video.description,
    ownerComment:
      video.commentCandidates.find((comment) => comment.isOwner)?.message ?? "",
    tracks,
    trackCount: tracks.length,
    review: {
      approved: false,
      notes: tracks.length > 0 ? "" : "No timestamped owner/comment playlist found."
    }
  };
}

function makeMarkdown(payload) {
  const lines = [
    "# LEO DJ Playlist Seed",
    "",
    `Source: ${payload.sourceUrl}`,
    `Generated: ${payload.generatedAt}`,
    `Playlists: ${payload.summary.playlists}`,
    `Track candidates: ${payload.summary.trackCandidates}`,
    "",
    "## Review Queue",
    ""
  ];

  for (const playlist of payload.playlists) {
    lines.push(`### ${playlist.theme.primary}`);
    lines.push(`- Video: ${playlist.source.title}`);
    lines.push(`- URL: ${playlist.source.url}`);
    lines.push(`- Collection: ${playlist.collection?.title ?? playlist.collection?.name ?? ""}`);
    lines.push(`- Tags: ${playlist.theme.tags.join(", ")}`);
    lines.push(`- Scenes: ${playlist.theme.scenes.join(", ") || "-"}`);
    lines.push(`- Moods: ${playlist.theme.moods.join(", ") || "-"}`);
    lines.push(`- Tracks: ${playlist.trackCount}`);

    for (const track of playlist.tracks.slice(0, 16)) {
      const artist = track.artist ? ` - ${track.artist}` : "";
      const inferred = track.inferredArtist ? " (artist inferred)" : "";
      lines.push(`  - ${track.timestamp} ${track.title}${artist}${inferred}`);
    }

    if (playlist.trackCount > 16) {
      lines.push(`  - ... ${playlist.trackCount - 16} more`);
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  const playlists = raw.videos
    .map(normalizePlaylist)
    .sort((a, b) => b.source.pubdate - a.source.pubdate);

  const payload = {
    version: 1,
    mid: MID,
    sourceUrl: raw.sourceUrl,
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: raw.generatedAt,
    summary: {
      collections: raw.collections.length,
      videos: raw.videos.length,
      playlists: playlists.length,
      playlistsWithTracks: playlists.filter((playlist) => playlist.trackCount > 0).length,
      trackCandidates: playlists.reduce((sum, playlist) => sum + playlist.trackCount, 0),
      needsManualTracks: playlists.filter((playlist) => playlist.trackCount === 0).length
    },
    collections: raw.collections,
    playlists
  };

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PUBLIC_OUT_DIR, { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(PUBLIC_JSON, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(OUT_MD, makeMarkdown(payload), "utf8");

  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${PUBLIC_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log(JSON.stringify(payload.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
