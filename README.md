# baoyu-danger-chatgpt-web

ChatGPT website image-generation skill for Codex and similar local skill runtimes.

This repository contains a single danger skill:

- `SKILL.md`
- `scripts/main.js`
- `package.json`
- `package-lock.json`

## What It Does

- Uses the ChatGPT website instead of the official OpenAI API
- Logs in through a managed Chrome window once
- Reuses saved browser state for later runs, with automatic fallback to a visible managed Chrome window when background mode is not usable
- Submits one prompt or a whole batch of prompts in the same chat
- Downloads the generated image bytes when possible, with screenshot fallback only as backup

## Important

This is a fragile web-automation path, not a stable API integration.

It may break when ChatGPT changes:

- login flow
- Cloudflare checks
- DOM structure
- image rendering behavior

If you accept the official API path, use `baoyu-openai-image` instead.

## Install

```bash
npm install
```

## First Login

```bash
node scripts/main.js --login --accept-risk
```

This opens visible Chrome. Complete ChatGPT login and any Cloudflare checks in the browser window. After state is saved, the script closes that Chrome automatically.

## Example

```bash
node scripts/main.js --prompt "A cinematic bookstore interior, warm tungsten light" --image out.png
```

## Batch Example

When one request needs multiple different images, use one batch file instead of opening a fresh ChatGPT conversation for every image.

```json
[
  { "image": "article-cover.png", "prompt": "A cinematic AI industry cover illustration, warm editorial lighting" },
  { "image": "article-mid.png", "prompt": "An infographic-like illustration about AI regulation pressure, no text" },
  { "image": "article-end.png", "prompt": "A reflective closing illustration about Chinese AI builders under uncertainty" }
]
```

```bash
node scripts/main.js --batch-file article-images.json --image article.png
```

`--n` remains the "multiple outputs for one prompt" option. For multiple different prompts, use `--batch-file`.

If you explicitly want to reuse your own already-open Chrome debug session, use `--attach`.

## Local Skill Layout

One shared install pattern on this machine is:

```bash
git clone https://github.com/Richard86896/baoyu-danger-chatgpt-web.git ~/.agents/skills/baoyu-danger-chatgpt-web
ln -s ~/.agents/skills/baoyu-danger-chatgpt-web ~/.codex/skills/baoyu-danger-chatgpt-web
ln -s ~/.agents/skills/baoyu-danger-chatgpt-web ~/.claude/skills/baoyu-danger-chatgpt-web
```
