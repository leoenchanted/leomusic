# 自定义歌单知识库

这个项目可以给不同的人本地使用。每个人都可以把自己的歌单、收藏、播放记录、文本笔记、表格、截图 OCR、Spotify/网易云/YouTube/B 站列表等材料，交给自己的 AI 整理成同一份知识库 JSON。

## 放到哪里

生成出来的知识库 JSON 需要保存两份：

```text
data/library/leo_music_knowledge.json
public/data/library/leo_music_knowledge.json
```

原因：

- `scripts/deepseek_proxy.mjs` 读取 `data/library/leo_music_knowledge.json`，用来给 DeepSeek 做检索上下文。
- 前端 PWA 读取 `public/data/library/leo_music_knowledge.json`，用来显示知识库统计和本地歌单信息。

如果只想先打开前端，缺少这个文件时会 fallback 到 sample data。真正生成私人电台时，后端需要 `data/library/leo_music_knowledge.json`。

## 不要提交个人数据

这些路径是本地个人数据，不应该推到 git：

```text
data/bilibili/
data/library/
data/debug/
data/exports/
public/data/
dist/
```

`data/debug/` 里会有 DeepSeek 请求和返回的调试快照，虽然 key 会被隐藏，但仍然属于本地调试数据。`data/exports/` 是个人知识库导出包，也不要提交。

## 让自己的 AI 生成结构

把下面这段提示词，连同你的原始歌单数据一起发给你自己的 AI。原始数据可以是任意格式。

```text
你是一个音乐知识库结构化助手。请把我提供的任意格式歌单数据，整理成 LEO DJ 项目可读取的 JSON。

输出要求：
1. 只输出一个合法 JSON 对象，不要 Markdown，不要解释。
2. JSON 顶层必须包含：
   - version: number
   - generatedAt: ISO 时间字符串
   - source: object
   - ingestionPolicy: object
   - summary: object
   - vocabulary: object
   - playlists: array
3. playlists 里的每个 playlist 必须包含：
   - id: string，稳定唯一，优先用来源 id，否则用 slug
   - status: "active"
   - ingestion: object
   - source: object
   - collection: object 或 null
   - theme: object
   - trackCount: number
   - tracks: array
4. 每首 track 必须包含：
   - id: string
   - position: number
   - timestamp: string，可没有时间时填 ""
   - title: string
   - artist: string，可未知时填 ""
   - confidence: number，0 到 1
   - inferredArtist: boolean，可选
   - needsReview: boolean，可选
   - raw: string，可选
5. theme 必须包含：
   - primary: string，中文主题名
   - englishTitle: string，可为空
   - tags: string[]
   - scenes: string[]
   - moods: string[]
6. source 必须包含：
   - bvid: string，如果不是 B 站就填来源唯一 id 或 ""
   - title: string
   - url: string
   - coverUrl: string，可为空
   - pubdateText: string，可为空
   - durationText: string，可为空
7. summary 需要统计：
   - collections
   - sourceVideos
   - activePlaylists
   - playlistsWithTracks
   - themeOnlyPlaylists
   - trackPlacements
   - uniqueTrackKeys
   - inferredArtistPlacements
8. 不要编造不存在的歌曲。无法确定歌手时 artist 留空，并把 confidence 降低。
9. 如果同一个来源里有明显主题、场景、情绪，请提炼到 theme.tags/scenes/moods。
10. 输出的 JSON 要能直接保存为 leo_music_knowledge.json。

下面是我的原始歌单数据，请按上面的结构整理：

<<<在这里粘贴我的歌单数据>>>
```

示例结构在：

```text
docs/templates/leo_music_knowledge.example.json
```

## 导出和导入数据包

导出当前机器上的个人知识库：

```powershell
npm.cmd run data:export
```

默认会生成：

```text
data/exports/leo-dj-data-pack-时间戳.json
```

这个导出包只包含最终蒸馏知识库，不包含原始 B 站抓取数据和 debug 快照。换电脑时，把这个 JSON 包放进新项目目录，然后运行：

```powershell
npm.cmd run data:import -- --in data/exports/leo-dj-data-pack-时间戳.json
```

导入会自动写入：

```text
data/library/leo_music_knowledge.json
public/data/library/leo_music_knowledge.json
```

## 本地打开项目

第一次使用先安装依赖：

```powershell
npm.cmd install
```

然后开两个终端。

终端 1，启动本地 AI/语音代理：

```powershell
npm.cmd run dev:api
```

终端 2，启动前端：

```powershell
npm.cmd run dev
```

打开：

```text
http://127.0.0.1:1420/
```

如果 1420 被占用，可以换端口：

```powershell
npm.cmd run dev -- --port 1421
```

确认后端是否活着：

```powershell
npm.cmd run api:health
```

如果 `npm.cmd run dev:api` 报 `EADDRINUSE: address already in use 127.0.0.1:8787`，说明本地后端已经开着了。先跑 `npm.cmd run api:health`，如果返回 `{"ok":true,...}`，就不用再启动后端，直接开前端。

本地自用时，可以在页面 Settings 里填自己的 DeepSeek、MiniMax、Spotify 配置。共享给别人本地跑时，让对方填自己的 key 和导入自己的知识库数据包。

## Spotify 本地授权

Spotify 使用 Authorization Code with PKCE，本地不需要 Client Secret。

1. 在 Spotify Developer Dashboard 创建 app。
2. 把 Settings 里显示的 Redirect URI 加到 Spotify app 的 Redirect URIs。
3. Redirect URI 用 `http://127.0.0.1:1420/` 这类地址，不要用 `localhost`。
4. 在 Settings 填 Spotify Client ID。
5. 点击 `Open Spotify Login`，登录并授权后会回到本地页面，token 会自动保存到浏览器。

如果你换了前端端口，例如 `1421`，Spotify Dashboard 里也要加对应的 `http://127.0.0.1:1421/`。

项目默认 Client ID 写在 `src/App.tsx` 的 `DEFAULT_SPOTIFY_CLIENT_ID`。Client ID 不是 secret，可以放在前端；不要把 Client Secret 放进前端代码。

如果授权后出现 `invalid_grant`，通常是同一个 Spotify authorization code 被重复兑换，或者 Redirect URI 和 Dashboard 不完全一致。刷新本地页面后重新点 `Open Spotify Login`，让它生成新的授权 code。

授权成功不等于 Spotify 已经有可控制的播放设备。播放前请先打开 Spotify 桌面端或手机端，并随便播放/暂停一首歌，让它出现在 Spotify Connect 设备列表里。项目会自动选择 active device；没有设备、没有 Premium、app 还在 Development Mode 且账号没加入 allowlist，都会导致播放 API 失败。

Spotify 已连接时，电台进度会跟随 Spotify 的真实播放状态。项目会轮询 `GET /v1/me/player`，用 `progress_ms / duration_ms` 更新进度，并只在当前 Spotify 歌曲接近结束时切到下一首。未连接 Spotify 时才使用本地模拟进度。
