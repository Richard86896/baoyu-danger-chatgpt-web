import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";

const APP_NAME = "baoyu-danger-chatgpt-web";
const DISCLAIMER_VERSION = "1.0";
const DEFAULT_BASE_URL = (process.env.CHATGPT_WEB_BASE_URL || "https://chatgpt.com/").trim();
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CHATGPT_WEB_TIMEOUT_MS || "300000", 10);
const DEFAULT_CHANNEL = (process.env.CHATGPT_WEB_CHROME_CHANNEL || "chrome").trim();
const CHROME_CANDIDATES = [
  process.env.CHATGPT_WEB_CHROME_PATH?.trim(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const TEXTAREA_SELECTORS = [
  "#prompt-textarea",
  "textarea[placeholder*='Message']",
  "textarea[placeholder*='Ask']",
  "textarea[data-testid*='prompt']",
];
const EDITABLE_SELECTORS = [
  "div[contenteditable='true'][data-lexical-editor='true']",
  "div[contenteditable='true'][aria-label*='Message']",
  "div[contenteditable='true']",
];
const SEND_BUTTON_SELECTORS = [
  "button[aria-label*='Send']",
  "button[aria-label*='send']",
  "button[data-testid*='send']",
  "button:has-text('Send')",
];
const STOP_BUTTON_PATTERNS = [
  /stop generating/i,
  /^stop$/i,
  /cancel/i,
];

function printUsage() {
  console.log(`Usage:
  # Recommended: one-time login in a managed Chrome window
  node scripts/main.js --login --accept-risk

  # Normal generation uses saved login state in a background browser
  node scripts/main.js --check
  node scripts/main.js --prompt "A cinematic bookstore interior" --image out.png

  # Generate multiple different images in the same ChatGPT conversation
  node scripts/main.js --batch-file article-images.json --image article.png

  # Optional: attach to your own Chrome debug session
  node scripts/main.js --attach --check

Options:
  --login                   Open a managed Chrome window, wait for login, save state, then exit
  --check                   Verify saved session
  --attach                  Attach to an existing Chrome debug session
  --launch                  Launch a visible dedicated Chrome for this run
  --accept-risk             Save danger-consent file
  --show-disclaimer         Print disclaimer and exit
  -p, --prompt <text>       Prompt text
  --promptfiles <files...>  Read prompt from files (concatenated)
  --batch-file <path>       JSON array of prompts/jobs; submits them sequentially in one chat
  --image [path]            Output image path (default: generated.png)
  --n <count>               Number of images to capture (default: 1)
  --timeout <ms>            Overall timeout (default: 300000)
  --debug-port <port>       CDP port for attach/launch mode (default: 9222)
  --cdp-url <ws-url>        Full Chrome DevTools WebSocket URL
  --profile-dir <path>      Custom Chrome profile directory
  --storage-state <path>    Custom storage state path
  --keep-open               Leave a launched Chrome open after finishing
  --headless                Run a launched Chrome headless
  --json                    Print JSON summary
  -h, --help                Show help

Environment:
  CHATGPT_WEB_PROFILE_DIR
  CHATGPT_WEB_STORAGE_STATE_PATH
  CHATGPT_WEB_BASE_URL
  CHATGPT_WEB_CHROME_CHANNEL
  CHATGPT_WEB_TIMEOUT_MS
  CHATGPT_WEB_CHROME_PATH
  CHATGPT_WEB_DEBUG_PORT
  CHATGPT_WEB_CDP_URL`);
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
    attach: false,
    launch: false,
    acceptRisk: false,
    showDisclaimer: false,
    prompt: null,
    promptFiles: [],
    batchFile: null,
    imagePath: null,
    n: 1,
    timeoutMs: Number.isFinite(DEFAULT_TIMEOUT_MS) ? DEFAULT_TIMEOUT_MS : 300000,
    debugPort: Number.parseInt(process.env.CHATGPT_WEB_DEBUG_PORT || "9222", 10),
    cdpUrl: process.env.CHATGPT_WEB_CDP_URL?.trim() || null,
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
    if (arg === "--attach") {
      out.attach = true;
      continue;
    }
    if (arg === "--launch") {
      out.launch = true;
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
    if (arg === "--batch-file") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --batch-file");
      out.batchFile = value;
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
    if (arg === "--debug-port") {
      const value = Number.parseInt(argv[++i] || "", 10);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error("--debug-port must be an integer between 1 and 65535");
      }
      out.debugPort = value;
      continue;
    }
    if (arg === "--cdp-url") {
      const value = argv[++i];
      if (!value) throw new Error("Missing value for --cdp-url");
      out.cdpUrl = value;
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
  if (out.batchFile && (out.prompt || out.promptFiles.length > 0)) {
    throw new Error("Use either --batch-file or --prompt/--promptfiles, not both.");
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

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve a free TCP port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve(port);
      });
    });
  });
}

async function waitForDebugEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Chrome remote debugging endpoint on port ${port}. Last error: ${lastError}`);
}

function buildManualChromeLaunchHint(profileDir, port) {
  const escapedProfile = profileDir.replace(/"/g, '\\"');
  return `open -na "Google Chrome" --args --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --user-data-dir="${escapedProfile}" --new-window https://chatgpt.com/`;
}

async function resolveChromeBinary() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && await exists(candidate)) return candidate;
  }
  throw new Error("Google Chrome binary not found. Set CHATGPT_WEB_CHROME_PATH or install Google Chrome in /Applications.");
}

function resolveChromeAppBundle(chromeBinary) {
  const marker = "/Contents/MacOS/";
  const index = chromeBinary.indexOf(marker);
  if (index === -1) return null;
  return chromeBinary.slice(0, index);
}

async function launchChromeWithCdp(profileDir, headless, debugPort) {
  const chromeBinary = await resolveChromeBinary();
  const port = debugPort || await getFreePort();
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-search-engine-choice-screen",
    "--new-window",
    DEFAULT_BASE_URL,
  ];
  if (headless) args.unshift("--headless=new");

  const chrome = spawn(chromeBinary, args, {
    detached: false,
    stdio: "ignore",
  });
  chrome.unref();
  let wsUrl;
  try {
    wsUrl = await waitForDebugEndpoint(port, 30000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start the skill-owned Chrome session. Close any existing dedicated skill Chrome windows and retry. Original error: ${message}`);
  }
  return { chrome, port, wsUrl };
}

function killChrome(chrome) {
  try {
    chrome.kill("SIGTERM");
  } catch {}
  setTimeout(() => {
    if (chrome.exitCode === null && chrome.signalCode === null) {
      try {
        chrome.kill("SIGKILL");
      } catch {}
    }
  }, 2000).unref?.();
}

async function gracefulKillChrome(chrome, timeoutMs = 6000) {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return;
  const exitPromise = new Promise((resolve) => {
    chrome.once("exit", () => resolve());
  });
  killChrome(chrome);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return;
    const exited = await Promise.race([
      exitPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    if (exited) return;
  }
}

async function resolveAttachWebSocketUrl(args) {
  if (args.cdpUrl) return args.cdpUrl;

  try {
    return await waitForDebugEndpoint(args.debugPort, 5000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const profileDir = resolveProfileDir(args);
    throw new Error(
      `No attachable Chrome debug session was found on port ${args.debugPort}. ` +
      `Start a dedicated Chrome manually, then retry.\n` +
      `Suggested command:\n${buildManualChromeLaunchHint(profileDir, args.debugPort)}\n` +
      `Original error: ${message}`,
    );
  }
}

async function buildBrowserLaunchOptions(headless) {
  return {
    executablePath: await resolveChromeBinary(),
    headless,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--disable-search-engine-choice-screen",
    ],
  };
}

async function createAttachedSession(args) {
  const { chromium } = await loadPlaywright();
  let browser;
  try {
    const wsUrl = await resolveAttachWebSocketUrl(args);
    browser = await chromium.connectOverCDP(wsUrl, {
      timeout: 30000,
    });
  } catch (error) {
    throw error;
  }
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  context.setDefaultTimeout(15000);
  return {
    context,
    browser,
    chrome: null,
    port: args.debugPort,
    mode: "attached",
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

async function createManagedSession(args, headless) {
  const { chromium } = await loadPlaywright();
  const profileDir = resolveProfileDir(args);
  await mkdir(profileDir, { recursive: true });
  const launched = await launchChromeWithCdp(profileDir, headless, args.debugPort);
  let browser;
  try {
    browser = await chromium.connectOverCDP(launched.wsUrl, {
      timeout: 30000,
    });
  } catch (error) {
    await gracefulKillChrome(launched.chrome).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    if (headless) {
      throw new Error(`Headless Chrome launch failed on this machine. Retry with --launch to use a visible browser. Original error: ${message}`);
    }
    throw error;
  }
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  context.setDefaultTimeout(15000);
  return {
    context,
    browser,
    chrome: launched.chrome,
    port: launched.port,
    mode: "managed",
    async close() {
      await browser.close().catch(() => {});
      await gracefulKillChrome(launched.chrome).catch(() => {});
    },
  };
}

async function createIsolatedSession(args, headless) {
  const { chromium } = await loadPlaywright();
  const storageStatePath = resolveStorageStatePath(args);
  if (!await exists(storageStatePath)) {
    throw new Error(`No saved ChatGPT session was found at ${storageStatePath}. Run --login first, or use --attach to reuse a live browser.`);
  }

  let browser;
  try {
    browser = await chromium.launch(await buildBrowserLaunchOptions(headless));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (headless) {
      throw new Error(`Background Chrome launch failed on this machine. Retry with --launch to use a visible browser. Original error: ${message}`);
    }
    throw error;
  }

  const context = await browser.newContext({
    storageState: storageStatePath,
  });
  context.setDefaultTimeout(15000);
  return {
    context,
    browser,
    chrome: null,
    port: null,
    mode: "isolated",
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

function shouldAttachToExistingBrowser(args) {
  return args.attach || Boolean(args.cdpUrl);
}

async function createLoginSession(args) {
  if (shouldAttachToExistingBrowser(args)) return createAttachedSession(args);
  return createManagedSession(args, false);
}

async function createRuntimeSession(args) {
  if (shouldAttachToExistingBrowser(args)) return createAttachedSession(args);
  if (args.launch || args.keepOpen) return createManagedSession(args, Boolean(args.headless));
  return createIsolatedSession(args, true);
}

function canAutoFallbackToManaged(args, session) {
  return session?.mode === "isolated" && !shouldAttachToExistingBrowser(args) && !args.launch && !args.keepOpen;
}

async function switchToManagedFallback(args, session, reason) {
  await session.close().catch(() => {});
  if (!args.json) {
    console.log(`[chatgpt-web] Background runtime was not ready (${reason}). Retrying in a visible Chrome window.`);
  }
  return createManagedSession({ ...args, headless: false }, false);
}

async function createRuntimeSessionWithFallback(args) {
  try {
    return await createRuntimeSession(args);
  } catch (error) {
    if (shouldAttachToExistingBrowser(args) || args.launch || args.keepOpen) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (!args.json) {
      console.log(`[chatgpt-web] Background runtime failed to start (${reason}). Retrying in a visible Chrome window.`);
    }
    return createManagedSession({ ...args, headless: false }, false);
  }
}

async function prepareRuntimePage(args, timeoutMs) {
  let session = await createRuntimeSessionWithFallback(args);
  let page = await getPage(session);
  let fallbackUsed = session.mode === "managed" && !shouldAttachToExistingBrowser(args) && !args.launch && !args.keepOpen;

  const ensureReady = async () => {
    await gotoChatGPT(page);
    const ready = await waitForComposer(page, Math.min(timeoutMs, 60000));
    const authGate = await detectAuthGate(page);
    return {
      ready: ready && !authGate,
      authGate,
    };
  };

  let status = await ensureReady();
  if (!status.ready && canAutoFallbackToManaged(args, session)) {
    session = await switchToManagedFallback(args, session, status.authGate ? "login-required-in-background" : "background-not-ready");
    page = await getPage(session);
    fallbackUsed = true;
    status = await ensureReady();
  }

  return {
    session,
    page,
    fallbackUsed,
    runtimeMode: session.mode || "unknown",
    authGate: status.authGate,
    ready: status.ready,
  };
}

async function getPage(session) {
  const existing = session.context.pages().find((page) => !page.isClosed());
  return existing || session.context.newPage();
}

async function gotoChatGPT(page) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(DEFAULT_BASE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !message.includes("ERR_ABORTED")) throw error;
      await page.waitForTimeout(1500);
    }
  }
}

async function hasComposer(page) {
  return page.evaluate((selectors) => {
    return selectors.some((selector) => {
      return Array.from(document.querySelectorAll(selector)).some((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    });
  }, [...TEXTAREA_SELECTORS, ...EDITABLE_SELECTORS]).catch(() => false);
}

async function detectHumanGate(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").toLowerCase();
    if (text.includes("verify you are human")) return "verify-human";
    if (text.includes("confirm you are human")) return "confirm-human";
    if (text.includes("checking if the site connection is secure")) return "cloudflare-check";
    if (text.includes("enable javascript and cookies to continue")) return "cloudflare-block";
    if (text.includes("unusual activity has been detected")) return "unusual-activity";
    return null;
  }).catch(() => null);
}

async function detectAuthGate(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").toLowerCase();
    const authPhrases = [
      "you’ll need to be logged in to chatgpt",
      "you'll need to be logged in to chatgpt",
      "log in to get answers based on your saved chats",
      "login to get answers based on your saved chats",
      "登录以获取基于已保存聊天的回答",
      "你需要登录",
      "请先登录",
    ];
    if (authPhrases.some((phrase) => text.includes(phrase))) return "login-required";

    const visibleAuthCtas = Array.from(document.querySelectorAll("a, button"))
      .map((el) => ({
        text: (el.textContent || "").trim().toLowerCase(),
        href: el instanceof HTMLAnchorElement ? el.href : "",
        rect: el.getBoundingClientRect(),
        style: getComputedStyle(el),
      }))
      .filter((item) =>
        item.text &&
        item.rect.width > 0 &&
        item.rect.height > 0 &&
        item.style.visibility !== "hidden" &&
        item.style.display !== "none",
      );

    const hasLoginCta = visibleAuthCtas.some((item) =>
      item.text === "log in" ||
      item.text === "login" ||
      item.text === "登录" ||
      item.href.includes("/auth/login"),
    );
    const hasSignupCta = visibleAuthCtas.some((item) =>
      item.text === "sign up" ||
      item.text === "signup" ||
      item.text === "免费注册" ||
      item.text === "注册" ||
      item.href.includes("/auth/signup"),
    );

    if (hasLoginCta && hasSignupCta) return "login-required";
    return null;
  }).catch(() => null);
}

async function waitForComposer(page, timeoutMs) {
  const start = Date.now();
  let lastNotice = 0;
  while (Date.now() - start < timeoutMs) {
    const authGate = await detectAuthGate(page);
    if (!authGate && await hasComposer(page)) return true;
    const gate = await detectHumanGate(page);
    if (gate && Date.now() - lastNotice > 8000) {
      lastNotice = Date.now();
      console.log(`[chatgpt-web] Human verification detected (${gate}). Complete it in the browser window and keep waiting.`);
    }
    if (authGate && Date.now() - lastNotice > 8000) {
      lastNotice = Date.now();
      console.log("[chatgpt-web] ChatGPT login is still required in the browser window.");
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function saveStorageState(session, args) {
  const storageStatePath = resolveStorageStatePath(args);
  await mkdir(path.dirname(storageStatePath), { recursive: true });
  await session.context.storageState({ path: storageStatePath });
  return storageStatePath;
}

async function readPrompt(args) {
  const prompt = await readPromptInput(args.prompt, args.promptFiles, process.cwd());
  if (!prompt) throw new Error("Prompt is required. Use --prompt or --promptfiles.");
  return prompt;
}

async function readPromptInput(promptText, promptFiles = [], baseDir = process.cwd()) {
  const parts = [];
  if (typeof promptText === "string" && promptText.trim()) parts.push(promptText.trim());
  for (const filePath of promptFiles) {
    const content = await readFile(path.resolve(baseDir, filePath), "utf8");
    parts.push(content.trim());
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

async function readBatchJobs(args) {
  const batchFilePath = path.resolve(process.cwd(), args.batchFile);
  let parsed;
  try {
    const raw = await readFile(batchFilePath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read --batch-file ${batchFilePath}: ${details}`);
  }

  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
  if (!items || items.length === 0) {
    throw new Error("--batch-file must contain a non-empty JSON array, or an object with a non-empty 'items' array.");
  }

  const jobs = [];
  for (let index = 0; index < items.length; index += 1) {
    jobs.push(await normalizeBatchJob(items[index], index, batchFilePath));
  }
  return jobs;
}

async function normalizeBatchJob(item, index, batchFilePath) {
  const itemLabel = `Batch item ${index + 1}`;
  const baseDir = path.dirname(batchFilePath);

  if (typeof item === "string") {
    const prompt = item.trim();
    if (!prompt) throw new Error(`${itemLabel} is empty.`);
    return {
      prompt,
      imagePath: null,
      n: 1,
    };
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${itemLabel} must be either a string prompt or an object.`);
  }

  const promptFiles = Array.isArray(item.promptFiles) ? item.promptFiles : [];
  const prompt = await readPromptInput(item.prompt, promptFiles, baseDir);
  if (!prompt) throw new Error(`${itemLabel} is missing a prompt.`);

  const n = item.n == null ? 1 : Number.parseInt(String(item.n), 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${itemLabel} has invalid n=${item.n}. Expected a positive integer.`);
  }

  const rawImagePath =
    typeof item.imagePath === "string"
      ? item.imagePath
      : typeof item.image === "string"
        ? item.image
        : null;

  return {
    prompt,
    imagePath: rawImagePath && rawImagePath.trim() ? rawImagePath.trim() : null,
    n,
  };
}

function buildSubmissionPrompt(prompt) {
  if (/(image|images|图|插画|封面|海报)/i.test(prompt)) {
    return `Use ChatGPT's image generation tool for this request. Return generated image output, not a text-only reply.\n\n${prompt}`;
  }
  return `Use ChatGPT's image generation tool. Create an image for the brief below and return image output, not a text-only reply.\n\n${prompt}`;
}

async function readPageTextSnippet(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").trim().replace(/\n{3,}/g, "\n\n");
    if (!text) return "";
    return text.slice(-1500);
  }).catch(() => "");
}

async function getComposerState(page) {
  const fallback = {
    ready: false,
    hasComposer: false,
    busy: false,
  };
  return page.evaluate(
    ({ textareaSelectors, editableSelectors, stopPatternSources }) => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      const findVisible = (selectors) => {
        for (const selector of selectors) {
          for (const el of Array.from(document.querySelectorAll(selector))) {
            if (el && isVisible(el)) return el;
          }
        }
        return null;
      };

      const composer = findVisible(textareaSelectors) || findVisible(editableSelectors);
      const disabled = composer
        ? (composer instanceof HTMLTextAreaElement && (composer.disabled || composer.readOnly)) ||
          composer.getAttribute("aria-disabled") === "true"
        : true;

      const stopPatterns = stopPatternSources.map((source) => new RegExp(source, "i"));
      const busy = Array.from(document.querySelectorAll("button")).some((button) => {
        if (!isVisible(button)) return false;
        const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
        return stopPatterns.some((pattern) => pattern.test(label));
      });

      return {
        ready: Boolean(composer) && !disabled && !busy,
        hasComposer: Boolean(composer),
        busy,
      };
    },
    {
      textareaSelectors: TEXTAREA_SELECTORS,
      editableSelectors: EDITABLE_SELECTORS,
      stopPatternSources: STOP_BUTTON_PATTERNS.map((pattern) => pattern.source),
    },
  ).catch(() => fallback);
}

async function waitForPromptReady(page, timeoutMs) {
  const start = Date.now();
  let lastNotice = 0;
  while (Date.now() - start < timeoutMs) {
    const state = await getComposerState(page);
    const authGate = await detectAuthGate(page);
    if (state.ready && !authGate) return true;
    const gate = await detectHumanGate(page);
    if (gate && Date.now() - lastNotice > 8000) {
      lastNotice = Date.now();
      console.log(`[chatgpt-web] Human verification detected (${gate}). Complete it in the browser window and keep waiting.`);
    }
    if (authGate && Date.now() - lastNotice > 8000) {
      lastNotice = Date.now();
      console.log("[chatgpt-web] ChatGPT login is still required in the browser window.");
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function setPrompt(page, prompt) {
  const domSet = await page.evaluate(
    ({ promptText, textareaSelectors, editableSelectors }) => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };

      for (const selector of textareaSelectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          if (!(el instanceof HTMLTextAreaElement)) continue;
          if (!isVisible(el) || el.disabled || el.readOnly) continue;
          el.focus();
          el.value = promptText;
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: promptText }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }

      for (const selector of editableSelectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          if (!(el instanceof HTMLElement)) continue;
          if (!isVisible(el) || el.getAttribute("contenteditable") !== "true") continue;
          el.focus();
          el.textContent = promptText;
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: promptText }));
          return true;
        }
      }

      return false;
    },
    {
      promptText: prompt,
      textareaSelectors: TEXTAREA_SELECTORS,
      editableSelectors: EDITABLE_SELECTORS,
    },
  ).catch(() => false);
  if (domSet) return;

  for (const selector of TEXTAREA_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      try {
        if (!await candidate.isVisible()) continue;
        await candidate.click();
        await candidate.fill(prompt);
        return;
      } catch {}
    }
  }

  const selectAllModifier = process.platform === "darwin" ? "Meta" : "Control";
  for (const selector of EDITABLE_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      try {
        if (!await candidate.isVisible()) continue;
        await candidate.click();
        await page.keyboard.press(`${selectAllModifier}+A`).catch(() => {});
        await page.keyboard.press("Backspace").catch(() => {});
        await page.keyboard.insertText(prompt);
        return;
      } catch {}
    }
  }

  throw new Error("Prompt editor not found on the ChatGPT page.");
}

async function submitPrompt(page) {
  for (const selector of SEND_BUTTON_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      try {
        if (!await candidate.isVisible()) continue;
        await candidate.click();
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
  }).catch(() => []);
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
        src,
        signature,
        area: naturalWidth * naturalHeight,
      });
    }

    items.sort((a, b) => b.area - a.area);
    return items;
  }, baselineSignatures).catch(() => []);
}

async function waitForGeneratedImages(page, baselineSignatures, timeoutMs, expectedCount) {
  const start = Date.now();
  const settleMs = expectedCount > 1 ? 10000 : 6000;
  let bestCount = 0;
  let lastGrowthAt = 0;
  let latestCandidates = [];
  while (Date.now() - start < timeoutMs) {
    const candidates = await markNewImageCandidates(page, baselineSignatures);
    latestCandidates = candidates;
    if (candidates.length > bestCount) {
      bestCount = candidates.length;
      lastGrowthAt = Date.now();
    }
    if (candidates.length >= expectedCount) {
      await page.waitForTimeout(2000);
      return candidates.slice(0, expectedCount);
    }
    if (bestCount > 0 && lastGrowthAt > 0 && Date.now() - lastGrowthAt >= settleMs) {
      await page.waitForTimeout(2000);
      return candidates.slice(0, expectedCount);
    }
    await page.waitForTimeout(2000);
  }
  return latestCandidates.slice(0, expectedCount);
}

function resolveOutputPath(imagePath, index, total) {
  const resolved = path.resolve(process.cwd(), imagePath || "generated.png");
  const parsed = path.parse(resolved);
  const ext = parsed.ext || ".png";
  if (total === 1) return parsed.ext ? resolved : `${resolved}.png`;
  const baseName = parsed.name || "generated";
  return path.join(parsed.dir, `${baseName}-${index}${ext}`);
}

function resolveOutputPathForDownloadedImage(imagePath, index, total, preferredExt) {
  const resolved = path.resolve(process.cwd(), imagePath || "generated.png");
  const parsed = path.parse(resolved);
  const ext = preferredExt || parsed.ext || ".png";
  const baseName = parsed.name || "generated";
  if (total === 1) return path.join(parsed.dir, `${baseName}${ext}`);
  return path.join(parsed.dir, `${baseName}-${index}${ext}`);
}

function detectExtensionFromContentType(contentType) {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!normalized) return null;
  const mapping = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
  };
  return mapping[normalized] || null;
}

function detectExtensionFromUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsedUrl = new URL(rawUrl);
    const ext = path.extname(parsedUrl.pathname || "").toLowerCase();
    return ext || null;
  } catch {
    return null;
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mimeType, buffer };
}

async function writeDownloadedImage(buffer, imagePath, index, total, metadata = {}) {
  const preferredExt =
    detectExtensionFromContentType(metadata.contentType) ||
    detectExtensionFromUrl(metadata.sourceUrl) ||
    null;
  const outputPath = resolveOutputPathForDownloadedImage(imagePath, index, total, preferredExt);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function tryDownloadCandidateViaRequest(page, candidate) {
  if (!candidate?.src || !/^https?:/i.test(candidate.src)) return null;
  const response = await page.context().request.get(candidate.src, {
    failOnStatusCode: false,
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: DEFAULT_BASE_URL,
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok()) return null;
  const headers = await response.headers();
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  if (contentType && !String(contentType).toLowerCase().includes("image")) return null;
  const buffer = Buffer.from(await response.body());
  if (buffer.length === 0) return null;
  return {
    buffer,
    contentType,
    sourceUrl: candidate.src,
    via: "request",
  };
}

async function tryDownloadCandidateViaPage(page, candidate) {
  const payload = await page.evaluate(async ({ captureId }) => {
    const img = document.querySelector(`[data-baoyu-capture-id="${captureId}"]`);
    if (!(img instanceof HTMLImageElement)) {
      return { ok: false, error: "Image element not found." };
    }

    const src = img.currentSrc || img.src || "";
    if (!src) {
      return { ok: false, error: "Image source not found." };
    }

    try {
      if (src.startsWith("data:")) {
        return {
          ok: true,
          mode: "data-url",
          src,
          dataUrl: src,
        };
      }

      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) {
        return { ok: false, error: `Fetch failed: ${response.status} ${response.statusText}`, src };
      }

      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Failed to read blob."));
        reader.readAsDataURL(blob);
      });

      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
        return { ok: false, error: "Failed to serialize image blob.", src };
      }

      return {
        ok: true,
        mode: "blob-fetch",
        src,
        mimeType: blob.type || "",
        dataUrl,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        src,
      };
    }
  }, { captureId: candidate.captureId }).catch(() => null);

  if (!payload?.ok || !payload.dataUrl) return null;
  const parsed = parseDataUrl(payload.dataUrl);
  if (!parsed) return null;
  return {
    buffer: parsed.buffer,
    contentType: payload.mimeType || parsed.mimeType || "",
    sourceUrl: payload.src || candidate?.src || "",
    via: "page-fetch",
  };
}

async function saveCandidateImage(page, candidate, imagePath, index, total) {
  const direct =
    await tryDownloadCandidateViaRequest(page, candidate).catch(() => null) ||
    await tryDownloadCandidateViaPage(page, candidate).catch(() => null);

  if (direct?.buffer?.length) {
    const outputPath = await writeDownloadedImage(direct.buffer, imagePath, index, total, direct);
    return {
      path: outputPath,
      mode: direct.via || "direct-download",
      contentType: direct.contentType || null,
      sourceUrl: direct.sourceUrl || null,
    };
  }

  const outputPath = resolveOutputPath(imagePath, index, total);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const locator = page.locator(`[data-baoyu-capture-id="${candidate.captureId}"]`).first();
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.screenshot({ path: outputPath });
  return {
    path: outputPath,
    mode: "screenshot-fallback",
    contentType: null,
    sourceUrl: candidate?.src || null,
  };
}

async function captureImages(page, candidates, imagePath) {
  const captures = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const capture = await saveCandidateImage(page, candidate, imagePath, index + 1, candidates.length);
    captures.push(capture);
  }
  return captures;
}

function resolveBatchItemImagePath(imagePath, batchIndex, batchTotal) {
  const resolved = path.resolve(process.cwd(), imagePath || "generated.png");
  const parsed = path.parse(resolved);
  const ext = parsed.ext || ".png";
  if (batchTotal === 1) return parsed.ext ? resolved : `${resolved}.png`;
  const baseName = parsed.name || "generated";
  return path.join(parsed.dir, `${baseName}-${batchIndex}${ext}`);
}

async function generateImagesInCurrentChat(page, prompt, imagePath, n, timeoutMs) {
  const ready = await waitForPromptReady(page, Math.min(timeoutMs, 60000));
  if (!ready) {
    const authGate = await detectAuthGate(page);
    if (authGate) {
      throw new Error("ChatGPT login is still required for image generation. Complete login first.");
    }
    throw new Error("Timed out waiting for ChatGPT to accept the next prompt in the current conversation.");
  }

  const baseline = await listImageCandidates(page);
  const baselineSignatures = baseline.map((item) => `${item.src}|${item.naturalWidth}x${item.naturalHeight}`);

  await setPrompt(page, buildSubmissionPrompt(prompt));
  await submitPrompt(page);

  const candidates = await waitForGeneratedImages(page, baselineSignatures, timeoutMs, n);
  if (candidates.length === 0) {
    const gate = await detectHumanGate(page);
    if (gate) {
      throw new Error(`ChatGPT stayed behind a human-verification gate (${gate}), so no images were produced.`);
    }
    const snippet = await readPageTextSnippet(page);
    throw new Error(`No new visible large images were detected in the ChatGPT response.${snippet ? ` Page text tail: ${snippet}` : ""}`);
  }

  return captureImages(page, candidates, imagePath);
}

async function runLogin(args) {
  const consentPath = await ensureConsent(args);
  const session = await createLoginSession(args);
  try {
    const page = await getPage(session);
    await gotoChatGPT(page);
    console.log("[chatgpt-web] Complete ChatGPT login and any Cloudflare checks in the browser window.");
    const ready = await waitForComposer(page, args.timeoutMs);
    if (!ready) {
      const authGate = await detectAuthGate(page);
      if (authGate) throw new Error("ChatGPT login was not completed in the browser window.");
      throw new Error("Timed out waiting for a usable ChatGPT prompt editor after login.");
    }
    const storageStatePath = await saveStorageState(session, args);
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
    if (!args.keepOpen) await session.close();
  }
}

async function runCheck(args) {
  const runtime = await prepareRuntimePage(args, args.timeoutMs);
  const { session, fallbackUsed, runtimeMode, authGate } = runtime;
  try {
    const payload = {
      ok: runtime.ready,
      authRequired: Boolean(authGate),
      fallbackUsed,
      runtimeMode,
      profileDir: resolveProfileDir(args),
      storageStatePath: resolveStorageStatePath(args),
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else if (payload.ok) console.log("[chatgpt-web] Session looks usable.");
    else if (authGate) console.log("[chatgpt-web] Session exists, but ChatGPT login is still required.");
    else console.log("[chatgpt-web] Session not ready. Run --login.");
    if (!payload.ok) process.exitCode = 1;
  } finally {
    if (!args.keepOpen) await session.close();
  }
}

async function runGenerate(args) {
  const consentPath = await ensureConsent(args);
  const prompt = await readPrompt(args);
  const runtime = await prepareRuntimePage(args, args.timeoutMs);
  const { session, page, fallbackUsed, runtimeMode, authGate } = runtime;
  try {
    if (!runtime.ready) {
      if (authGate) throw new Error("ChatGPT login is still required. Run --login first.");
      throw new Error("ChatGPT session is not ready. Run --login first.");
    }
    const captures = await generateImagesInCurrentChat(page, prompt, args.imagePath || "generated.png", args.n, args.timeoutMs);
    const outputs = captures.map((item) => item.path);
    const storageStatePath = await saveStorageState(session, args);
    const payload = {
      ok: true,
      consentPath,
      fallbackUsed,
      runtimeMode,
      profileDir: resolveProfileDir(args),
      storageStatePath,
      files: outputs,
      captures,
      count: outputs.length,
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else if (outputs.length === 1) console.log(`[chatgpt-web] Saved image to ${outputs[0]}`);
    else {
      console.log(`[chatgpt-web] Saved ${outputs.length} images:`);
      for (const filePath of outputs) console.log(`- ${filePath}`);
    }
  } finally {
    if (!args.keepOpen) await session.close();
  }
}

async function runBatchGenerate(args) {
  const consentPath = await ensureConsent(args);
  const jobs = await readBatchJobs(args);
  const runtime = await prepareRuntimePage(args, args.timeoutMs);
  const { session, page, fallbackUsed, runtimeMode, authGate } = runtime;
  try {
    if (!runtime.ready) {
      if (authGate) throw new Error("ChatGPT login is still required. Run --login first.");
      throw new Error("ChatGPT session is not ready. Run --login first.");
    }

    const results = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const imagePath = job.imagePath || resolveBatchItemImagePath(args.imagePath || "generated.png", index + 1, jobs.length);
      if (!args.json) {
        console.log(`[chatgpt-web] Batch item ${index + 1}/${jobs.length}...`);
      }

      try {
        const captures = await generateImagesInCurrentChat(page, job.prompt, imagePath, job.n, args.timeoutMs);
        const files = captures.map((item) => item.path);
        results.push({
          index: index + 1,
          requestedCount: job.n,
          files,
          captures,
          count: files.length,
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(`Batch item ${index + 1}/${jobs.length} failed: ${details}`);
      }
    }

    const storageStatePath = await saveStorageState(session, args);
    const files = results.flatMap((item) => item.files);
    const payload = {
      ok: true,
      consentPath,
      fallbackUsed,
      runtimeMode,
      profileDir: resolveProfileDir(args),
      storageStatePath,
      batchCount: results.length,
      count: files.length,
      files,
      results,
    };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`[chatgpt-web] Saved ${payload.count} images across ${payload.batchCount} prompts:`);
      for (const filePath of files) console.log(`- ${filePath}`);
    }
  } finally {
    if (!args.keepOpen) await session.close();
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
  if (args.batchFile) {
    await runBatchGenerate({
      ...args,
      imagePath: args.imagePath || "generated.png",
    });
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
