# Voice Setup

LEO DJ has three voice modes in Settings:

- `Browser Speech`: fastest local preview. Uses the browser's built-in `speechSynthesis`.
- `MiniMax TTS`: cloud TTS through the local Node proxy.
- `Local TTS Helper`: local TTS helper endpoint that returns audio bytes. This can be Kokoro, ChatTTS, or another local server with the same `/tts` contract.

## MiniMax

Current proxy endpoint:

```text
POST /api/tts/minimax
```

The frontend calls this automatically when:

```text
Settings -> Voice Model -> Provider = MiniMax TTS
```

Required Settings fields:

```text
MiniMax API Key
MiniMax Model
MiniMax Voice ID
```

Default model:

```text
speech-2.8-turbo
```

You can also use `.env.local` instead of browser Settings:

```env
MINIMAX_API_KEY=your_key
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_VOICE_ID=your_voice_id
```

Do not commit `.env.local`.

## ChatTTS

ChatTTS is a Python/PyTorch model. Do not run the model inside Node or the browser. The clean local architecture is:

```text
LEO DJ frontend -> http://127.0.0.1:8789/tts -> Python ChatTTS helper -> audio/wav
```

The repo provides a one-command installer and starter. It follows the official ChatTTS flow: clone the ChatTTS repo, install `requirements.txt`, then run a tiny LEO DJ `/tts` wrapper. By default it installs outside the git repo:

```text
Install dir: D:\chattts
Repo dir:    D:\chattts\ChatTTS
Cache dir:   D:\chattts\cache
```

### One-command setup

ChatTTS is safest on Python 3.10 or 3.11. The official README shows a Python 3.11 conda environment, and PyTorch/torchaudio packages are often not ready for every newest Python release. The setup script will still try newer Python versions and will tell you to install Python 3.11 if dependency installation fails.

If Python 3.11 is available as `python`:

```powershell
npm.cmd run voice:chattts:setup
```

If Python 3.11 is installed somewhere else:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_chattts.ps1 -Python "D:\Python311\python.exe"
```

The setup script creates a virtual environment under `D:\chattts\.venv`, clones the official repo, then runs:

```powershell
git clone https://github.com/2noise/ChatTTS.git D:\chattts\ChatTTS
D:\chattts\.venv\Scripts\python.exe -m pip install -r D:\chattts\ChatTTS\requirements.txt
D:\chattts\.venv\Scripts\python.exe -m pip install flask flask-cors soundfile
```

### Official WebUI

If you only want to test ChatTTS itself, start its own WebUI:

```powershell
D:\chattts\.venv\Scripts\python.exe D:\chattts\ChatTTS\examples\web\webui.py
```

### Start the server

For LEO DJ, start the thin local API wrapper:

```powershell
npm.cmd run voice:chattts
```

Health check:

```powershell
node -e "fetch('http://127.0.0.1:8789/health').then(r=>r.text()).then(console.log)"
```

LEO DJ Settings:

```text
Provider = Local TTS Helper
Local TTS Helper Endpoint = http://127.0.0.1:8789/tts
```

Request contract:

```text
POST http://127.0.0.1:8789/tts
Content-Type: application/json

{ "text": "今天的第一段电台开场白" }
```

The helper returns `audio/wav` bytes directly.

Useful environment overrides:

```powershell
$env:CHATTTS_PORT="8789"
$env:CHATTTS_SOURCE="huggingface"
$env:HF_HUB_DISABLE_XET="1"
$env:CHATTTS_REFINE_PROMPT="[oral_2][laugh_0][break_4]"
$env:CHATTTS_TEMPERATURE="0.3"
$env:CHATTTS_TOP_P="0.7"
$env:CHATTTS_TOP_K="20"
```

Do not commit `D:\chattts`, generated audio, model weights, or local caches.

## Kokoro

The app does not run Kokoro inside the browser. It expects a local helper server:

```text
POST http://127.0.0.1:8788/tts
Content-Type: application/json

{ "text": "要合成的串场台词" }
```

The helper should return audio bytes directly, for example `audio/wav` or `audio/mpeg`.

Settings:

```text
Provider = Local TTS Helper
Local TTS Helper Endpoint = http://127.0.0.1:8788/tts
```

Dependency probe:

```powershell
python scripts/kokoro_probe.py
```

If packages are missing, it prints the install command. Kokoro's common Python path uses:

```powershell
python -m pip install "kokoro>=0.9.4" soundfile
```

For Mandarin Chinese voices, Kokoro examples commonly use `lang_code='z'` and may need Chinese text frontend dependencies such as `misaki[zh]`, depending on the chosen package/runtime.
