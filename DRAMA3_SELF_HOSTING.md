# Self-hosted Fish Audio Drama 3

This project adds a defgodqe Voice Studio page and a server-side proxy to an official Fish Speech API server running Drama 3. The browser never receives the upstream API key.

## Hardware

Drama 3 requires Linux/WSL and an NVIDIA GPU with at least 48 GB VRAM for the official FP8 path. It does not run on CPU, Apple MPS, or AMD ROCm. Review the official [installation guide](https://github.com/fishaudio/fish-speech/blob/main/docs/en/install.md) and [inference docs](https://speech.fish.audio/inference/).

## Start the official server

Follow Fish Speech's install instructions and download the Drama 3 checkpoint. Start the API server without `--compile`:

```bash
python tools/api_server.py --listen 0.0.0.0:8080 --llama-checkpoint-path checkpoints/drama-3 --device cuda:0 --api-key "YOUR_LONG_RANDOM_KEY"
```

Keep port 8080 private. Expose it to the Worker only through a TLS reverse proxy or private network tunnel.

## Configure the Worker

Run `npx wrangler secret put DRAMA3_API_KEY` and enter the same random key supplied to the model server. Set the non-secret Worker variable `DRAMA3_URL` to the private HTTPS base URL reachable by the Worker, without a trailing slash. The Worker calls `DRAMA3_URL/v1/tts?format=msgpack` with server-side bearer authentication. Cloudflare Workers cannot reach your personal computer's `localhost`.

Open `/voice-studio.html` on your deployed Worker domain. The studio supports scripts, speaker tags `<|speaker:0|>` through `<|speaker:15|>`, director notes, optional reference audio and transcript, playback, and WAV download. The Worker converts JSON into the MessagePack request expected by Fish Speech. Script is limited to 6,000 characters and reference audio to 12 MB. Use voice cloning only with permission.
