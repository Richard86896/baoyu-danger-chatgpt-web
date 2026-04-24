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

This skill now prefers **managed login + background generation**:
- first login uses a script-managed visible Chrome window
- after login succeeds, the script saves session state and closes that Chrome window
- normal generation reuses the saved session in a background browser
- no API key needed
- `--attach` is still available when you explicitly want to reuse your own Chrome debug session

Default session files:
- profile dir: `~/Library/Application Support/baoyu-skills/chatgpt-web/chrome-profile`
- storage state: `~/Library/Application Support/baoyu-skills/chatgpt-web/storage-state.json`

Default debug port:
- `9222`

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

Complete ChatGPT login and any Cloudflare checks in that Chrome window. After session state is saved, the script closes the managed Chrome automatically.

Manual attach mode is still available when needed:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir="$HOME/Library/Application Support/baoyu-skills/chatgpt-web/chrome-profile" \
  --new-window https://chatgpt.com/

node scripts/main.js --attach --check
```

## Usage

```bash
# One-time login in a managed visible Chrome window
node scripts/main.js --login --accept-risk

# Verify saved session in a background browser
node scripts/main.js --check

# Generate one image in a background browser
node scripts/main.js --prompt "A cinematic bookstore interior, warm tungsten light" --image out.png

# Generate and capture multiple outputs from the page if available
node scripts/main.js --prompt "A bold fashion editorial cover with red typography" --image cover.png --n 4

# Generate multiple different images in the same ChatGPT conversation
node scripts/main.js --batch-file article-images.json --image article.png

# Prompt from files
node scripts/main.js --promptfiles system.md brief.md --image out.png

# Force a visible browser for inspection
node scripts/main.js --launch --prompt "A clean SaaS hero illustration" --image hero.png --keep-open

# Reuse your own manually opened Chrome debug session
node scripts/main.js --attach --prompt "A clean SaaS hero illustration" --image hero.png
```

## Options

| Option | Description |
| --- | --- |
| `--login` | Open a managed Chrome window, wait for a valid ChatGPT session, save state, then exit |
| `--check` | Verify whether the saved ChatGPT session is usable |
| `--attach` | Attach to an existing Chrome debug session instead of using managed/background mode |
| `--launch` | Launch a visible dedicated Chrome for this run |
| `--accept-risk` | Accept the danger disclaimer and save consent |
| `--show-disclaimer` | Print the disclaimer and exit |
| `--prompt`, `-p` | Prompt text |
| `--promptfiles <files...>` | Concatenate prompt files |
| `--batch-file <path>` | Submit multiple prompt jobs sequentially inside one ChatGPT conversation |
| `--image [path]` | Output image path, default `generated.png` |
| `--n <count>` | Number of images to capture from the page, default `1` |
| `--timeout <ms>` | Overall wait timeout, default `300000` |
| `--debug-port <port>` | Chrome DevTools port, default `9222` |
| `--cdp-url <ws-url>` | Full Chrome DevTools WebSocket URL |
| `--profile-dir <path>` | Custom Chrome profile directory |
| `--storage-state <path>` | Custom storage state path |
| `--keep-open` | Leave a launched Chrome open after the run |
| `--headless` | Run a launched Chrome headless |
| `--json` | Print JSON summary |
| `--help`, `-h` | Show help |

## Behavior Notes

- This skill uses the website, not `/v1/images/*`
- Default login opens a managed visible Chrome, saves state, and closes it automatically
- Default generation first tries saved session state in a background browser
- If background mode is not usable on this machine, the script automatically falls back to a visible managed Chrome run
- Use `--attach` only when you explicitly want the old manual debug-port workflow
- When the user asks for multiple different images in one request, prefer one `--batch-file` run so all prompts stay in the same ChatGPT thread
- Do not open a fresh ChatGPT conversation for every image unless a specific batch item failed and you are retrying it
- `--n` is for multiple outputs from one prompt, not for multiple different prompts
- It is best-effort and may need selector updates later
- The script now tries to download the actual generated image bytes first, using shared browser auth/context
- Screenshot fallback is only used when direct download is not possible for that specific image
- Preserved file extension may follow the actual downloaded image format, for example `.webp`
- Reference-image upload/edit mode is not implemented in `0.1.0`

## Batch File Format

Use `--batch-file` when one user request needs several different images. The script keeps one ChatGPT conversation open and submits each item sequentially.

```json
[
  {
    "image": "cover.png",
    "prompt": "A cinematic cover illustration for an AI industry article, warm red palette, editorial style"
  },
  {
    "image": "chart.png",
    "prompt": "A clean infographic-style illustration about AI regulation pressure, no text"
  },
  {
    "image": "ending.png",
    "prompt": "A reflective closing illustration about Chinese AI builders under uncertainty, realistic lighting"
  }
]
```

Notes:
- Each array item can be either a plain string prompt or an object
- Object fields: `prompt`, optional `image` or `imagePath`, optional `n`, optional `promptFiles`
- If an item has no `image`, the script derives filenames from the CLI `--image` base path, such as `article-1.png`, `article-2.png`
- If you want a clean thread, open one new ChatGPT chat manually before running the batch command; the script will then keep using that same thread

## Environment Variables

| Variable | Description |
| --- | --- |
| `CHATGPT_WEB_PROFILE_DIR` | Override Chrome profile directory |
| `CHATGPT_WEB_STORAGE_STATE_PATH` | Override storage state path |
| `CHATGPT_WEB_BASE_URL` | Override site URL, default `https://chatgpt.com/` |
| `CHATGPT_WEB_CHROME_CHANNEL` | Browser channel, default `chrome` |
| `CHATGPT_WEB_TIMEOUT_MS` | Default timeout override |
| `CHATGPT_WEB_DEBUG_PORT` | Default debug port, default `9222` |
| `CHATGPT_WEB_CDP_URL` | Explicit Chrome DevTools WebSocket URL |
| `CHATGPT_WEB_CHROME_PATH` | Chrome binary override for `--launch` mode |
