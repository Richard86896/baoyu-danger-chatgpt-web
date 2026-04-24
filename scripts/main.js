import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";

const APP_NAME = "baoyu-danger-chatgpt-web";
const DISCLAIMER_VERSION = "1.0";
const DEFAULT_BASE_URL = (process.env.CHATGPT_WEB_BASE_URL || "https://chatgpt.com/").trim();
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CHATGPT_WEB_TIMEOUT_MS || "300000", 10);
const DEFAULT_CHANNEL = (process.env.CHATGPT_WEB_CHROME_CHANNEL || "chrome").trim();

function printUsage() {
  console.log(`Usage:
  node scripts/main.js --login --accept-risk
  node scripts/main.js --check
  node scripts/main.js --prompt "A cinematic bookstore interior" --image out.png

Options:
  --login                   Open real Chrome and wait for ChatGPT login
  --check                   Verify saved session
  --accept-risk             Save danger-consent file
  --show-disclaimer         Print disclaimer and exit
  -p, --prompt <text>       Prompt text
  --promptfiles <files...>  Read prompt from files (concatenated)
  --image [path]            Output image path (default: generated.png)
  --n <count>               Number of images to capture (default: 1)
  --timeout <ms>            Overall timeout (default: 300000)
  --profile-dir <path>      Custom Chrome profile directory
  --storage-state <path>    Custom storage state path
  --keep-open               Leave Chrome open after finishing
  --headless                Run headless (not recommended)
  --json                    Print JSON summary
  -h, --help                Show help

Environment:
  CHATGPT_WEB_PROFILE_DIR
  CHATGPT_WEB_STORAGE_STATE_PATH
  CHATGPT_WEB_BASE_URL
  CHATGPT_WEB_CHROME_CHANNEL
  CHATGPT_WEB_TIMEOUT_MS`);
}

function printDisclaimer() {
  console.log(`Danger disclaimer:
- This tool automates the ChatGPT website instead of the official API.
- It may break when OpenAI changes login flow, UI selectors, Cloudflare checks, or image rendering.
- It may require manual browser interaction.
- It does not guarantee stable long-term compatibility.
- Use baoyu-openai-image instead when the official API path is acceptable.`);
}

function parseArgs(argv) {
  const out = {
    login: false,
    check: false,
    acceptRisk: false,
    showDisclaimer: false,
    prompt: null,
    promptFiles: [],
    imagePath: null,
    n: 1,
    timeoutMs: Number.isFinite(DEFAULT_TIMEOUT_MS) ? DEFAULT_TIMEOUT_MS : 300000,
    profileDir: null,
    storageStatePath: null,
    keepOpen: false,
    headless: false,
    json: false,
    help: false,
  };

  const positional = [];
  const takeMany = (index) => {
    const values = [];
    let next = index + 1;
    while (next < argv.length) {
      const candidate = argv[next];
      if (candidate.startsWith("-")) break;
      values.push(candidate);
      next += 1;
    }
    return { values, next: next - 1 };
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--login") {
      out.login = true;
      continue;
    }
    if (arg === "--check") {
      out.check = true;
      continue;
    }
    if (arg === "--accept-risk") {
      out.acceptRisk = true;
      continue;
    }
    if (arg === "--show-disclaimer") {
      out.showDisclaimer = true;
      continue;
    }
    if (arg === "--keep-open") {
      out.keepOpen = true;
      continue;
    }
    if (arg === "--headless") {
      out.headless = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--prompt" || arg === "-p") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      out.prompt = value;
      continue;
    }
    if (arg === "--promptfiles") {
      const { values, next } = takeMany(i);
      if (values.length === 0) throw new Error("Missing files for --promptfiles");
      out.promptFiles.push(...values);
      i = next;
      continue;
    }
    if (arg === "--image" || arg.startsWith("--image=")) {
      let value = null;
      if (arg.startsWith("--image=")) {
        value = arg.slice("--image=".length).trim();
      } else {
        const maybe = argv[i + 1];
        if (maybe && !maybe.startsWith("-")) {
          value = maybe;
          i += 1;
        }
      }
      out.imagePath = value && value.length > 0 ? value : "generated.png";
      continue;
    }
    if (arg === "--n") {
      const value = Number.parseInt(argv[++i] || "", 10);
      if (!Number.isInteger(value) || value < 1) throw new Error("--n must be a positive integer");
      out.n = value;
      continue;
    }
    if (arg === "--timeout") {
      const value = Number.parseInt(argv[++i] || "", 10);
      if (!Number.isInteger(value) || value < 1000) throw new Error("--timeout must be an integer >= 1000");
      out.timeoutMs = value;
      continue;
    }
    if (arg === "--profile-dir") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --profile-dir");
      out.profileDir = value;
      continue;
    }
    if (arg === "--storage-state") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --storage-state");
      out.storageStatePath = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (!out.prompt && positional.length > 0) {
    out.prompt = positional.join(" ");
  }

  return out;
}

function getDataDir() {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "baoyu-skills", "chatgpt-web");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "baoyu-skills", "chatgpt-web");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "baoyu-skills", "chatgpt-web");
}

function resolveConsentPath() {
  return path.join(getDataDir(), "consent.json");
}

function resolveProfileDir(args) {
  return path.resolve(args.profileDir || process.env.CHATGPT_WEB_PROFILE_DIR || path.join(getDataDir(), "chrome-profile"));
}

function resolveStorageStatePath(args) {
  return path.resolve(args.storageStatePath || process.env.CHATGPT_WEB_STORAGE_STATE_PATH || path.join(getDataDir(), "storage-state.json"));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureConsent(args) {
  const consentPath = resolveConsentPath();
  if (await exists(consentPath)) {
    try {
      const raw = await readFile(consentPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.accepted === true && parsed.disclaimerVersion === DISCLAIMER_VERSION) {
        return consentPath;
      }
    } catch {}
  }

  if (!args.acceptRisk) {
    throw new Error(`Consent required. Re-run with --accept-risk after reviewing --show-disclaimer. Consent file: ${consentPath}`);
  }

  await mkdir(path.dirname(consentPath), { recursive: true });
  const payload = {
    version: 1,
    accepted: true,
    acceptedAt: new Date().toISOString(),
    disclaimerVersion: DISCLAIMER_VERSION,
  };
  await writeFile(consentPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return consentPath;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing dependency: playwright. Run 'npm install' in ~/.agents/skills/${APP_NAME}. Details: ${details}`);
  }
}

async function createContext(args) {
  const { chromium } = await loadPlaywright();
  const profileDir = resolveProfileDir(args);
  await mkdir(profileDir, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: DEFAULT_CHANNEL,
      headless: args.headless,
      viewport: null,
      acceptDownloads: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.headless) {
      throw new Error(`Headless Chrome launch failed on this machine. Re-run without --headless and use the visible Chrome window. Original error: ${message}`);
    }
    throw error;
  }
  context.setDefaultTimeout(15000);
  return context;
}

async function getPage(context) {
  const existing = context.pages().find((page) => !page.isClosed());
  return existing || context.newPage();
}

async function gotoChatGPT(page) {
  await page.goto(DEFAULT_BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function hasComposer(page) {
  return page.evaluate(() => {
    const selectors = [
      "#prompt-textarea",
      "textarea[placeholder*='Message']",
      "textarea[placeholder*='Ask']",
      "textarea[data-testid*='prompt']",
      "div[contenteditable='true'][data-lexical-editor='true']",
      "div[contenteditable='true'][aria-label*='Message']",
    ];
    return selectors.some((selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
  });
}

async function waitForComposer(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await hasComposer(page)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function saveStorageState(context, args) {
  const storageStatePath = resolveStorageStatePath(args);
  await mkdir(path.dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  return storageStatePath;
}

async function readPrompt(args) {
  const parts = [];
  if (args.prompt) parts.push(args.prompt.trim());
  for (const filePath of args.promptFiles) {
    const content = await readFile(path.resolve(process.cwd(), filePath), "utf8");
    parts.push(content.trim());
  }
  const prompt = parts.filter(Boolean).join("\n\n").trim();
  if (!prompt) throw new Error("Prompt is required. Use --prompt or --promptfiles.");
  return prompt;
}

function buildSubmissionPrompt(prompt) {
  if (/(image|images|图|插画|封面|海报)/i.test(prompt)) return prompt;
  return `Generate an image for this brief. Return image output.\n\n${prompt}`;
}

async function setPrompt(page, prompt) {
  const textareaSelectors = [
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
    "textarea[placeholder*='Ask']",
    "textarea[data-testid*='prompt']",
  ];
  for (const selector of textareaSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click();
        await locator.fill(prompt);
        return;
      } catch {}
    }
  }

  const editableSelectors = [
    "div[contenteditable='true'][data-lexical-editor='true']",
    "div[contenteditable='true'][aria-label*='Message']",
    "div[contenteditable='true']",
  ];
  for (const selector of editableSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click();
        await page.keyboard.insertText(prompt);
        return;
      } catch {}
    }
  }

  throw new Error("Prompt editor not found on the ChatGPT page.");
}

async function submitPrompt(page) {
  const buttonSelectors = [
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
    "button[data-testid*='send']",
    "button:has-text('Send')",
  ];
  for (const selector of buttonSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click();
        return;
      } catch {}
    }
  }

  await page.keyboard.press("Enter");
}

async function listImageCandidates(page) {
  return page.evaluate(() => {
    return Array.from(document.images)
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = img.currentSrc || img.src || "";
        const naturalWidth = img.naturalWidth || 0;
        const naturalHeight = img.naturalHeight || 0;
        const visible = rect.width > 0 && rect.height > 0;
        return {
          src,
          rectWidth: rect.width,
          rectHeight: rect.height,
          naturalWidth,
          naturalHeight,
          visible,
        };
      })
      .filter((item) =>
        item.visible &&
        item.src &&
        !item.src.startsWith("data:image/svg+xml") &&
        item.rectWidth >= 180 &&
        item.rectHeight >= 180 &&
        item.naturalWidth >= 180 &&
        item.naturalHeight >= 180,
      );
  });
}

async function markNewImageCandidates(page, baselineSignatures) {
  return page.evaluate((baseline) => {
    const baselineSet = new Set(baseline);
    const items = [];
    let index = 0;

    for (const img of Array.from(document.images)) {
      const rect = img.getBoundingClientRect();
      const src = img.currentSrc || img.src || "";
      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;

      if (!src || src.startsWith("data:image/svg+xml")) continue;
      if (rect.width < 180 || rect.height < 180) continue;
      if (naturalWidth < 180 || naturalHeight < 180) continue;

      const signature = `${src}|${naturalWidth}x${naturalHeight}`;
      if (baselineSet.has(signature)) continue;

      const captureId = `baoyu-chatgpt-capture-${Date.now()}-${index++}`;
      img.setAttribute("data-baoyu-capture-id", captureId);
      items.push({
        captureId,
        signature,
        area: naturalWidth * naturalHeight,
      });
    }

    items.sort((a, b) => b.area - a.area);
    return items;
  }, baselineSignatures);
}

async function waitForGeneratedImages(page, baselineSignatures, timeoutMs, expectedCount) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const candidates = await markNewImageCandidates(page, baselineSignatures);
    if (candidates.length >= expectedCount) {
      await page.waitForTimeout(2000);
      return candidates.slice(0, expectedCount);
    }
    if (candidates.length > 0 && Date.now() - start > 15000) {
      await page.waitForTimeout(2000);
      return candidates.slice(0, expectedCount);
    }
    await page.waitForTimeout(2000);
  }
  return [];
}

function resolveOutputPath(imagePath, index, total) {
  const resolved = path.resolve(process.cwd(), imagePath || "generated.png");
  const parsed = path.parse(resolved);
  const ext = parsed.ext || ".png";
  if (total === 1) return parsed.ext ? resolved : `${resolved}.png`;
  const baseName = parsed.name || "generated";
  return path.join(parsed.dir, `${baseName}-${index}${ext}`);
}

async function captureImages(page, candidates, imagePath) {
  const outputs = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const outputPath = resolveOutputPath(imagePath, index + 1, candidates.length);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const locator = page.locator(`[data-baoyu-capture-id="${candidate.captureId}"]`).first();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.screenshot({ path: outputPath });
    outputs.push(outputPath);
  }
  return outputs;
}

async function runLogin(args) {
  const consentPath = await ensureConsent(args);
  const context = await createContext(args);
  try {
    const page = await getPage(context);
    await gotoChatGPT(page);
    console.log("[chatgpt-web] Complete ChatGPT login and any Cloudflare checks in the browser window.");
    const ready = await waitForComposer(page, args.timeoutMs);
    if (!ready) throw new Error("Timed out waiting for a usable ChatGPT prompt editor after login.");
    const storageStatePath = await saveStorageState(context, args);
    const payload = {
      ok: true,
      consentPath,
      profileDir: resolveProfileDir(args),
      storageStatePath,
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`[chatgpt-web] Session ready.`);
      console.log(`[chatgpt-web] Profile dir: ${payload.profileDir}`);
      console.log(`[chatgpt-web] Storage state: ${payload.storageStatePath}`);
    }
  } finally {
    if (!args.keepOpen) await context.close();
  }
}

async function runCheck(args) {
  const context = await createContext(args);
  try {
    const page = await getPage(context);
    await gotoChatGPT(page);
    const ok = await waitForComposer(page, Math.min(args.timeoutMs, 30000));
    const payload = {
      ok,
      profileDir: resolveProfileDir(args),
      storageStatePath: resolveStorageStatePath(args),
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else if (ok) console.log("[chatgpt-web] Session looks usable.");
    else console.log("[chatgpt-web] Session not ready. Run --login.");
    if (!ok) process.exitCode = 1;
  } finally {
    if (!args.keepOpen) await context.close();
  }
}

async function runGenerate(args) {
  const consentPath = await ensureConsent(args);
  const prompt = await readPrompt(args);
  const context = await createContext(args);
  try {
    const page = await getPage(context);
    await gotoChatGPT(page);
    const ready = await waitForComposer(page, Math.min(args.timeoutMs, 60000));
    if (!ready) throw new Error("ChatGPT session is not ready. Run --login first.");

    const baseline = await listImageCandidates(page);
    const baselineSignatures = baseline.map((item) => `${item.src}|${item.naturalWidth}x${item.naturalHeight}`);

    await setPrompt(page, buildSubmissionPrompt(prompt));
    await submitPrompt(page);

    const candidates = await waitForGeneratedImages(page, baselineSignatures, args.timeoutMs, args.n);
    if (candidates.length === 0) {
      throw new Error("No new visible large images were detected in the ChatGPT response.");
    }

    const outputs = await captureImages(page, candidates, args.imagePath || "generated.png");
    const storageStatePath = await saveStorageState(context, args);
    const payload = {
      ok: true,
      consentPath,
      profileDir: resolveProfileDir(args),
      storageStatePath,
      files: outputs,
      count: outputs.length,
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else if (outputs.length === 1) console.log(`[chatgpt-web] Saved image to ${outputs[0]}`);
    else {
      console.log(`[chatgpt-web] Saved ${outputs.length} images:`);
      for (const filePath of outputs) console.log(`- ${filePath}`);
    }
  } finally {
    if (!args.keepOpen) await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (args.showDisclaimer) {
    printDisclaimer();
    return;
  }
  if (args.login) {
    await runLogin(args);
    return;
  }
  if (args.check) {
    await runCheck(args);
    return;
  }
  await runGenerate({
    ...args,
    imagePath: args.imagePath || "generated.png",
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
