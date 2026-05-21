import { mkdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const MID = "184745701";
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "data", "bilibili", "raw");
const REVIEW_JSON = path.join(OUTPUT_DIR, `${MID}.review.json`);
const REVIEW_MD = path.join(OUTPUT_DIR, `${MID}.review.md`);

const headers = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36",
  referer: `https://space.bilibili.com/${MID}`
};

const mixinKeyEncTable = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
  49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55,
  40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
  62, 11, 36, 20, 34, 44, 52
];

let cachedWbiKey = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeImage(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace("http://", "https://");
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function secondsToClock(seconds) {
  const value = Number(seconds || 0);
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  const json = await response.json();
  if (json.code !== 0) {
    throw new Error(`Bilibili API ${json.code}: ${json.message}`);
  }

  return json.data;
}

function encodeWbiValue(value) {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ""));
}

async function getWbiKey() {
  if (cachedWbiKey) return cachedWbiKey;

  const response = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: nav`);
  }

  const json = await response.json();
  const data = json.data;
  if (!data?.wbi_img) {
    throw new Error(`Bilibili nav missing wbi_img: ${json.code} ${json.message}`);
  }

  const imgKey = data.wbi_img.img_url.split("/").pop().split(".")[0];
  const subKey = data.wbi_img.sub_url.split("/").pop().split(".")[0];
  const rawKey = `${imgKey}${subKey}`;
  cachedWbiKey = mixinKeyEncTable
    .map((index) => rawKey[index])
    .join("")
    .slice(0, 32);
  return cachedWbiKey;
}

async function makeWbiUrl(baseUrl, params) {
  const key = await getWbiKey();
  const signedParams = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(signedParams)
    .sort()
    .map((paramKey) => `${encodeWbiValue(paramKey)}=${encodeWbiValue(signedParams[paramKey])}`)
    .join("&");
  const wRid = crypto.createHash("md5").update(`${query}${key}`).digest("hex");
  return `${baseUrl}?${query}&w_rid=${wRid}`;
}

function extractTrackCandidates(message) {
  if (!message) return [];

  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(
        /^(?<time>(?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s+|：|:|-)(?<text>.+)$/
      );
      if (!match?.groups) return null;

      const rawText = match.groups.text.trim();
      const [left, ...right] = rawText.split(/\s+-\s+/);
      const title = (left?.trim() ?? rawText).replace(/^\d+[.)、]\s*/, "");
      const artist = right.join(" - ").trim();

      return {
        timestamp: match.groups.time,
        raw: line,
        title,
        artist,
        confidence: artist ? 0.78 : 0.45,
        needsReview: true
      };
    })
    .filter(Boolean);
}

async function getHomeCollections() {
  const url = `https://api.bilibili.com/x/polymer/web-space/home/seasons_series?mid=${MID}&page_num=1&page_size=20`;
  const data = await fetchJson(url);
  const lists = data.items_lists;

  return {
    seasons: lists.seasons_list ?? [],
    series: lists.series_list ?? []
  };
}

async function getSeasonArchives(season) {
  const total = season.meta.total ?? season.archives?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / 30));
  const archives = [];
  let meta = season.meta;

  for (let page = 1; page <= pages; page += 1) {
    const url = new URL(
      "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list"
    );
    url.searchParams.set("mid", MID);
    url.searchParams.set("season_id", String(season.meta.season_id));
    url.searchParams.set("sort_reverse", "false");
    url.searchParams.set("page_num", String(page));
    url.searchParams.set("page_size", "30");
    url.searchParams.set("web_location", "333.1387");

    const data = await fetchJson(url);
    meta = data.meta ?? meta;
    archives.push(...(data.archives ?? []));
    await sleep(260);
  }

  return { meta, archives };
}

async function getSeriesArchives(series) {
  const total = series.meta.total ?? series.archives?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / 30));
  const archives = [];

  for (let page = 1; page <= pages; page += 1) {
    const url = new URL("https://api.bilibili.com/x/series/archives");
    url.searchParams.set("mid", MID);
    url.searchParams.set("series_id", String(series.meta.series_id));
    url.searchParams.set("only_normal", "true");
    url.searchParams.set("sort", "desc");
    url.searchParams.set("pn", String(page));
    url.searchParams.set("ps", "30");

    const data = await fetchJson(url);
    archives.push(...(data.archives ?? []));
    await sleep(260);
  }

  return { meta: series.meta, archives };
}

async function getVideoDetail(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  return fetchJson(url);
}

async function getCommentCandidates(aid, bvid, ownerMid) {
  const oid = String(aid);
  const url = await makeWbiUrl("https://api.bilibili.com/x/v2/reply/wbi/main", {
    oid,
    oid_str: oid,
    type: 1,
    mode: 3,
    plat: 1,
    next: 0
  });

  const data = await fetchJson(url);
  const candidates = [];
  const allReplies = [
    data.top?.upper,
    ...(data.top_replies ?? []),
    ...(data.replies ?? [])
  ].filter(Boolean);
  const seenReplies = new Set();

  for (const reply of allReplies) {
    const rpid = reply.rpid_str ?? String(reply.rpid ?? "");
    if (seenReplies.has(rpid)) continue;
    seenReplies.add(rpid);

    const message = reply.content?.message ?? "";
    const tracks = extractTrackCandidates(message);
    if (String(reply.mid) === String(ownerMid) || tracks.length > 0) {
      candidates.push({
        rpid,
        author: reply.member?.uname ?? "",
        mid: String(reply.mid ?? ""),
        like: reply.like ?? 0,
        isOwner: String(reply.mid) === String(ownerMid),
        message,
        extractedTracks: tracks
      });
    }
  }

  await sleep(320);
  return {
    bvid,
    allCount: data.cursor?.all_count ?? 0,
    candidates
  };
}

function upsertVideo(videoMap, archive, collection) {
  const aid = String(archive.aid);
  const existing = videoMap.get(aid);
  const collectionRef = {
    type: collection.type,
    id: collection.id,
    title: collection.title,
    name: collection.name
  };

  if (existing) {
    existing.collections.push(collectionRef);
    return;
  }

  videoMap.set(aid, {
    aid: archive.aid,
    bvid: archive.bvid,
    title: archive.title,
    videoUrl: `https://www.bilibili.com/video/${archive.bvid}`,
    coverUrl: normalizeImage(archive.pic),
    pubdate: archive.pubdate,
    pubdateText: formatDate(archive.pubdate),
    duration: archive.duration,
    durationText: secondsToClock(archive.duration),
    stats: archive.stat ?? {},
    collections: [collectionRef],
    description: "",
    owner: null,
    commentCandidates: [],
    extractedTracks: [],
    reviewStatus: "pending"
  });
}

function makeMarkdown(payload) {
  const lines = [
    "# Bilibili Playlist Review",
    "",
    `Source: https://space.bilibili.com/${payload.mid}`,
    `Generated: ${payload.generatedAt}`,
    `Videos: ${payload.videos.length}`,
    "",
    "## Collections",
    ""
  ];

  for (const collection of payload.collections) {
    lines.push(
      `- ${collection.type}: ${collection.title || collection.name} (${collection.total} videos, id ${collection.id})`
    );
  }

  lines.push("", "## Videos", "");

  for (const video of payload.videos) {
    lines.push(`### ${video.title}`);
    lines.push(`- URL: ${video.videoUrl}`);
    lines.push(`- BVID: ${video.bvid}`);
    lines.push(`- Published: ${video.pubdateText}`);
    lines.push(`- Duration: ${video.durationText}`);
    lines.push(
      `- Collections: ${video.collections.map((item) => item.title || item.name).join(", ")}`
    );
    lines.push(`- Extracted tracks: ${video.extractedTracks.length}`);

    if (video.description && video.description !== "-") {
      lines.push(`- Description: ${video.description.replace(/\s+/g, " ").slice(0, 280)}`);
    }

    const ownerComment = video.commentCandidates.find((item) => item.isOwner);
    if (ownerComment) {
      lines.push("", "Owner comment:");
      lines.push("```text");
      lines.push(ownerComment.message.slice(0, 1800));
      lines.push("```");
    }

    if (video.extractedTracks.length > 0) {
      lines.push("", "Track candidates:");
      for (const track of video.extractedTracks.slice(0, 30)) {
        lines.push(
          `- ${track.timestamp} | ${track.title}${track.artist ? ` | ${track.artist}` : ""}`
        );
      }
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const home = await getHomeCollections();
  const collections = [];
  const videoMap = new Map();

  for (const season of home.seasons) {
    const { meta, archives } = await getSeasonArchives(season);
    const collection = {
      type: "season",
      id: meta.season_id,
      title: meta.title,
      name: meta.name,
      description: meta.description,
      total: meta.total
    };
    collections.push(collection);
    for (const archive of archives) {
      upsertVideo(videoMap, archive, collection);
    }
  }

  for (const series of home.series) {
    const { meta, archives } = await getSeriesArchives(series);
    const collection = {
      type: "series",
      id: meta.series_id,
      title: meta.title ?? meta.name,
      name: meta.name,
      description: meta.description,
      total: meta.total
    };
    collections.push(collection);
    for (const archive of archives) {
      upsertVideo(videoMap, archive, collection);
    }
  }

  const videos = [...videoMap.values()].sort((a, b) => b.pubdate - a.pubdate);

  for (const [index, video] of videos.entries()) {
    process.stdout.write(`Fetching ${index + 1}/${videos.length}: ${video.bvid}\n`);
    try {
      const detail = await getVideoDetail(video.bvid);
      video.description = detail.desc ?? "";
      video.owner = detail.owner ?? null;
      video.stats = { ...video.stats, ...detail.stat };
      await sleep(260);

      try {
        const comments = await getCommentCandidates(
          video.aid,
          video.bvid,
          detail.owner?.mid ?? MID
        );
        video.commentCandidates = comments.candidates;
        const trackKeys = new Set();
        video.extractedTracks = comments.candidates
          .flatMap((item) =>
            item.extractedTracks.map((track) => ({
              ...track,
              sourceRpid: item.rpid,
              sourceAuthor: item.author,
              sourceIsOwner: item.isOwner
            }))
          )
          .filter((track) => {
            const key = `${track.timestamp}|${track.title}|${track.artist}`;
            if (trackKeys.has(key)) return false;
            trackKeys.add(key);
            return true;
          });
      } catch (error) {
        video.commentFetchError =
          error instanceof Error ? error.message : String(error);
      }
    } catch (error) {
      video.reviewStatus = "fetch_failed";
      video.fetchError = error instanceof Error ? error.message : String(error);
    }
  }

  const payload = {
    mid: MID,
    sourceUrl: `https://space.bilibili.com/${MID}`,
    generatedAt: new Date().toISOString(),
    collections,
    videos
  };

  await writeFile(REVIEW_JSON, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(REVIEW_MD, makeMarkdown(payload), "utf8");

  process.stdout.write(`Wrote ${REVIEW_JSON}\n`);
  process.stdout.write(`Wrote ${REVIEW_MD}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
