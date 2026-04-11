<p align="center">
  <img src="docs/assets/banner.png" alt="Misskey LLM Bot" width="100%" />
</p>

<p align="center">
  <strong>Misskey LLM Bot</strong><br>
  A self-hosted Misskey bot with Ollama/OpenAI-compatible text replies and optional ComfyUI image generation.
</p>

<p align="center">
  <a href="./README.ko.md">한국어</a>
</p>

## Overview

Misskey Ollama Bot is a self-hosted bot for Misskey that watches for mentions and replies, generates text with Ollama or any OpenAI-compatible API, and can optionally generate images through an external ComfyUI Desktop instance.

It is designed for practical deployment rather than demo-only usage, with support for:

- mention and reply handling
- local and federated remote users
- relationship-based access control
- automatic follow-back
- Docker Compose deployment
- Apple Silicon-friendly host workflows
- optional ComfyUI image generation
- safer image reply visibility clamping (`public -> home`)

## Features

- Replies to Misskey mentions automatically
- Handles thread replies addressed to the bot
- Supports Ollama and OpenAI-compatible text APIs
- Optional image generation via external ComfyUI Desktop
- Supports local and federated remote Misskey users
- Relationship-based access control
- Optional automatic follow-back
- Graceful WebSocket reconnect handling
- Docker Compose deployment
- Safer image reply visibility handling
  - `public -> home`
  - `home -> home`
  - `followers -> followers`
  - `specified -> specified`

## Screenshots

### Project Banner

Repository banner used for the project page.

<p align="center">
  <img src="docs/assets/banner.png" alt="Project Banner" width="100%" />
</p>

### Bot Overview

Example repository overview image.

<p align="center">
  <img src="docs/images/screenshot-overview.svg" alt="Bot Overview" width="100%" />
</p>

### Reply Example

Sample mention/reply flow image.

<p align="center">
  <img src="docs/images/screenshot-reply.svg" alt="Reply Example" width="100%" />
</p>

## Project structure

```text
.
├─ bot.js
├─ package.json
├─ compose.yaml
├─ Dockerfile
├─ .env.example
├─ workflows/
│  └─ anima_preview3_qwen_txt2img_api.json
└─ docs/
   ├─ assets/banner.png
   └─ images/
```

## Requirements

- Docker Engine with Compose
- a Misskey bot token
- a text backend such as Ollama or another OpenAI-compatible API
- ComfyUI Desktop running on the host machine if you want image generation

## Quick start

1. Copy the sample environment file.

```bash
cp .env.example .env
```

2. Edit `.env`.

Minimum text-only example:

```dotenv
MISSKEY_BASE_URL=https://misskey.example.com
MISSKEY_TOKEN=put_your_misskey_token_here
LLM_API_URL=http://host.docker.internal:11434/v1/chat/completions
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
ENABLE_IMAGE_GENERATION=false
```

ComfyUI image example:

```dotenv
MISSKEY_BASE_URL=https://misskey.example.com
MISSKEY_TOKEN=put_your_misskey_token_here
LLM_API_URL=http://host.docker.internal:11434/v1/chat/completions
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b

ENABLE_IMAGE_GENERATION=true
COMFYUI_BASE_URL=http://host.docker.internal:8000
COMFYUI_WORKFLOW_FILE=/app/workflows/anima_preview3_qwen_txt2img_api.json
COMFYUI_DIFFUSION_MODEL=anima-preview3-base.safetensors
COMFYUI_TEXT_ENCODER=qwen_3_06b_base.safetensors
COMFYUI_VAE=qwen_image_vae.safetensors
```

3. Build and start the bot.

```bash
docker compose up -d --build
```

4. Watch logs.

```bash
docker compose logs -f misskey-llm-bot
```

## ComfyUI notes

This repository does **not** bundle ComfyUI itself.  
It expects an external ComfyUI Desktop instance, usually reachable from the bot container at:

```text
http://host.docker.internal:8000
```

The included workflow targets the Anima Preview3 stack:

- `anima-preview3-base.safetensors`
- `qwen_3_06b_base.safetensors`
- `qwen_image_vae.safetensors`

The Compose file mounts `./workflows` into the container so the bot can read the workflow file without rebuilding every time.

## Commands

Text reply:
```text
@bot hello
```

Image reply:
```text
@bot /img a whale flying in a blue sky
@bot /image cozy greenhouse at night
@bot /그림 별이 가득한 겨울 숲
```

## Access control

Set `ACCESS_MODE` in `.env`.

Supported modes:

- `off`
- `local_only`
- `followers_only`
- `following_only`
- `followers_or_local`
- `following_or_local`
- `mutual_or_local`

Example:

```dotenv
ACCESS_MODE=following_or_local
ALLOWED_INSTANCE=misskey.example.com
```

## Follow-back

Enable automatic follow-back:

```dotenv
AUTO_FOLLOW_BACK=true
```

Only follow back users on the same instance:

```dotenv
AUTO_FOLLOW_LOCAL_ONLY=true
```

## Notes

- Normal text replies inherit the incoming visibility by default.
- Generated image replies are clamped safely:
  - `public` image replies become `home`
  - narrower visibilities stay narrow
- Keep `.env` out of Git.
- If you use Docker with `sudo`, add it to the commands.

## License

MIT. See [LICENSE](./LICENSE).

## Upstream

See [UPSTREAM.md](./UPSTREAM.md).
