import { mkdir, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MID = "184745701";
const INPUT = path.join(
  ROOT,
  "data",
  "bilibili",
  "processed",
  `${MID}.playlists.json`
);
const OUT_DIR = path.join(ROOT, "data", "library");
const PUBLIC_OUT_DIR = path.join(ROOT, "public", "data", "library");
const OUT_JSON = path.join(OUT_DIR, "leo_music_knowledge.json");
const PUBLIC_JSON = path.join(PUBLIC_OUT_DIR, "leo_music_knowledge.json");
const OUT_MD = path.join(OUT_DIR, "leo_music_knowledge.md");

function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}&]+/gu, " ")
    .trim();
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function topEntries(map, limit = 40) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function createTrackKey(track) {
  return `${normalizeKey(track.title)}::${normalizeKey(track.artist)}`;
}

function compactPlaylist(playlist) {
  return {
    id: playlist.id,
    status: "active",
    ingestion: {
      approvalMode: "auto_approved_all",
      sourceStatus: playlist.status,
      approvedForDistillation: true,
      needsManualTracks: playlist.trackCount === 0
    },
    source: playlist.source,
    collection: playlist.collection,
    theme: playlist.theme,
    description: playlist.description,
    ownerComment: playlist.ownerComment,
    trackCount: playlist.trackCount,
    tracks: playlist.tracks.map((track) => ({
      ...track,
      libraryStatus: "active",
      trackKey: createTrackKey(track)
    }))
  };
}

function buildKnowledge(seed) {
  const tagFrequency = new Map();
  const sceneFrequency = new Map();
  const moodFrequency = new Map();
  const artistFrequency = new Map();
  const collectionFrequency = new Map();
  const trackIndex = new Map();

  const playlists = seed.playlists.map(compactPlaylist);

  for (const playlist of playlists) {
    increment(
      collectionFrequency,
      playlist.collection?.title ?? playlist.collection?.name ?? "Uncategorized"
    );

    for (const tag of playlist.theme.tags ?? []) increment(tagFrequency, tag);
    for (const scene of playlist.theme.scenes ?? []) increment(sceneFrequency, scene);
    for (const mood of playlist.theme.moods ?? []) increment(moodFrequency, mood);

    for (const track of playlist.tracks) {
      increment(artistFrequency, track.artist || "Unknown");

      const existing = trackIndex.get(track.trackKey) ?? {
        trackKey: track.trackKey,
        title: track.title,
        artist: track.artist,
        occurrences: []
      };

      existing.occurrences.push({
        playlistId: playlist.id,
        playlistTheme: playlist.theme.primary,
        sourceBvid: playlist.source.bvid,
        timestamp: track.timestamp,
        position: track.position,
        inferredArtist: track.inferredArtist
      });
      trackIndex.set(track.trackKey, existing);
    }
  }

  const flattenedTracks = playlists.flatMap((playlist) =>
    playlist.tracks.map((track) => ({
      ...track,
      playlistId: playlist.id,
      playlistTheme: playlist.theme.primary,
      sourceBvid: playlist.source.bvid,
      sourceUrl: playlist.source.url,
      coverUrl: playlist.source.coverUrl
    }))
  );

  const repeatedTracks = [...trackIndex.values()]
    .filter((track) => track.occurrences.length > 1)
    .sort((a, b) => b.occurrences.length - a.occurrences.length)
    .slice(0, 80);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      kind: "bilibili_space",
      mid: MID,
      url: seed.sourceUrl,
      processedGeneratedAt: seed.generatedAt
    },
    ingestionPolicy: {
      approvalMode: "auto_approved_all",
      reason:
        "User explicitly requested all crawled playlists be imported directly for distillation.",
      futureAdditions:
        "New playlists should be appended through the crawler/normalizer and regenerated into this library."
    },
    summary: {
      collections: seed.summary.collections,
      sourceVideos: seed.summary.videos,
      activePlaylists: playlists.length,
      playlistsWithTracks: seed.summary.playlistsWithTracks,
      themeOnlyPlaylists: seed.summary.needsManualTracks,
      trackPlacements: flattenedTracks.length,
      uniqueTrackKeys: trackIndex.size,
      inferredArtistPlacements: flattenedTracks.filter((track) => track.inferredArtist)
        .length
    },
    vocabulary: {
      collections: topEntries(collectionFrequency, 20),
      tags: topEntries(tagFrequency, 80),
      scenes: topEntries(sceneFrequency, 60),
      moods: topEntries(moodFrequency, 60),
      artists: topEntries(artistFrequency, 100)
    },
    distillationProfile: {
      role: "private_ai_dj",
      defaultLanguage: "zh-CN",
      sourceBackedRecommendation: true,
      transitionStyle: "short_radio_bridge_10_to_20_seconds",
      selectionSignals: [
        "playlist theme title",
        "scene tags",
        "mood tags",
        "track order",
        "repeated artists/tracks",
        "source collection"
      ],
      speechRules: [
        "Do not mention that data was scraped.",
        "Explain the mood and transition reason briefly.",
        "Prefer concrete scenes from the original playlist title.",
        "Keep DJ speech between songs concise."
      ]
    },
    collections: seed.collections,
    playlists,
    tracks: flattenedTracks,
    trackIndex: [...trackIndex.values()].sort((a, b) =>
      a.title.localeCompare(b.title)
    ),
    repeatedTracks
  };
}

function makeMarkdown(library) {
  const lines = [
    "# LEO Music Knowledge Base",
    "",
    `Generated: ${library.generatedAt}`,
    `Source: ${library.source.url}`,
    `Approval mode: ${library.ingestionPolicy.approvalMode}`,
    "",
    "## Summary",
    "",
    `- Active playlists: ${library.summary.activePlaylists}`,
    `- Playlists with tracks: ${library.summary.playlistsWithTracks}`,
    `- Theme-only playlists: ${library.summary.themeOnlyPlaylists}`,
    `- Track placements: ${library.summary.trackPlacements}`,
    `- Unique track keys: ${library.summary.uniqueTrackKeys}`,
    "",
    "## Top Scenes",
    "",
    ...library.vocabulary.scenes
      .slice(0, 20)
      .map((entry) => `- ${entry.value}: ${entry.count}`),
    "",
    "## Top Moods",
    "",
    ...library.vocabulary.moods
      .slice(0, 20)
      .map((entry) => `- ${entry.value}: ${entry.count}`),
    "",
    "## Top Artists",
    "",
    ...library.vocabulary.artists
      .slice(0, 30)
      .map((entry) => `- ${entry.value}: ${entry.count}`),
    "",
    "## Playlists",
    ""
  ];

  for (const playlist of library.playlists) {
    lines.push(`### ${playlist.theme.primary}`);
    lines.push(`- Source: ${playlist.source.url}`);
    lines.push(`- Tags: ${playlist.theme.tags.join(", ")}`);
    lines.push(`- Tracks: ${playlist.trackCount}`);
    for (const track of playlist.tracks.slice(0, 10)) {
      const artist = track.artist ? ` - ${track.artist}` : "";
      lines.push(`  - ${track.timestamp} ${track.title}${artist}`);
    }
    if (playlist.trackCount > 10) {
      lines.push(`  - ... ${playlist.trackCount - 10} more`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const library = buildKnowledge(seed);

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PUBLIC_OUT_DIR, { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(library, null, 2), "utf8");
  await writeFile(PUBLIC_JSON, JSON.stringify(library, null, 2), "utf8");
  await writeFile(OUT_MD, makeMarkdown(library), "utf8");

  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${PUBLIC_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log(JSON.stringify(library.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
