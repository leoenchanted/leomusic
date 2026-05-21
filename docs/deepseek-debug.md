# DeepSeek Debug Snapshots

The local API proxy writes a sanitized debug snapshot for every `POST /api/assistant`
or `POST /api/dj-set` request.

Files:

- `data/debug/deepseek-latest.json`: newest request/response snapshot.
- `data/debug/deepseek-<timestamp>.json`: historical snapshots.

These files are ignored by git. They can include prompts, selected playlist
context, model output, repaired JSON, and errors. API keys and tokens are
redacted before writing.

Useful fields:

- `frontendRequest`: what the PWA sent to the local proxy.
- `intentRequest.body.messages`: exact intent-distillation messages sent to
  DeepSeek.
- `intentResponse.rawText`: raw DeepSeek response for the intent layer.
- `intent`: normalized assistant plan with mode, radio decision, station theme,
  and retrieval tags/scenes/moods.
- `knowledge.selectedContext`: Bilibili knowledge slices selected for retrieval.
- `tasteProfile`: broader library profile used to guide discovery tracks.
- `deepseekRequest.body.messages`: exact messages sent to DeepSeek.
- `deepseekResponse.rawText`: raw DeepSeek HTTP response.
- `deepseekResponse.payload.choices[0].message.content`: model JSON string.
- `parseMode`: `direct` or `repaired`.
- `parsedModelJson`: parsed model output before app normalization.
- `normalizedDjSet`: final DJ set returned to the frontend.
- `result.error`: failure reason if generation failed.

Local development:

```powershell
npm.cmd run dev:api
npm.cmd run dev
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8787`.

Private/local-owner mode:

- The frontend Settings modal can store DeepSeek, MiniMax, and Spotify values in
  browser `localStorage`.
- The local proxy receives those values per request.
- Do not publish this mode as a shared public site.

Shared use:

1. Keep `scripts/deepseek_proxy.mjs` running on a server.
2. Put provider secrets in server environment variables or `.env.local`.
3. Build the frontend with `npm.cmd run build`.
4. Serve `dist/` and route `/api/*` to the Node proxy.
5. Do not ask other users to paste shared API keys into the browser unless this
   remains a trusted private/local setup.
