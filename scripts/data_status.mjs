import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const knowledgePath = path.join(ROOT, "data", "library", "leo_music_knowledge.json");
const publicKnowledgePath = path.join(
  ROOT,
  "public",
  "data",
  "library",
  "leo_music_knowledge.json",
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function topCounts(playlists, field, limit = 10) {
  const map = new Map();
  for (const playlist of playlists) {
    const values = playlist.theme?.[field] ?? [];
    for (const value of values) {
      if (!value) continue;
      map.set(value, (map.get(value) ?? 0) + 1);
    }
  }

  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([value, count]) => `${value}(${count})`);
}

function trackBuckets(playlists) {
  const buckets = {
    "0": 0,
    "1-4": 0,
    "5-9": 0,
    "10-19": 0,
    "20+": 0,
  };

  for (const playlist of playlists) {
    const count = playlist.tracks?.length ?? 0;
    if (count === 0) buckets["0"] += 1;
    else if (count < 5) buckets["1-4"] += 1;
    else if (count < 10) buckets["5-9"] += 1;
    else if (count < 20) buckets["10-19"] += 1;
    else buckets["20+"] += 1;
  }

  return buckets;
}

if (!existsSync(knowledgePath)) {
  console.error("Missing data/library/leo_music_knowledge.json");
  process.exit(1);
}

const knowledge = readJson(knowledgePath);
const playlists = Array.isArray(knowledge.playlists) ? knowledge.playlists : [];
const summary = knowledge.summary ?? {};
const source = knowledge.source ?? {};
const buckets = trackBuckets(playlists);
const publicCopyOk = existsSync(publicKnowledgePath);

console.log("LEO DJ knowledge status");
console.log(`Source: ${source.kind ?? "unknown"} ${source.url ?? ""}`.trim());
console.log(`Generated: ${knowledge.generatedAt ?? "unknown"}`);
console.log(`Backend file: data/library/leo_music_knowledge.json`);
console.log(`Frontend copy: ${publicCopyOk ? "public/data/library/leo_music_knowledge.json" : "missing"}`);
console.log("");
console.log(`Playlists: ${summary.activePlaylists ?? playlists.length}`);
console.log(`Source videos: ${summary.sourceVideos ?? "unknown"}`);
console.log(`Playlists with tracks: ${summary.playlistsWithTracks ?? "unknown"}`);
console.log(`Theme-only playlists: ${summary.themeOnlyPlaylists ?? "unknown"}`);
console.log(`Track placements: ${summary.trackPlacements ?? "unknown"}`);
console.log(`Unique track keys: ${summary.uniqueTrackKeys ?? "unknown"}`);
console.log(`Inferred artist placements: ${summary.inferredArtistPlacements ?? "unknown"}`);
console.log("");
console.log(`Track count buckets: 0=${buckets["0"]}, 1-4=${buckets["1-4"]}, 5-9=${buckets["5-9"]}, 10-19=${buckets["10-19"]}, 20+=${buckets["20+"]}`);
console.log(`Top scenes: ${topCounts(playlists, "scenes").join(", ") || "none"}`);
console.log(`Top moods: ${topCounts(playlists, "moods").join(", ") || "none"}`);
console.log(`Top tags: ${topCounts(playlists, "tags").join(", ") || "none"}`);

const samples = playlists.slice(0, 5);
if (samples.length) {
  console.log("");
  console.log("Sample playlists:");
  for (const playlist of samples) {
    const tracks = (playlist.tracks ?? [])
      .slice(0, 3)
      .map((track) => `${track.title}${track.artist ? ` - ${track.artist}` : ""}`)
      .join(" | ");
    console.log(`- ${playlist.theme?.primary ?? playlist.source?.title ?? playlist.id}: ${tracks || "theme only"}`);
  }
}
