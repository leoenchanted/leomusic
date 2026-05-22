# 自定义歌单知识库

这个项目的“知识库”就是一份本地 JSON 文件。它不存音乐音频，只存你的歌单、主题、场景、心情标签、歌曲名、歌手、来源链接等信息。DeepSeek 会用它理解你的听歌习惯，再生成电台。

## 当前项目里有几类数据

必须分清楚这几个目录：

```text
data/bilibili/
```

这是从 LEO 的 B 站主页抓下来的原始和中间数据，属于 LEO 个人数据。

```text
data/library/leo_music_knowledge.json
```

这是后端真正给 DeepSeek 检索用的知识库。

```text
public/data/library/leo_music_knowledge.json
```

这是前端页面读取的知识库副本，用来显示统计和本地歌单信息。

```text
data/debug/
```

这是 DeepSeek 请求和返回的本地调试快照。

```text
data/exports/
```

这是导出的个人知识库数据包，换电脑时可以带走。

这些目录都不应该提交到 git：

```text
data/bilibili/
data/library/
data/debug/
data/exports/
public/data/
dist/
asset/
```

## 看当前知识库状态

运行：

```powershell
npm.cmd run data:status
```

它会告诉你：

- 当前知识库来源
- 多少个歌单/视频
- 多少首歌曲记录
- 有多少歌单只有主题、还没有歌曲
- 高频场景、心情、标签
- 前几个歌单样例

## 怎么让别人蒸馏自己的歌单

在别人的电脑上，本质流程是：

1. 准备自己的歌单资料。
2. 发给自己的 AI，让 AI 生成 `leo_music_knowledge.json`。
3. 把生成的 JSON 放到项目指定位置。
4. 启动本地后端和前端。

歌单资料可以是任意形式：

- Spotify / Apple Music / 网易云 / QQ 音乐歌单文本
- B 站视频列表
- YouTube playlist
- Notion 笔记
- Markdown 表格
- Excel/CSV 复制出来的文本
- 截图 OCR 后的文字
- 自己手写的“歌名 - 歌手 - 场景/心情”

## 发给 AI 的提示词

把下面这段提示词，加上自己的原始歌单资料，一起发给自己的 AI：

```text
你是一个音乐知识库结构化助手。请把我提供的任意格式歌单数据，整理成 LEO DJ 项目可读取的 JSON。

输出要求：
1. 只输出一个合法 JSON 对象，不要 Markdown，不要解释。
2. JSON 顶层必须包含 version、generatedAt、source、ingestionPolicy、summary、vocabulary、playlists。
3. playlists 里的每个 playlist 必须包含 id、status、ingestion、source、collection、theme、trackCount、tracks。
4. 每首 track 必须包含 id、position、timestamp、title、artist、confidence。
5. theme 必须包含 primary、englishTitle、tags、scenes、moods。
6. source 必须包含 bvid、title、url、coverUrl、pubdateText、durationText。不是 B 站来源时 bvid 可填来源唯一 id 或空字符串。
7. summary 需要统计 collections、sourceVideos、activePlaylists、playlistsWithTracks、themeOnlyPlaylists、trackPlacements、uniqueTrackKeys、inferredArtistPlacements。
8. 不要编造不存在的歌曲。无法确定歌手时 artist 留空，并把 confidence 降低。
9. 如果同一个来源里有明显主题、场景、情绪，请提炼到 theme.tags/scenes/moods。
10. 输出的 JSON 要能直接保存为 leo_music_knowledge.json。

字段说明：
- version: number，填 1。
- generatedAt: ISO 时间字符串。
- source: 描述这份知识库从哪里来。
- ingestionPolicy: 描述这批数据是否自动启用。
- summary: 全局统计。
- vocabulary: 高频 collections/tags/scenes/moods/artists。
- playlists: 歌单数组。

playlist 结构：
- id: 稳定唯一字符串。
- status: "active"。
- ingestion: 可以写 { "method": "ai_distilled", "review": "user_supplied" }。
- source: 来源信息。
- collection: 歌单所属合集，没有就填 null。
- theme: 这个歌单的主题、场景、心情。
- trackCount: tracks 数量。
- tracks: 歌曲数组。

track 结构：
- id: 稳定唯一字符串。
- position: 歌曲顺序，从 1 开始。
- timestamp: 原资料有时间轴就填，没有就填 ""。
- title: 歌名。
- artist: 歌手，不确定就填 ""。
- confidence: 0 到 1。
- inferredArtist: 如果歌手是推断的，填 true。
- needsReview: 不确定时填 true。
- raw: 原始行文本，可选。

下面是我的原始歌单数据，请按上面的结构整理：

<<<把我的歌单资料粘贴在这里>>>
```

参考结构在：

```text
docs/templates/leo_music_knowledge.example.json
```

## 生成后放到哪里

把 AI 输出的 JSON 保存成两份：

```text
data/library/leo_music_knowledge.json
public/data/library/leo_music_knowledge.json
```

原因：

- 后端代理 `scripts/deepseek_proxy.mjs` 读 `data/library/leo_music_knowledge.json`。
- 前端页面读 `public/data/library/leo_music_knowledge.json`。

保存后运行：

```powershell
npm.cmd run data:status
```

确认它能读出来。

## 换电脑怎么带走自己的知识库

在旧电脑导出：

```powershell
npm.cmd run data:export
```

会生成：

```text
data/exports/leo-dj-data-pack-时间戳.json
```

把这个 JSON 文件复制到新电脑项目的 `data/exports/` 下，然后在新电脑导入：

```powershell
npm.cmd run data:import -- --in data/exports/leo-dj-data-pack-时间戳.json
```

导入会自动写入：

```text
data/library/leo_music_knowledge.json
public/data/library/leo_music_knowledge.json
```

然后再检查：

```powershell
npm.cmd run data:status
```

## 本地打开项目

第一次使用先安装依赖：

```powershell
npm.cmd install
```

开两个终端。

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

如果 `dev:api` 报：

```text
EADDRINUSE: address already in use 127.0.0.1:8787
```

说明后端可能已经开着了。先运行：

```powershell
npm.cmd run api:health
```

如果返回 `{"ok":true,...}`，就不用再开后端，只开前端即可。

## ChatTTS 本地声音

第一次安装：

```powershell
npm.cmd run voice:chattts:setup
```

启动 ChatTTS helper：

```powershell
npm.cmd run voice:chattts
```

前端 Settings 里填：

```text
Provider = Local TTS Helper
Local TTS Helper Endpoint = http://127.0.0.1:8789/tts
```

然后点 `Test Voice` 测试声音是否连上。
