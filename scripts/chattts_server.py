import io
import json
import os
import sys
import threading

repo_dir = os.getenv("CHATTTS_REPO_DIR", "").strip()
if repo_dir and os.path.isdir(repo_dir) and repo_dir not in sys.path:
    sys.path.insert(0, repo_dir)

from flask import Flask, Response, jsonify, request
from flask_cors import CORS


SAMPLE_RATE = 24000

app = Flask(__name__)
CORS(app)

_chat = None
_chat_lock = threading.Lock()


def _load_chattts():
    global _chat

    with _chat_lock:
        if _chat is not None:
            return _chat

        try:
            import ChatTTS
        except Exception as exc:
            raise RuntimeError(
                "ChatTTS is not installed in this Python environment. "
                "Run: npm.cmd run voice:chattts:setup"
            ) from exc

        chat = ChatTTS.Chat()
        source = os.getenv("CHATTTS_SOURCE", "huggingface").strip()
        load_kwargs = {"compile": os.getenv("CHATTTS_COMPILE", "0") == "1"}
        if source:
            load_kwargs["source"] = source

        ok = chat.load(**load_kwargs)
        if ok is False:
            raise RuntimeError("ChatTTS model load returned False.")

        _chat = chat
        return _chat


def _to_float_env(name, fallback):
    raw = os.getenv(name, "").strip()
    if not raw:
        return fallback
    try:
        return float(raw)
    except ValueError:
        return fallback


def _to_int_env(name, fallback):
    raw = os.getenv(name, "").strip()
    if not raw:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


def _build_params(chattts_module):
    refine_prompt = os.getenv("CHATTTS_REFINE_PROMPT", "[oral_2][laugh_0][break_4]")
    params_refine_text = chattts_module.Chat.RefineTextParams(prompt=refine_prompt)
    params_infer_code = chattts_module.Chat.InferCodeParams(
        temperature=_to_float_env("CHATTTS_TEMPERATURE", 0.3),
        top_P=_to_float_env("CHATTTS_TOP_P", 0.7),
        top_K=_to_int_env("CHATTTS_TOP_K", 20),
    )
    return params_refine_text, params_infer_code


def _synthesize(text):
    import ChatTTS
    import torch
    import soundfile as sf

    chat = _load_chattts()
    params_refine_text, params_infer_code = _build_params(ChatTTS)

    wavs = chat.infer(
        [text],
        params_refine_text=params_refine_text,
        params_infer_code=params_infer_code,
    )
    wav = wavs[0]
    if isinstance(wav, torch.Tensor):
        wav = wav.detach().cpu().numpy()

    buf = io.BytesIO()
    sf.write(buf, wav, SAMPLE_RATE, format="WAV")
    buf.seek(0)
    return buf.getvalue()


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "chattts",
            "python": sys.version.split()[0],
            "loaded": _chat is not None,
        }
    )


@app.post("/tts")
def tts():
    try:
        payload = request.get_json(force=True, silent=False)
    except Exception:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    text = str((payload or {}).get("text", "")).strip()
    if not text:
        return jsonify({"error": "Missing text."}), 400

    max_chars = _to_int_env("CHATTTS_MAX_CHARS", 260)
    if len(text) > max_chars:
        text = text[:max_chars]

    try:
        audio = _synthesize(text)
    except Exception as exc:
        error = {"error": type(exc).__name__, "message": str(exc)}
        if os.getenv("CHATTTS_DEBUG", "0") == "1":
            error["payload"] = payload
        return Response(json.dumps(error, ensure_ascii=False), status=500, mimetype="application/json")

    return Response(audio, mimetype="audio/wav")


if __name__ == "__main__":
    host = os.getenv("CHATTTS_HOST", "127.0.0.1")
    port = int(os.getenv("CHATTTS_PORT", "8789"))
    app.run(host=host, port=port, threaded=False)
