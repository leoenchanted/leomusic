# LEO DJ

一个 PWA 形态的私人 AI DJ 工作台。目标是把你的 B 站公开歌单视频、主题、封面和评论歌单整理成个人音乐知识库，再由 AI DJ 自动选歌、写短句串场、合成电台播报，并通过 Spotify 控制播放。

## 当前状态

- 已改成 React + TypeScript + Vite PWA，不需要 Rust，也不需要 Tauri。
- 已加入 `manifest.webmanifest`、service worker 和安装入口。
- 已生成 B 站公开数据审查文件。
- 已生成 processed playlist seed 和正式 music knowledge base，并让 PWA 知识库页读取真实入库数据。
- Spotify、DeepSeek、Kokoro/MiniMax 还没接真实 provider。

## 运行

PowerShell 里用 `npm.cmd`，不要直接用 `npm`。

```powershell
npm.cmd install
npm.cmd run dev
```

打开：

```text
http://127.0.0.1:1420
```

DeepSeek DJ 生成需要另开一个终端运行本地代理：

```powershell
npm.cmd run dev:api
```

确认代理状态：

```powershell
npm.cmd run api:health
```

构建：

```powershell
npm.cmd run build
npm.cmd run preview
```

## PWA 安装

开发模式打开页面后，浏览器地址栏或菜单里会出现“安装应用”。生产构建后也可以作为普通静态站部署。

PWA 版本的限制：

- 浏览器端不能安全保存 MiniMax、DeepSeek、Spotify secret。
- 云端 TTS/LLM 最终应通过本地代理、serverless function 或受控后端调用。
- 本地持久化优先用 IndexedDB；后续可增加导入/导出 JSON。

## B 站数据审查文件

已爬取你的 B 站空间：

```text
https://space.bilibili.com/184745701
```

输出文件：

- `data/bilibili/raw/184745701.review.json`
- `data/bilibili/raw/184745701.review.md`
- `data/bilibili/processed/184745701.playlists.json`
- `data/bilibili/processed/184745701.playlists.md`
- `public/data/bilibili/processed/184745701.playlists.json`
- `data/library/leo_music_knowledge.json`
- `data/library/leo_music_knowledge.md`
- `public/data/library/leo_music_knowledge.json`

本次结果：

- 合集/系列：5
- 视频：117
- 提取到歌单的视频：106
- 候选曲目：1151
- 需要手动补曲目的视频：11
- 正式入库歌单：117
- 去重曲目键：901

重新抓取：

```powershell
npm.cmd run data:refresh
```

脚本只抓公开数据。raw 文件保留原始视频/评论；processed 文件按歌单维度整理主题、场景、情绪和候选曲目；library 文件把所有歌单标记为 active，供 PWA 知识库和后续 DJ 蒸馏读取。

## 语音方案

默认方向仍保留 Kokoro，但 PWA 里不能像桌面程序一样直接跑 Python 后端。后续有两条路：

- Kokoro Web/local helper：免费优先，但需要浏览器 WASM/ONNX 或一个本地小服务。
- MiniMax TTS：声音更像电台 DJ，但需要 API Key 和调用费用/额度，不能把 key 硬写在前端。

MiniMax 官方 T2A HTTP 接口是 `POST https://api.minimax.io/v1/t2a_v2`，模型可用 `speech-2.8-hd`、`speech-2.8-turbo` 等；同步请求文本限制小于 10,000 字符。

## DeepSeek DJ 生成

DeepSeek 已通过本地 Node 代理接入，浏览器只请求 `/api/dj-set`，API Key 只放本地 `.env.local`。

你需要创建 `.env.local`：

```env
DEEPSEEK_API_KEY=你的 key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TEMPERATURE=0.85
DEEPSEEK_MAX_TOKENS=4096
LEO_DJ_API_PORT=8787
```

代理会读取 `data/library/leo_music_knowledge.json`，按输入主题挑选相关歌单片段，再要求 DeepSeek 返回结构化 JSON：电台标题、播放队列、每首歌的推荐理由和每首前 10-20 秒 DJ 串场。

## 下一步

1. 做新歌单追加流程：重新爬取/导入后自动合并到 library。
2. 做 IndexedDB 本地缓存和 JSON 导入/导出。
3. 做 DeepSeek 结果缓存和更强的队列约束。
4. 接 MiniMax TTS 代理或 Kokoro 本地 helper。
5. 接 Spotify OAuth 和播放控制。
