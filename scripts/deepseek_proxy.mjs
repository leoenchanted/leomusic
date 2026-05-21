import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATHS = [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")];
const KNOWLEDGE_PATH = path.join(
  ROOT,
  "data",
  "library",
  "leo_music_knowledge.json"
);
const DEBUG_DIR = path.join(ROOT, "data", "debug");
const LATEST_DEEPSEEK_DEBUG_PATH = path.join(DEBUG_DIR, "deepseek-latest.json");

const PORT = Number(process.env.LEO_DJ_API_PORT ?? 8787);
const ASSISTANT_MODES = new Set(["chat", "radio", "mood", "daily", "focus"]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

for (const envPath of ENV_PATHS) loadEnvFile(envPath);

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(request, response, statusCode, payload) {
  const origin = request.headers.origin || "*";
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "vary": "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(payload));
}

function loadKnowledge() {
  return JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf8"));
}

function redactSecretValue(value) {
  return value ? "[redacted]" : "";
}

function sanitizeSettings(settings) {
  const runtime = settings && typeof settings === "object" ? settings : {};

  return {
    ...runtime,
    apiKey: redactSecretValue(runtime.apiKey),
    minimaxApiKey: redactSecretValue(runtime.minimaxApiKey),
    spotifyAccessToken: redactSecretValue(runtime.spotifyAccessToken),
    spotifyRefreshToken: redactSecretValue(runtime.spotifyRefreshToken)
  };
}

function createDebugSnapshot(type, input = {}) {
  return {
    type,
    createdAt: new Date().toISOString(),
    paths: {
      latest: LATEST_DEEPSEEK_DEBUG_PATH
    },
    ...input
  };
}

function writeDebugSnapshot(snapshot) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const safeSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString()
  };
  const payload = `${JSON.stringify(safeSnapshot, null, 2)}\n`;
  const timestamp = safeSnapshot.createdAt.replace(/[:.]/g, "-");
  const historyPath = path.join(DEBUG_DIR, `deepseek-${timestamp}.json`);

  fs.writeFileSync(LATEST_DEEPSEEK_DEBUG_PATH, payload, "utf8");
  fs.writeFileSync(historyPath, payload, "utf8");

  return {
    historyPath,
    latestPath: LATEST_DEEPSEEK_DEBUG_PATH
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}&]+/gu, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function asArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function clipArray(value, limit = 8) {
  return asArray(value).slice(0, limit);
}

function scorePlaylist(playlist, queryTokens) {
  const searchable = normalizeText(
    [
      playlist.theme.primary,
      playlist.theme.englishTitle,
      ...(playlist.theme.tags ?? []),
      ...(playlist.theme.scenes ?? []),
      ...(playlist.theme.moods ?? []),
      playlist.source.title,
      playlist.collection?.title ?? playlist.collection?.name ?? "",
      ...(playlist.tracks ?? [])
        .slice(0, 12)
        .flatMap((track) => [track.title, track.artist])
    ].join(" ")
  );

  let score = 0;
  for (const token of queryTokens) {
    if (searchable.includes(token)) score += 4;
  }
  score += Math.min(playlist.trackCount, 18) / 6;
  return score;
}

function pickContext(knowledge, theme, limit = 8) {
  const tokens = tokenize(theme);
  const scored = knowledge.playlists
    .filter((playlist) => playlist.trackCount > 0)
    .map((playlist) => ({
      playlist,
      score: scorePlaylist(playlist, tokens)
    }))
    .sort((a, b) => b.score - a.score || b.playlist.source.pubdate - a.playlist.source.pubdate);

  const selected =
    scored.some((item) => item.score > 0)
      ? scored.filter((item) => item.score > 0).slice(0, limit)
      : scored.slice(0, limit);

  return selected.map(({ playlist }) => ({
    id: playlist.id,
    theme: playlist.theme.primary,
    tags: playlist.theme.tags,
    scenes: playlist.theme.scenes,
    moods: playlist.theme.moods,
    sourceTitle: playlist.source.title,
    sourceUrl: playlist.source.url,
    tracks: playlist.tracks.slice(0, 8).map((track) => ({
      title: track.title,
      artist: track.artist,
      position: track.position,
      timestamp: track.timestamp
    }))
  }));
}

function buildTasteProfile(knowledge, context) {
  const countValues = new Map();
  const count = (value) => {
    const key = String(value || "").trim();
    if (!key) return;
    countValues.set(key, (countValues.get(key) || 0) + 1);
  };

  for (const playlist of knowledge.playlists ?? []) {
    for (const tag of playlist.theme?.tags ?? []) count(tag);
    for (const scene of playlist.theme?.scenes ?? []) count(scene);
    for (const mood of playlist.theme?.moods ?? []) count(mood);
    for (const track of (playlist.tracks ?? []).slice(0, 8)) count(track.artist);
  }

  const top = (filter) =>
    [...countValues.entries()]
      .filter(([value]) => filter(value))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([value]) => value);

  const contextThemes = context.map((playlist) => playlist.theme).filter(Boolean);
  const contextSignals = [
    ...new Set(
      context.flatMap((playlist) => [
        ...(playlist.tags ?? []),
        ...(playlist.scenes ?? []),
        ...(playlist.moods ?? [])
      ])
    )
  ].slice(0, 18);

  return {
    librarySummary: knowledge.summary,
    strongestLibrarySignals: top((value) => !value.includes("/") && value.length <= 36),
    currentContextThemes: contextThemes,
    currentContextSignals: contextSignals
  };
}

function createPrompt(theme, context, options = {}) {
  const trackCount = options.trackCount ?? 6;
  const tasteProfile = options.tasteProfile ?? {};

  return {
    system: [
      "你是 LEO 的私人 AI DJ，不是聊天助手。",
      "你的任务是基于 LEO 的歌单知识库片段和长期听歌画像，生成一组可播放的 DJ 电台队列。",
      "输出必须是严格 JSON，不要 Markdown，不要解释 JSON 之外的内容。",
      "DJ 串场要像一个真正懂 LEO 长期听歌习惯的私人电台主持人，中文，亲近但克制。",
      "串场不是报幕。它要先建立房间、天气、时间、情绪或记忆感，再自然把听众带进下一首歌。",
      "knowledgeContext 是口味锚点和可引用曲库，不是唯一曲库。",
      "大部分歌要来自 knowledgeContext；可以加入少量 discovery tracks，用来推荐用户可能喜欢但不在当前知识库片段里的歌。",
      "discovery tracks 必须是真实存在、风格明确、能被 Spotify 搜到的歌曲；不要编造曲目。",
      "每个推荐都要简短说明它如何承接主题或上一首歌。",
      "所有 JSON 字符串必须是单行字符串。不要在字符串里输出未转义换行。字符串里的英文双引号必须转义。"
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Generate a private AI DJ set as JSON.",
        requestedTheme: theme,
        outputShape: {
          title: "string",
          sourceTheme: "string",
          tracks: [
            {
              id: "string",
              title: "string",
              artist: "string",
              sourcePlaylistId: "string",
              sourcePlaylistTheme: "string",
              isDiscovery: "boolean",
              themeReason: "string"
            }
          ],
          segments: [
            {
              id: "string",
              beforeTrackId: "string",
              script: "string",
              estimatedSeconds: "number"
            }
          ],
          notes: ["string"]
        },
        rules: [
          "Return JSON only.",
          `Use exactly ${trackCount} tracks.`,
          "Use at least 4 tracks from knowledgeContext.",
          "Use at most 2 discovery tracks outside knowledgeContext.",
          "For discovery tracks, set sourcePlaylistId to \"discovery\" and isDiscovery to true.",
          "For knowledgeContext tracks, set sourcePlaylistId to the source playlist id and isDiscovery to false.",
          "Create one DJ segment before each track.",
          "The first DJ segment is the station opening. It should feel like entering a private late-night radio room, not an announcement.",
          "Every DJ segment should be 2-3 short Chinese sentences, about 55-95 Chinese characters total.",
          "Use concrete taste signals from tasteProfile and knowledgeContext: time, scene, mood, texture, artist lineage, and why this choice fits LEO.",
          "Do not use mechanical phrases like 接下来播放, 为你推荐, 这首歌很适合, 根据你的喜好.",
          "Do not over-explain. Keep it intimate, slightly cinematic, and specific.",
          "Keep every themeReason concise, no more than 64 Chinese characters.",
          "Do not mention APIs, JSON, crawling, or internal data.",
          "Do not call a discovery song new unless it is actually a recent release; say fresh discovery instead.",
          "Return a compact valid JSON object. Do not add comments, trailing commas, or Markdown fences."
        ],
        knowledgeContext: context,
        tasteProfile
      },
      null,
      0
    )
  };
}

function parseAssistantInput(input) {
  const raw = String(input || "").trim();
  const match = raw.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match) {
    return {
      explicitMode: false,
      mode: "radio",
      text: raw || "按此刻状态生成私人电台",
      raw
    };
  }

  const requestedMode = match[1].toLowerCase();
  const mode = ASSISTANT_MODES.has(requestedMode) ? requestedMode : "radio";
  const text = String(match[2] || "").trim();

  return {
    explicitMode: ASSISTANT_MODES.has(requestedMode),
    mode,
    text: text || defaultTextForMode(mode),
    raw
  };
}

function defaultTextForMode(mode) {
  if (mode === "chat") return "陪我聊聊现在适合听什么";
  if (mode === "daily") return "根据今天的时间和状态生成私人电台";
  if (mode === "mood") return "根据我此刻的心情生成私人电台";
  if (mode === "focus") return "生成适合专注的私人电台";
  return "生成一个私人电台";
}

function compactVocabulary(knowledge) {
  const vocabulary = knowledge?.vocabulary || {};
  const pick = (name) =>
    Array.isArray(vocabulary[name])
      ? vocabulary[name].slice(0, 24).map((item) => item.value).filter(Boolean)
      : [];

  return {
    collections: pick("collections"),
    tags: pick("tags"),
    scenes: pick("scenes"),
    moods: pick("moods")
  };
}

function createIntentPrompt(command, knowledge, localMoment) {
  return {
    system: [
      "你是 LEO DJ 的意图蒸馏层，不直接生成歌单。",
      "你的任务是把用户自然语言变成音乐检索条件，并判断应该聊天还是生成电台。",
      "如果用户明确使用 /chat，就只聊天，不生成电台。",
      "如果用户使用 /radio、/mood、/daily、/focus，就必须生成电台意图。",
      "抽象表达要翻译成可检索的中文 tags、scenes、moods、keywords。",
      "只能输出严格 JSON，不要 Markdown，不要解释 JSON 之外的内容。"
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Distill user intent before music retrieval.",
        command: {
          raw: command.raw,
          explicitMode: command.explicitMode,
          requestedMode: command.mode,
          text: command.text
        },
        localMoment,
        availableVocabulary: compactVocabulary(knowledge),
        knowledgeSummary: knowledge.summary,
        outputShape: {
          mode: "chat | radio | mood | daily | focus",
          shouldGenerateRadio: "boolean",
          assistantReply: "string",
          stationTheme: "string",
          retrievalQuery: {
            keywords: ["string"],
            tags: ["string"],
            scenes: ["string"],
            moods: ["string"],
            artists: ["string"],
            avoid: ["string"],
            energy: "low | medium | high",
            timeOfDay: "string"
          },
          suggestedPrompts: ["string"]
        },
        rules: [
          "assistantReply must be short, natural Chinese.",
          "stationTheme should be a concise Chinese station brief used for retrieval.",
          "For abstract feelings, infer scenes and moods instead of copying the sentence only.",
          "Use the library vocabulary to infer the user's taste profile, but do not limit future recommendations to existing library songs.",
          "For /daily, use localMoment to infer time period and date context.",
          "For /focus, prefer stable, low-distraction moods unless the user asks otherwise.",
          "For /chat, shouldGenerateRadio must be false and suggestedPrompts should offer 2-4 station commands.",
          "Return one valid compact JSON object."
        ]
      },
      null,
      0
    )
  };
}

function normalizeIntent(rawIntent, command) {
  const forcedRadio = command.explicitMode && command.mode !== "chat";
  const forcedChat = command.explicitMode && command.mode === "chat";
  const rawMode = String(rawIntent?.mode || command.mode || "radio").toLowerCase();
  const mode = ASSISTANT_MODES.has(rawMode) ? rawMode : command.mode;
  const retrievalQuery = rawIntent?.retrievalQuery || {};
  const stationTheme = String(rawIntent?.stationTheme || command.text || defaultTextForMode(mode)).trim();

  return {
    mode: forcedChat ? "chat" : forcedRadio ? command.mode : mode,
    shouldGenerateRadio: forcedChat
      ? false
      : forcedRadio
        ? true
        : Boolean(rawIntent?.shouldGenerateRadio ?? mode !== "chat"),
    assistantReply: String(rawIntent?.assistantReply || "").trim(),
    stationTheme,
    retrievalQuery: {
      keywords: clipArray(retrievalQuery.keywords),
      tags: clipArray(retrievalQuery.tags),
      scenes: clipArray(retrievalQuery.scenes),
      moods: clipArray(retrievalQuery.moods),
      artists: clipArray(retrievalQuery.artists),
      avoid: clipArray(retrievalQuery.avoid),
      energy: String(retrievalQuery.energy || ""),
      timeOfDay: String(retrievalQuery.timeOfDay || "")
    },
    suggestedPrompts: clipArray(rawIntent?.suggestedPrompts, 4)
  };
}

function buildRetrievalText(intent, command) {
  const query = intent.retrievalQuery;
  return [
    command.text,
    intent.stationTheme,
    ...query.keywords,
    ...query.tags,
    ...query.scenes,
    ...query.moods,
    ...query.artists,
    query.energy,
    query.timeOfDay
  ]
    .filter(Boolean)
    .join(" ");
}

async function callIntentPlanner(command, knowledge, settings, localMoment, debugSnapshot) {
  const runtime = readRuntimeSettings(settings);
  const apiKey = runtime.apiKey;
  if (!apiKey) {
    throw new Error("Missing DeepSeek API key. Add it in the console settings or .env.local.");
  }

  const endpoint = `${runtime.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt = createIntentPrompt(command, knowledge, localMoment);
  const requestBody = {
    model: runtime.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ],
    response_format: { type: "json_object" },
    temperature: 0.15,
    max_tokens: Math.min(runtime.maxTokens, 1800)
  };

  if (debugSnapshot) {
    debugSnapshot.runtime = {
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      temperature: runtime.temperature,
      maxTokens: runtime.maxTokens,
      apiKey: runtime.apiKey ? "[redacted]" : ""
    };
    debugSnapshot.intentRequest = {
      endpoint,
      body: requestBody
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const text = await response.text();
  if (debugSnapshot) {
    debugSnapshot.intentResponse = {
      ok: response.ok,
      rawText: text,
      status: response.status
    };
  }

  if (!response.ok) {
    throw new Error(`DeepSeek intent planner ${response.status}: ${text.slice(0, 800)}`);
  }

  const payload = JSON.parse(text);
  if (debugSnapshot) {
    debugSnapshot.intentResponse.payload = payload;
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek intent planner returned an empty message.");
  }

  try {
    const parsed = parseModelJson(content);
    const normalized = normalizeIntent(parsed, command);
    if (debugSnapshot) {
      debugSnapshot.intent = normalized;
      debugSnapshot.intentParseMode = "direct";
    }
    return normalized;
  } catch (error) {
    if (debugSnapshot) {
      debugSnapshot.intentParseError = {
        message: error instanceof Error ? error.message : String(error),
        context: getJsonErrorContext(content, error)
      };
    }

    const repaired = await repairModelJson(content, runtime, error, debugSnapshot);
    const normalized = normalizeIntent(repaired, command);
    if (debugSnapshot) {
      debugSnapshot.intent = normalized;
      debugSnapshot.intentParseMode = "repaired";
    }
    return normalized;
  }
}

function extractJsonText(content) {
  const trimmed = String(content ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");

  if (start !== -1 && end > start) {
    return jsonText.slice(start, end + 1);
  }

  return jsonText;
}

function parseModelJson(content) {
  return JSON.parse(extractJsonText(content));
}

function getJsonErrorContext(content, error) {
  const match = String(error?.message ?? "").match(/position\s+(\d+)/i);
  if (!match) return String(content ?? "").slice(-500);

  const position = Number(match[1]);
  const text = extractJsonText(content);
  return text.slice(Math.max(0, position - 220), position + 220);
}

async function repairModelJson(content, runtime, parseError, debugSnapshot) {
  const endpoint = `${runtime.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const repairBody = {
    model: runtime.model,
    messages: [
      {
        role: "system",
        content:
          "Repair invalid JSON. Return only one valid JSON object. Do not add Markdown or explanation. Preserve all valid fields. If a string is unterminated, close it safely."
      },
      {
        role: "user",
        content: JSON.stringify({
          error: String(parseError?.message ?? parseError),
          invalidJson: extractJsonText(content)
        })
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: runtime.maxTokens
  };

  if (debugSnapshot) {
    debugSnapshot.repairRequest = {
      endpoint,
      body: repairBody
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${runtime.apiKey}`
    },
    body: JSON.stringify(repairBody)
  });

  const text = await response.text();
  if (debugSnapshot) {
    debugSnapshot.repairResponse = {
      ok: response.ok,
      status: response.status,
      rawText: text
    };
  }

  if (!response.ok) {
    throw new Error(`DeepSeek JSON repair ${response.status}: ${text.slice(0, 800)}`);
  }

  const payload = JSON.parse(text);
  if (debugSnapshot) {
    debugSnapshot.repairResponse.payload = payload;
  }

  const repaired = payload.choices?.[0]?.message?.content;
  if (!repaired) {
    throw new Error("DeepSeek JSON repair returned an empty message.");
  }

  return parseModelJson(repaired);
}

function normalizeDjSet(raw, theme) {
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  const segments = Array.isArray(raw.segments) ? raw.segments : [];

  return {
    id: `dj-${Date.now()}`,
    title: String(raw.title || "LEO 私人电台"),
    sourceTheme: String(raw.sourceTheme || theme),
    provider: "deepseek",
    tracks: tracks.map((track, index) => ({
      id: String(track.id || `track-${index + 1}`),
      title: String(track.title || ""),
      artist: String(track.artist || ""),
      isDiscovery: Boolean(track.isDiscovery || track.sourcePlaylistId === "discovery"),
      sourcePlaylistId: String(track.sourcePlaylistId || (track.isDiscovery ? "discovery" : "")),
      sourcePlaylistTheme: String(track.sourcePlaylistTheme || ""),
      themeReason: String(track.themeReason || "贴合当前主题。")
    })),
    segments: segments.map((segment, index) => ({
      id: String(segment.id || `segment-${index + 1}`),
      beforeTrackId: String(segment.beforeTrackId || tracks[index]?.id || `track-${index + 1}`),
      script: String(segment.script || ""),
      estimatedSeconds: Number(segment.estimatedSeconds || 12),
      voiceStatus: "missing"
    })),
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : []
  };
}

function readRuntimeSettings(settings) {
  const runtime = settings && typeof settings === "object" ? settings : {};

  return {
    apiKey: String(runtime.apiKey || process.env.DEEPSEEK_API_KEY || "").trim(),
    baseUrl: String(
      runtime.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
    ).trim(),
    maxTokens: Math.max(
      8192,
      Number(runtime.maxTokens || process.env.DEEPSEEK_MAX_TOKENS || 8192)
    ),
    model: String(
      runtime.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
    ).trim(),
    temperature: Number(
      runtime.temperature ?? process.env.DEEPSEEK_TEMPERATURE ?? 0.85
    )
  };
}

async function callDeepSeek(theme, context, settings, debugSnapshot, knowledge) {
  const runtime = readRuntimeSettings(settings);
  const apiKey = runtime.apiKey;
  if (!apiKey) {
    throw new Error("Missing DeepSeek API key. Add it in the console settings or .env.local.");
  }

  const endpoint = `${runtime.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tasteProfile = knowledge ? buildTasteProfile(knowledge, context) : {};
  const prompt = createPrompt(theme, context, { tasteProfile, trackCount: 6 });
  const requestBody = {
    model: runtime.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ],
    response_format: { type: "json_object" },
    temperature: runtime.temperature,
    max_tokens: runtime.maxTokens
  };

  if (debugSnapshot) {
    debugSnapshot.runtime = {
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      temperature: runtime.temperature,
      maxTokens: runtime.maxTokens,
      apiKey: runtime.apiKey ? "[redacted]" : ""
    };
    debugSnapshot.deepseekRequest = {
      endpoint,
      body: requestBody
    };
    debugSnapshot.tasteProfile = tasteProfile;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const text = await response.text();
  if (debugSnapshot) {
    debugSnapshot.deepseekResponse = {
      ok: response.ok,
      rawText: text,
      status: response.status
    };
  }

  if (!response.ok) {
    throw new Error(`DeepSeek ${response.status}: ${text.slice(0, 800)}`);
  }

  const payload = JSON.parse(text);
  if (debugSnapshot) {
    debugSnapshot.deepseekResponse.payload = payload;
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("DeepSeek returned an empty message.");
  }

  if (choice.finish_reason === "length") {
    throw new Error(
      "DeepSeek output was truncated before JSON completed. Max tokens has been raised to 8192; try again or use a shorter prompt."
    );
  }

  try {
    const parsed = parseModelJson(content);
    if (debugSnapshot) {
      debugSnapshot.parsedModelJson = parsed;
      debugSnapshot.parseMode = "direct";
    }
    return parsed;
  } catch (error) {
    if (debugSnapshot) {
      debugSnapshot.parseError = {
        message: error instanceof Error ? error.message : String(error),
        context: getJsonErrorContext(content, error)
      };
    }

    try {
      const repaired = await repairModelJson(content, runtime, error, debugSnapshot);
      if (debugSnapshot) {
        debugSnapshot.parsedModelJson = repaired;
        debugSnapshot.parseMode = "repaired";
      }
      return repaired;
    } catch (repairError) {
      throw new Error(
        [
          `DeepSeek returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          `Repair failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`,
          `Context near parse error: ${getJsonErrorContext(content, error)}`
        ].join("\n")
      );
    }
  }
}

async function handleGenerateDjSet(request, response) {
  const body = await readJsonBody(request);
  const theme = String(body.theme || "夜行、慢速城市、低亮度 R&B").trim();
  const knowledge = loadKnowledge();
  const context = pickContext(knowledge, theme);
  const debugSnapshot = createDebugSnapshot("deepseek-dj-set", {
    frontendRequest: {
      theme,
      rawBody: {
        ...body,
        settings: sanitizeSettings(body.settings)
      }
    },
    knowledge: {
      path: KNOWLEDGE_PATH,
      selectedContext: context,
      summary: knowledge.summary
    }
  });

  try {
    const raw = await callDeepSeek(theme, context, body.settings, debugSnapshot, knowledge);
    const djSet = normalizeDjSet(raw, theme);
    debugSnapshot.normalizedDjSet = djSet;
    debugSnapshot.result = {
      ok: true
    };
    debugSnapshot.debugFiles = writeDebugSnapshot(debugSnapshot);

    sendJson(request, response, 200, {
      ok: true,
      djSet,
      context: {
        selectedPlaylistIds: context.map((playlist) => playlist.id),
        selectedPlaylistCount: context.length,
        knowledgeSummary: knowledge.summary
      },
      debug: debugSnapshot.debugFiles
    });
  } catch (error) {
    debugSnapshot.result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    debugSnapshot.debugFiles = writeDebugSnapshot(debugSnapshot);
    throw error;
  }
}

async function handleAssistant(request, response) {
  const body = await readJsonBody(request);
  const command = parseAssistantInput(body.input || body.theme || "");
  const localMoment = String(body.localMoment || new Date().toLocaleString("zh-CN"));
  const knowledge = loadKnowledge();
  const debugSnapshot = createDebugSnapshot("deepseek-assistant", {
    frontendRequest: {
      input: body.input || body.theme || "",
      localMoment,
      command,
      rawBody: {
        ...body,
        settings: sanitizeSettings(body.settings)
      }
    }
  });

  try {
    const intent = await callIntentPlanner(
      command,
      knowledge,
      body.settings,
      localMoment,
      debugSnapshot
    );
    const retrievalText = buildRetrievalText(intent, command);
    const context = intent.shouldGenerateRadio ? pickContext(knowledge, retrievalText) : [];

    debugSnapshot.knowledge = {
      path: KNOWLEDGE_PATH,
      retrievalText,
      selectedContext: context,
      summary: knowledge.summary
    };

    if (!intent.shouldGenerateRadio) {
      debugSnapshot.result = {
        ok: true,
        mode: intent.mode
      };
      debugSnapshot.debugFiles = writeDebugSnapshot(debugSnapshot);

      sendJson(request, response, 200, {
        ok: true,
        mode: intent.mode,
        intent,
        message:
          intent.assistantReply ||
          "我先陪你聊。需要电台时，可以输入 /radio、/mood、/daily 或 /focus。",
        suggestions: intent.suggestedPrompts,
        debug: debugSnapshot.debugFiles
      });
      return;
    }

    const raw = await callDeepSeek(
      intent.stationTheme,
      context,
      body.settings,
      debugSnapshot,
      knowledge
    );
    const djSet = normalizeDjSet(raw, intent.stationTheme);
    debugSnapshot.normalizedDjSet = djSet;
    debugSnapshot.result = {
      ok: true,
      mode: intent.mode
    };
    debugSnapshot.debugFiles = writeDebugSnapshot(debugSnapshot);

    sendJson(request, response, 200, {
      ok: true,
      mode: intent.mode,
      intent,
      message: intent.assistantReply,
      suggestions: intent.suggestedPrompts,
      djSet,
      context: {
        selectedPlaylistIds: context.map((playlist) => playlist.id),
        selectedPlaylistCount: context.length,
        retrievalText,
        knowledgeSummary: knowledge.summary
      },
      debug: debugSnapshot.debugFiles
    });
  } catch (error) {
    debugSnapshot.result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    debugSnapshot.debugFiles = writeDebugSnapshot(debugSnapshot);
    throw error;
  }
}

function readVoiceSettings(settings) {
  const runtime = settings && typeof settings === "object" ? settings : {};

  return {
    apiKey: String(runtime.minimaxApiKey || process.env.MINIMAX_API_KEY || "").trim(),
    model: String(
      runtime.minimaxModel || process.env.MINIMAX_TTS_MODEL || "speech-2.8-turbo"
    ).trim(),
    voiceId: String(runtime.minimaxVoiceId || process.env.MINIMAX_TTS_VOICE_ID || "").trim()
  };
}

async function handleMiniMaxTts(request, response) {
  const body = await readJsonBody(request);
  const text = String(body.text || "").trim();
  const runtime = readVoiceSettings(body.settings);

  if (!text) {
    throw new Error("TTS text is empty.");
  }

  if (!runtime.apiKey) {
    throw new Error("Missing MiniMax API key. Add it in Settings or .env.local.");
  }

  if (!runtime.voiceId) {
    throw new Error("Missing MiniMax voice ID. Add it in Settings.");
  }

  const ttsResponse = await fetch("https://api.minimax.io/v1/t2a_v2", {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtime.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      audio_setting: {
        bitrate: 128000,
        channel: 1,
        format: "mp3",
        sample_rate: 32000
      },
      language_boost: "Chinese",
      model: runtime.model,
      output_format: "hex",
      stream: false,
      text,
      voice_setting: {
        pitch: 0,
        speed: 1,
        voice_id: runtime.voiceId,
        vol: 1
      }
    })
  });

  const raw = await ttsResponse.text();
  if (!ttsResponse.ok) {
    throw new Error(`MiniMax ${ttsResponse.status}: ${raw.slice(0, 800)}`);
  }

  const payload = JSON.parse(raw);
  const hexAudio = payload.data?.audio;
  if (!hexAudio) {
    throw new Error(`MiniMax returned no audio. ${raw.slice(0, 800)}`);
  }

  sendJson(request, response, 200, {
    ok: true,
    audioDataUrl: `data:audio/mpeg;base64,${Buffer.from(hexAudio, "hex").toString("base64")}`,
    traceId: payload.trace_id,
    usageCharacters: payload.extra_info?.usage_characters
  });
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendJson(request, response, 200, { ok: true });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(request, response, 200, {
        ok: true,
        deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        knowledgePath: KNOWLEDGE_PATH
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/dj-set") {
      await handleGenerateDjSet(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/assistant") {
      await handleAssistant(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tts/minimax") {
      await handleMiniMaxTts(request, response);
      return;
    }

    sendJson(request, response, 404, { ok: false, error: "Not found." });
  } catch (error) {
    sendJson(request, response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`LEO DJ API is already running at http://127.0.0.1:${PORT}.`);
    console.error("If npm.cmd run api:health returns ok, keep it running and start only the frontend.");
    console.error("To restart it, stop the existing node process that owns this port first.");
    process.exitCode = 1;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`LEO DJ DeepSeek proxy running at http://127.0.0.1:${PORT}`);
  console.log(
    `DeepSeek configured: ${process.env.DEEPSEEK_API_KEY ? "yes" : "no"}`
  );
});
