---
name: baoyu-danger-chatgpt-web
description: Generate images through the ChatGPT website with browser login instead of API keys. Use when the user explicitly wants "登录 ChatGPT 就能生图", "ChatGPT Web 生图", or a no-API-key OpenAI image workflow and accepts a fragile web-automation path.
version: 0.1.0
metadata:
  openclaw:
    requires:
      anyBins:
        - node
        - npm
---

# ChatGPT Web Image

Browser-login image generation through `chatgpt.com`.

This is a **danger** skill:
- it uses the ChatGPT website, not the official OpenAI API
- it depends on a real browser session and page structure
- it can break when ChatGPT changes the UI, login flow, Cloudflare checks, or download behavior

Use this skill only when the user explicitly wants one of these:
- "登录 ChatGPT 就能生图"
- "不用 API key"
- "ChatGPT Web 生图"
- "网页登录态生图"

Prefer `baoyu-openai-image` when the user accepts the official API path.

## Consent Check (REQUIRED)

Before first use, verify explicit consent for reverse-engineered website automation.

Consent file locations:
- macOS: `~/Library/Application Support/baoyu-skills/chatgpt-web/consent.json`
- Linux: `~/.local/share/baoyu-skills/chatgpt-web/consent.json`
- Windows: `%APPDATA%\baoyu-skills\chatgpt-web\consent.json`

Flow:
1. Check whether consent file exists with `accepted: true` and `disclaimerVersion: "1.0"`
2. If valid consent exists, proceed
3. If not, show the disclaimer and ask the user whether to continue
4. If the user accepts, create the consent file
5. If the user declines, stop

Consent file format:
`{"version":1,"accepted":true,"acceptedAt":"<ISO>","disclaimerVersion":"1.0"}`

## Auth Model

This skill uses a persistent Chrome profile plus Playwright storage state:
- one-time browser login with `--login`
- session reused from local profile/state files
- no API key needed

Default session files:
- profile dir: `~/Library/Application Support/baoyu-skills/chatgpt-web/chrome-profile`
- storage state: `~/Library/Application Support/baoyu-skills/chatgpt-web/storage-state.json`

## Setup

First install dependencies:

```bash
cd ~/.agents/skills/baoyu-danger-chatgpt-web
npm install
```

Then log in once:

```bash
node scripts/main.js --login --accept-risk
```

The script opens real Chrome. Complete ChatGPT login and any Cloudflare checks in the browser window.

## Usage

```bash
# One-time login
node scripts/main.js --login --accept-risk

# Verify saved session
node scripts/main.js --check

# Generate one image
node scripts/main.js --prompt "A cinematic bookstore interior, warm tungsten light" --image out.png

# Generate and capture multiple outputs from the page if available
node scripts/main.js --prompt "A bold fashion editorial cover with red typography" --image cover.png --n 4

# Prompt from files
node scripts/main.js --promptfiles system.md brief.md --image out.png

# Keep browser open for inspection
node scripts/main.js --prompt "A clean SaaS hero illustration" --image hero.png --keep-open
```

## Options

| Option | Description |
| --- | --- |
| `--login` | Open Chrome and wait for a valid ChatGPT session |
| `--check` | Verify whether the saved ChatGPT session is usable |
| `--accept-risk` | Accept the danger disclaimer and save consent |
| `--show-disclaimer` | Print the disclaimer and exit |
| `--prompt`, `-p` | Prompt text |
| `--promptfiles <files...>` | Concatenate prompt files |
| `--image [path]` | Output image path, default `generated.png` |
| `--n <count>` | Number of images to capture from the page, default `1` |
| `--timeout <ms>` | Overall wait timeout, default `300000` |
| `--profile-dir <path>` | Custom Chrome profile directory |
| `--storage-state <path>` | Custom storage state path |
| `--keep-open` | Leave Chrome open after the run |
| `--headless` | Run headless. Experimental on this machine and not recommended for ChatGPT web login or Cloudflare challenges |
| `--json` | Print JSON summary |
| `--help`, `-h` | Show help |

## Behavior Notes

- This skill uses the website, not `/v1/images/*`
- It is best-effort and may need selector updates later
- Image capture currently targets visible large images rendered in the assistant response
- The script captures the rendered image elements from the page; it does not promise original CDN asset extraction
- Reference-image upload/edit mode is not implemented in `0.1.0`

## Environment Variables

| Variable | Description |
| --- | --- |
| `CHATGPT_WEB_PROFILE_DIR` | Override Chrome profile directory |
| `CHATGPT_WEB_STORAGE_STATE_PATH` | Override storage state path |
| `CHATGPT_WEB_BASE_URL` | Override site URL, default `https://chatgpt.com/` |
| `CHATGPT_WEB_CHROME_CHANNEL` | Browser channel, default `chrome` |
| `CHATGPT_WEB_TIMEOUT_MS` | Default timeout override |
