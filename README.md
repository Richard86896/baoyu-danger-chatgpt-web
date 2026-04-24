# baoyu-danger-chatgpt-web

ChatGPT website image-generation skill for Codex and similar local skill runtimes.

This repository contains a single danger skill:

- `SKILL.md`
- `scripts/main.js`
- `package.json`
- `package-lock.json`

## What It Does

- Uses the ChatGPT website instead of the official OpenAI API
- Logs in through a real Chrome session
- Reuses saved browser state
- Submits an image-generation prompt
- Captures rendered image output from the page

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

This opens visible Chrome. Complete ChatGPT login and any Cloudflare checks in the browser window.

## Example

```bash
node scripts/main.js --prompt "A cinematic bookstore interior, warm tungsten light" --image out.png
```

## Local Skill Layout

One shared install pattern on this machine is:

```bash
git clone https://github.com/Richard86896/baoyu-danger-chatgpt-web.git ~/.agents/skills/baoyu-danger-chatgpt-web
ln -s ~/.agents/skills/baoyu-danger-chatgpt-web ~/.codex/skills/baoyu-danger-chatgpt-web
ln -s ~/.agents/skills/baoyu-danger-chatgpt-web ~/.claude/skills/baoyu-danger-chatgpt-web
```
