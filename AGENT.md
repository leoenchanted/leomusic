# AGENT.md

## Product Direction

LEO DJ is a PWA private AI DJ workbench. It is not a generic chatbot and not a normal music player. The core experience is:

- ingest LEO's public Bilibili playlist videos;
- extract playlist titles, covers, descriptions, public/pinned comment playlist text, and theme signals;
- generate review files first, then approve data before it becomes knowledge;
- generate themed DJ queues from approved knowledge;
- write short 10-20 second Chinese radio-style transition scripts;
- synthesize those scripts with a pluggable voice provider;
- control Spotify playback after OAuth.

The first version should feel like a private radio control room that can be installed as a PWA. Keep it useful before making it cute.

## Current Stack

- App format: PWA, no Tauri/Rust requirement
- Frontend: React + TypeScript + Vite
- PWA: Web App Manifest + service worker
- Icons: lucide-react
- Planned storage: IndexedDB with JSON import/export
- Current portable data flow: file-based knowledge pack export/import
- Planned LLM provider: DeepSeek-compatible API through a proxy/backend boundary
- Planned TTS providers: local helper endpoint by default (Kokoro/ChatTTS-compatible), MiniMax optional cloud voice
- Planned playback provider: Spotify Web API

The repository contains a PWA scaffold, mock DJ data, docs/templates for user-owned music knowledge bases, and a local Node proxy for DeepSeek/MiniMax calls. LEO's real Bilibili crawl/review/knowledge data is local personal data and should not be committed.

## Existing Bilibili Dataset

- Source: `https://space.bilibili.com/184745701`
- Crawler: `scripts/crawl_bilibili_review.mjs`
- Normalizer: `scripts/build_playlist_seed.mjs`
- Review JSON: `data/bilibili/raw/184745701.review.json`
- Review Markdown: `data/bilibili/raw/184745701.review.md`
- Processed JSON: `data/bilibili/processed/184745701.playlists.json`
- Public PWA seed: `public/data/bilibili/processed/184745701.playlists.json`
- Knowledge JSON used by the proxy: `data/library/leo_music_knowledge.json`
- Public knowledge JSON used by the frontend: `public/data/library/leo_music_knowledge.json`
- Last crawl summary: 5 collections/series, 117 videos, 106 videos with extracted track candidates, 1151 candidate tracks, 11 videos needing manual tracks, 901 unique track keys.

These files are LEO-specific local personal data:

- `data/bilibili/raw/184745701.review.json`
- `data/bilibili/raw/184745701.review.md`
- `data/bilibili/processed/184745701.playlists.json`
- `data/bilibili/processed/184745701.playlists.md`
- `data/library/leo_music_knowledge.json`
- `data/library/leo_music_knowledge.md`
- `public/data/bilibili/processed/184745701.playlists.json`
- `public/data/library/leo_music_knowledge.json`
- `data/debug/*.json`
- `data/exports/*.json`

`.gitignore` should ignore `data/bilibili/`, `data/library/`, `data/debug/`, `data/exports/`, and `public/data/`. If any of those paths are already tracked in a future git repository, remove them from the index with `git rm --cached` instead of deleting the local files.

The crawler uses public Bilibili endpoints, including WBI-signed comment requests. Do not add login cookies unless the user explicitly asks for a logged-in import flow.
The normalizer converts raw videos into playlist records with source metadata, inferred theme fields, scene/mood tags, and normalized track candidates. Inferred artists must remain visible in review.
The knowledge builder auto-approves every crawled playlist for distillation because the user requested no manual approval gate. Future additions should be appended by rerunning `npm.cmd run data:refresh` or a later incremental import flow.

## User-Owned Library Distillation

Every local user can bring their own playlist data. They may paste arbitrary playlist material into their own AI and ask it to generate the project schema. The canonical guide is `docs/user-library.md`; the example schema is `docs/templates/leo_music_knowledge.example.json`.

For a local user-owned knowledge base, save the generated JSON to both:

- `data/library/leo_music_knowledge.json`
- `public/data/library/leo_music_knowledge.json`

The Node proxy reads the first path for DeepSeek retrieval context. The frontend reads the second path for local library stats. This is intentionally file-based for now so each local user can replace the library without needing a database.

The app has an `Own Library` / `歌单结构` guide entry in the chat command deck. It shows the AI prompt, required paths, and ignored personal-data paths.

Portable data packs are handled by `scripts/data_pack.mjs`:

- `npm.cmd run data:status` prints the active knowledge source, playlist/track counts, theme-only playlist count, top scenes/moods/tags, and sample playlists. Use it when the user asks what is currently in the knowledge base.
- `npm.cmd run data:export` writes `data/exports/leo-dj-data-pack-<timestamp>.json`.
- `npm.cmd run data:import -- --in data/exports/<pack>.json` imports that pack into both required knowledge paths.
- Export packs contain the final distilled `leo_music_knowledge.json` and optional `leo_music_knowledge.md`; they do not include raw Bilibili crawl files or DeepSeek debug snapshots.
- `data/exports/` is personal local data and must stay gitignored.

## DeepSeek Integration

- Local proxy: `scripts/deepseek_proxy.mjs`
- Dev command: `npm.cmd run dev:api`
- Primary frontend endpoint: `POST /api/assistant`
- Legacy direct radio endpoint: `POST /api/dj-set`
- Health check: `GET /api/health` or `npm.cmd run api:health`
- Secret location: `.env.local` by default. In the current local-owner workflow, the PWA settings modal may also store the user's DeepSeek-compatible key in browser `localStorage` and forward it only to the local proxy for private desktop use.
- Default model: `deepseek-v4-flash`
- Base URL: `https://api.deepseek.com`
- Default generation size: 6 tracks to reduce malformed/truncated JSON risk
- Default max tokens: 8192
- Debug snapshots: `data/debug/deepseek-latest.json` and `data/debug/deepseek-<timestamp>.json`
- Debug docs: `docs/deepseek-debug.md`

The primary assistant flow is two-stage:

1. Intent distillation: `/api/assistant` first asks DeepSeek for a small strict JSON plan. The plan chooses `chat`, `radio`, `mood`, `daily`, or `focus`, decides whether a radio set should be generated, and converts abstract natural language into `keywords`, `tags`, `scenes`, `moods`, `artists`, `avoid`, `energy`, `timeOfDay`, and a concise `stationTheme`.
2. Radio generation: if `shouldGenerateRadio` is true, the proxy uses the distilled retrieval text to select relevant playlists from `data/library/leo_music_knowledge.json`, builds a compact taste profile from the broader library, then asks DeepSeek for JSON output containing `title`, `sourceTheme`, `tracks`, `segments`, and `notes`.

The library is a taste profile and anchor, not the only allowed catalog. Radio generation should use at least 4 tracks from `knowledgeContext` and may add up to 2 `discovery` tracks outside the current context when they clearly fit the user's habits. Discovery tracks must be real, searchable songs, marked with `sourcePlaylistId: "discovery"` and `isDiscovery: true`, and described as fresh discoveries rather than falsely claiming they are in the user's library.

The chat input supports slash commands:

- `/chat` for pure conversation and station suggestions without generating a set.
- `/radio` for direct station generation.
- `/mood` for mood-led station generation.
- `/daily` for date/time-aware daily station generation.
- `/focus` for low-distraction focus station generation.

The frontend command deck has buttons for those commands. Clicking a button inserts the command prefix into the input; the user can then add their own text before submitting.

Prompts must explicitly ask for JSON because DeepSeek JSON output requires that mode to be requested in the prompt as well as via `response_format`.

Every DJ generation request writes a sanitized debug snapshot. The snapshot should include what the frontend sent, the selected Bilibili knowledge slices, exact DeepSeek request body/messages, raw DeepSeek response, parse mode (`direct` or `repaired`), parsed model JSON, final normalized DJ set, and any error. API keys and tokens must be redacted. `data/debug/*.json` must remain gitignored.

The proxy should defensively handle model JSON failures:

- ask DeepSeek for compact strict JSON;
- constrain output length and string formatting;
- detect `finish_reason === "length"`;
- parse direct JSON first;
- if parsing fails, run one JSON repair request through DeepSeek;
- return useful error context instead of generic frontend JSON parse errors.

## Voice Integration

- Immediate local preview: browser `speechSynthesis`, selected from available local voices.
- MiniMax path: local proxy endpoint `POST /api/tts/minimax`, using MiniMax T2A HTTP with `speech-2.8-turbo` by default and MP3 hex output converted to a data URL.
- Local TTS helper path: configurable helper endpoint, currently expected to accept `POST { text }` and return audio bytes. The same frontend provider can be used for Kokoro, ChatTTS, or any compatible local TTS server.
- ChatTTS helper: `scripts/chattts_server.py` exposes `POST /tts` on `http://127.0.0.1:8789/tts` by default. `npm.cmd run voice:chattts:setup` follows the official ChatTTS install path: clone `https://github.com/2noise/ChatTTS.git` into `D:\chattts\ChatTTS`, create `D:\chattts\.venv`, install `D:\chattts\ChatTTS\requirements.txt`, then add the small Flask wrapper dependencies. `npm.cmd run voice:chattts` starts the wrapper for LEO DJ. The start script sets `HF_HUB_DISABLE_XET=1` for steadier Windows downloads. ChatTTS is Python/PyTorch-based; keep it as a separate Python helper instead of running the model in Node or the browser.
- ChatTTS Python compatibility: prefer Python 3.10 or 3.11. The setup script warns on newer Python versions and continues; if dependency installation fails, rerun with `-Python "D:\Python311\python.exe"` after installing Python 3.11.
- Voice setup guide: `docs/voice-setup.md`.
- Voice settings may be stored in browser `localStorage` for this local-owner workflow.
- Do not commit MiniMax keys, generated audio, model weights, or local TTS caches. `D:\chattts` lives outside the repo by default; `.cache/`, `.local/`, and `chattts/` are ignored if a user installs under the repo.

## Spotify Integration

- Use Spotify Authorization Code with PKCE from the PWA. Do not require or store a Spotify client secret.
- Default Spotify Client ID is centralized in `src/App.tsx` as `DEFAULT_SPOTIFY_CLIENT_ID`; Client ID is public app metadata, not a secret. Change that constant when switching Spotify apps.
- Required scopes: `user-read-playback-state`, `user-read-currently-playing`, `user-modify-playback-state`.
- The Settings panel should provide a clear Spotify login card: paste Client ID, verify Redirect URI, then click the login button to leave for Spotify authorization and return with tokens saved locally.
- The user must create a Spotify app, provide the Client ID, and register the exact local redirect URI shown in Settings. Prefer `http://127.0.0.1:<port>/`; Spotify does not allow `localhost` as a redirect URI.
- Store access token, refresh token, expiry, Client ID, and redirect URI in browser `localStorage` for local-owner mode.
- Refresh expired Spotify tokens with the PKCE refresh-token grant before playback when possible.
- In React dev/StrictMode, guard the Spotify callback so the one-time authorization `code` is not exchanged twice; duplicate exchange returns `invalid_grant`.
- Playback should check `GET /v1/me/player/devices` first, choose the active unrestricted Spotify Connect device or the first unrestricted device, then call `PUT /v1/me/player/play?device_id=...`.
- Generating a radio station should auto-send the first track to Spotify when a token is linked. The main play/pause button should also control Spotify; the rack headphones button manually sends the current track.
- Radio sequence must behave like a station: play the DJ opening/track intro first, then start the matching Spotify track or local simulated track progress. Do not start Spotify before the first DJ opening has played.
- Voice playback must be cancellable. Pausing the station, changing tracks, or starting another voice line must abort any pending TTS request and prevent stale generated audio from playing later.
- When Spotify is linked, queue progress and next-track timing must be driven by Spotify playback state, not the local simulated stream timer. Poll `GET /v1/me/player`, map `progress_ms / duration_ms` to the UI progress and time readout, and only advance the radio queue when the synced Spotify track is at the end window.
- The local simulated stream timer should only advance tracks when Spotify is not linked.
- Playback control should fail clearly for missing Premium, no active device, expired token, Development Mode allowlist problems, or no track match.

## Running The Backend

Local single-user development:

- Run `npm.cmd install` once if dependencies are missing.
- Run `npm.cmd run dev:api` for the Node provider proxy.
- Run `npm.cmd run dev` for the Vite frontend.
- Open `http://127.0.0.1:1420/`.
- Vite proxies `/api/*` to `http://127.0.0.1:8787`.
- The local-owner Settings modal may forward provider keys to the proxy per request.
- If `dev:api` reports `EADDRINUSE` on port `8787`, first run `npm.cmd run api:health`; an `ok` response means the proxy is already running and only the frontend needs to be started.

Private local share / other users running it themselves:

- It is acceptable for each user to paste their own API keys into the browser Settings modal if they are running the app locally on their own machine.
- Each user should generate their own `leo_music_knowledge.json` from their own playlists and place it in both required paths.
- Do not commit any user's generated `data/` or `public/data/` library files.

Hosted/private server share:

- Keep `scripts/deepseek_proxy.mjs` running on a machine or server.
- Put shared provider secrets in server environment variables or `.env.local`, not in frontend source.
- Build with `npm.cmd run build` and serve `dist/`.
- Route `/api/*` from the frontend host to the Node proxy.
- If using Spotify, each deploy URL must be registered as a Redirect URI in the Spotify Developer Dashboard.

Do not expose a public shared build that relies on users entering a common shared API key in browser `localStorage`. For hosted use, prefer server-side provider secrets and user-specific OAuth for Spotify.

## Non-Negotiables

- Do not download, store, or redistribute music audio.
- Do not commit API keys, Spotify secrets, cookies, generated audio, local DBs, model weights, or `node_modules`.
- Imported Bilibili data is auto-approved for distillation unless the user later asks for a manual curation gate.
- Keep TTS provider pluggable. Free local helper providers such as Kokoro or ChatTTS remain the default direction; MiniMax is optional.
- PWA frontend must not hard-code cloud API secrets in source code. For local-only private use, a settings field backed by browser `localStorage` is acceptable; hosted/shared builds must move secrets back behind a proxy, serverless function, or explicit user-owned private deployment.
- Keep DJ speech short by default. The target is radio transition, not a long podcast monologue.
- DJ segments should not feel like mechanical announcements. The first segment is the station opening; each segment should be 2-3 short Chinese sentences, roughly 55-95 Chinese characters, with concrete time/scene/mood/taste signals. Avoid generic phrases like `接下来播放`, `为你推荐`, `这首歌很适合`, and `根据你的喜好`.

## Design Notes

- The active UI direction is a Nothing OS-inspired private radio console: one central glass hardware card, dot-matrix background, red accent, breathing backlight, compact side control rack, and terminal-like AI messages.
- The app should feel like a local radio operating system or piece of desktop hardware, not a generic dashboard, chatbot, or streaming-player skin.
- Preserve the two primary surfaces: `AI Chat` for entering a station theme and system messages, `Radio` for the generated queue, current track, and DJ transition subtitle.
- Use dark mode as the default. Light mode should keep the same glass/hardware language rather than becoming a normal white SaaS UI.
- Settings should look like a hardware service panel. It may expose local-only API key, base URL, model, temperature, max tokens, and stream buffer controls.
- Voice, Spotify, and local-owner credentials belong in the same service-panel settings flow, with status visible in the matrix.
- On mobile, keep the same card-first composition. Shrink the card and move the control rack below it instead of replacing the interface with a conventional page layout.
- Avoid generic music-app gradients, oversized marketing sections, purple/blue AI themes, and decorative blobs. The only strong color system should be Nothing-style red plus the animated playback backlight.
- Keep components stable in size so queue items, scripts, controls, and long generated text do not resize unpredictably.

## Near-Term Implementation Plan

1. Keep knowledge ingestion direct.
   - Load `public/data/library/leo_music_knowledge.json`.
   - Show source video, cover, title, collections, themes, and extracted track candidates.
   - Treat all entries as active unless the user later asks for curation/exclusion.

2. Add a persistent browser data layer.
   - Use IndexedDB for approved videos, tracks, themes, Spotify matches, DJ sets, and voice cache records.
   - Add JSON import/export so the user can back up or move the local knowledge base.

3. Implement DJ generation.
   - DeepSeek proxy exists with strict JSON prompting, one repair retry, debug snapshots, and selected Bilibili knowledge context.
   - Use approved tracks and themes as retrieval context.
   - Require structured output so each recommendation can cite source themes.

4. Implement voice providers.
   - Local helper path: use a Kokoro/ChatTTS-compatible local helper; do not vendor models into the repo.
   - MiniMax path: call `POST https://api.minimax.io/v1/t2a_v2` from a proxy, not directly with a committed key.
   - Cache generated audio by `scriptHash + voiceId + provider`.

5. Implement Spotify.
   - OAuth scopes: `user-read-playback-state`, `user-read-currently-playing`, `user-modify-playback-state`.
   - Handle missing Premium, no active device, 403, 429, and track mismatch clearly.
   - Do not store Spotify client secret in the PWA frontend.

## How To Continue

- Update this file whenever architecture, provider choice, or scope changes.
- Before changing behavior, inspect existing frontend components and data file formats.
- Keep user-facing Chinese copy concise and DJ-like.
- Prefer small vertical slices that can be manually tested from the PWA.
