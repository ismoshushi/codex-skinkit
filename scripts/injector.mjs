import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const SKIN_VERSION = "1.1.0";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_ART_BYTES = 16 * 1024 * 1024;
const BUILTIN_THEME_COUNT = 5;
const LAYOUT_VARIANTS = new Set([
  "cinematic-banner",
  "immersive-board",
  "command-center",
]);
const EFFECT_TYPES = new Set([
  "portal-sparks", "orbital-scan", "aurora-ribbons", "sakura-petals",
]);

function parseArgs(argv) {
  const options = {
    port: 9341,
    mode: "watch",
    timeoutMs: 30000,
    screenshot: null,
    reload: false,
    themeDir: null,
    themeId: null,
    openThemePicker: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--check-payload") options.mode = "check";
    else if (arg === "--test-theme-studio") options.mode = "studio-test";
    else if (arg === "--test-all-effects") options.mode = "effects-test";
    else if (arg === "--test-reduced-motion") options.mode = "reduced-motion-test";
    else if (arg === "--test-system-default") options.mode = "system-default-test";
    else if (arg === "--go-home") options.mode = "home";
    else if (arg === "--go-back") options.mode = "back";
    else if (arg === "--preview-theme-studio") options.mode = "studio-preview";
    else if (arg === "--select-theme") { options.mode = "select"; options.themeId = argv[++i]; }
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++i]);
    else if (arg === "--theme-dir") options.themeDir = path.resolve(argv[++i]);
    else if (arg === "--reload") options.reload = true;
    else if (arg === "--open-theme-picker") options.openThemePicker = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 120000) {
    throw new Error(`Invalid timeout: ${options.timeoutMs}`);
  }
  if (options.mode === "select" && !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(options.themeId || "")) {
    throw new Error(`Invalid theme id: ${options.themeId || "missing"}`);
  }
  return options;
}

function validatedDebuggerUrl(target, port) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || !LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port) {
    throw new Error(`Rejected non-loopback CDP WebSocket URL: ${url.href}`);
  }
  return url.href;
}

class CdpSession {
  constructor(target, port) {
    this.target = target;
    this.ws = new WebSocket(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP WebSocket open timed out")), 5000);
      this.ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP WebSocket open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => {
      this.closed = true;
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, timeoutMs = 10000) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 10000) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    if (!this.closed) this.ws.close();
    this.closed = true;
  }
}

async function listAppTargets(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const targets = await response.json();
    return targets.filter((item) => {
      if (item.type !== "page" || !item.url?.startsWith("app://") || !item.webSocketDebuggerUrl) return false;
      try {
        validatedDebuggerUrl(item, port);
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeSession(session) {
  return session.evaluate(`(() => {
    const markers = {
      shell: Boolean(document.querySelector('main.main-surface')),
      sidebar: Boolean(document.querySelector('aside.app-shell-left-panel')),
      composer: Boolean(document.querySelector('.composer-surface-chrome')),
      main: Boolean(document.querySelector('[role="main"]')),
    };
    return {
      title: document.title,
      href: location.href,
      markers,
      codex: markers.shell && markers.sidebar && (markers.composer || markers.main),
    };
  })()`);
}

async function connectTarget(target, port) {
  return new CdpSession(target, port).open();
}

async function connectCodexTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await listAppTargets(port);
      const connected = [];
      for (const target of targets) {
        let session;
        try {
          session = await connectTarget(target, port);
          const probe = await probeSession(session);
          if (probe?.codex) connected.push({ target, session, probe });
          else session.close();
        } catch (error) {
          session?.close();
          lastError = error;
        }
      }
      if (connected.length) return connected;
      lastError = new Error("No page matched the expected Codex shell markers");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified Codex renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

const textValue = (value, fallback, max) => typeof value === "string" && value.trim()
  ? value.trim().slice(0, max) : fallback;

function colorValue(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) || /^rgba?\([0-9., %]+\)$/i.test(normalized)
    ? normalized
    : fallback;
}

function normalizeTheme(raw, fallbackId, source) {
  const requestedLayout = textValue(raw.layoutVariant || raw.layout, "cinematic-banner", 40);
  const requestedEffect = textValue(raw.effect, "", 40);
  return {
    schemaVersion: 1,
    id: textValue(raw.id, fallbackId, 80),
    name: textValue(raw.name, "Codex Dream Skin", 80),
    brandSubtitle: textValue(raw.brandSubtitle, "CODEX DREAM SKIN", 80),
    tagline: textValue(raw.tagline, "Make something wonderful.", 160),
    projectPrefix: textValue(raw.projectPrefix, "选择项目 · ", 80),
    projectLabel: textValue(raw.projectLabel, "◉  选择项目", 80),
    statusText: textValue(raw.statusText, "DREAM SKIN ONLINE", 80),
    quote: textValue(raw.quote, "MAKE SOMETHING WONDERFUL", 80),
    heroEyebrow: textValue(raw.heroEyebrow, "", 80),
    heroTitle: textValue(raw.heroTitle, "", 80),
    heroEmphasis: textValue(raw.heroEmphasis, "", 80),
    heroDescription: textValue(raw.heroDescription, "", 160),
    layoutVariant: LAYOUT_VARIANTS.has(requestedLayout) ? requestedLayout : "cinematic-banner",
    effect: EFFECT_TYPES.has(requestedEffect) ? requestedEffect : "",
    source,
    colors: {
      background: colorValue(raw.colors?.background, "#071116"),
      panel: colorValue(raw.colors?.panel, "#0b1a20"),
      panelAlt: colorValue(raw.colors?.panelAlt, "#10272c"),
      accent: colorValue(raw.colors?.accent, "#7cff46"),
      accentAlt: colorValue(raw.colors?.accentAlt, "#b8ff3d"),
      secondary: colorValue(raw.colors?.secondary, "#36d7e8"),
      highlight: colorValue(raw.colors?.highlight, "#642a8c"),
      text: colorValue(raw.colors?.text, "#e9fff1"),
      muted: colorValue(raw.colors?.muted, "#9ebdb3"),
      line: colorValue(raw.colors?.line, "rgba(124, 255, 70, .28)"),
    },
  };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  })[character]);
}

function generatedMotif(motif, glow, accent) {
  const common = `<circle cx="1235" cy="245" r="178" fill="${glow}" opacity=".12"/>
    <circle cx="1235" cy="245" r="122" fill="none" stroke="${accent}" stroke-width="3" opacity=".34"/>
    <circle cx="1235" cy="245" r="82" fill="none" stroke="${glow}" stroke-width="1.5" stroke-dasharray="8 13" opacity=".46"/>`;
  const motifs = {
    ninja: `<circle cx="1245" cy="220" r="174" fill="#a51120" opacity=".42"/>
      <path d="M1110 355c22-92 82-151 148-151s126 59 148 151z" fill="#070911" opacity=".96"/>
      <path d="M1165 205l-42-53 66 18-11-72 47 49 27-76 20 79 61-56-18 79 73-23-49 61z" fill="#090b13"/>
      <path d="M1168 190c54-25 117-25 169 0" fill="none" stroke="#aab7c8" stroke-width="25" opacity=".88"/>
      <path d="M1230 178c20-20 50 7 27 24-20 14-43-8-25-25 13-12 29-3 25 9" fill="none" stroke="${glow}" stroke-width="6" stroke-linecap="round"/>
      <path d="M1055 393c127-52 268-51 389 0" fill="none" stroke="${accent}" stroke-width="18" opacity=".72"/>
      <path d="M1450 88l-80 105 58-10-79 116" fill="none" stroke="#67a9ff" stroke-width="7" filter="url(#softGlow)"/>`,
    city: `${common}<path d="M1015 440V290h72v150m28 0V225h88v215m30 0V265h76v175m28 0V180h92v260" fill="none" stroke="${accent}" stroke-width="8" opacity=".62"/>`,
    ocean: `<path d="M880 315c125-82 226 71 352-7 118-72 215 29 330-30v185H880z" fill="${glow}" opacity=".18"/><path d="M885 350c120-70 225 64 350-8 116-67 214 25 325-29" fill="none" stroke="${accent}" stroke-width="7" opacity=".68"/>${common}`,
    mountain: `<path d="M830 440l190-244 95 120 93-173 222 297z" fill="#060b0d" opacity=".74"/><path d="M1020 196l37 47 58 73m93-173l48 66 40 54" fill="none" stroke="${accent}" stroke-width="5" opacity=".62"/>`,
    space: `${common}<ellipse cx="1235" cy="245" rx="300" ry="92" fill="none" stroke="${accent}" stroke-width="4" opacity=".56" transform="rotate(-15 1235 245)"/><circle cx="1460" cy="170" r="17" fill="${glow}" filter="url(#softGlow)"/>`,
    gear: `${common}<path d="M1235 123v40m0 164v40m-122-122h40m164 0h40m-208-86l29 29m116 116l29 29m0-174l-29 29m-116 116l-29 29" stroke="${accent}" stroke-width="18"/><circle cx="1235" cy="245" r="48" fill="${glow}" opacity=".42"/>`,
    rain: `<g stroke="${accent}" stroke-width="4" opacity=".38">${Array.from({ length: 15 }, (_, index) => `<path d="M${900 + index * 45} ${70 + (index % 4) * 30}l-35 120"/>`).join("")}</g>${common}`,
    matrix: `<g fill="${glow}" font-family="monospace" font-size="22" opacity=".38">${Array.from({ length: 13 }, (_, index) => `<text x="${910 + index * 48}" y="${115 + (index % 5) * 55}">${index % 2}1${(index + 1) % 2}0</text>`).join("")}</g>`,
    forest: `<path d="M900 440l90-190 42 82 93-238 85 227 58-145 132 264z" fill="#06120b" opacity=".80"/><g fill="${accent}" opacity=".25"><circle cx="1060" cy="172" r="9"/><circle cx="1324" cy="137" r="7"/><circle cx="1430" cy="245" r="11"/></g>`,
    desert: `<circle cx="1295" cy="180" r="105" fill="${glow}" opacity=".35"/><path d="M830 392c180-132 313 35 450-45 91-54 184-17 300 53v70H830z" fill="${accent}" opacity=".20"/>`,
    ice: `<path d="M900 440l180-298 85 153 90-210 214 355z" fill="${accent}" opacity=".18"/><path d="M1080 142l37 66 48 87m90-210l41 98 68 89" fill="none" stroke="${glow}" stroke-width="6" opacity=".60"/>`,
    synth: `<circle cx="1240" cy="208" r="125" fill="${glow}" opacity=".34"/><path d="M870 440h720M930 385h600m-530-54h460m-400-50h330" stroke="${accent}" stroke-width="3" opacity=".36"/><path d="M1235 255L990 440m245-185l245 185" stroke="${glow}" stroke-width="4" opacity=".38"/>`,
    dragon: `<path d="M1000 358c55-176 143-233 248-165 68 44 130-5 175-87-2 129-56 229-166 223-71-4-109 27-136 102" fill="none" stroke="${glow}" stroke-width="30" opacity=".44"/><circle cx="1395" cy="138" r="11" fill="${accent}" filter="url(#softGlow)"/>`,
    candy: `<g fill="none" stroke-width="18" opacity=".48"><circle cx="1050" cy="185" r="70" stroke="${glow}"/><circle cx="1250" cy="300" r="110" stroke="${accent}"/><circle cx="1460" cy="150" r="52" stroke="${glow}"/></g>`,
    sunset: `<circle cx="1260" cy="215" r="145" fill="${glow}" opacity=".34"/><path d="M850 390c150-75 268 36 390-21 137-64 208 13 350-26" fill="none" stroke="${accent}" stroke-width="8" opacity=".52"/>`,
    moon: `<circle cx="1280" cy="205" r="148" fill="${accent}" opacity=".55"/><circle cx="1340" cy="165" r="148" fill="#11162a" opacity=".88"/><path d="M930 413l140-135 93 83 86-119 186 171" fill="#070a13" opacity=".70"/>`,
  };
  return motifs[motif] || common;
}

function renderGeneratedThemeArt(theme, art) {
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  const from = hex(art?.from, theme.colors.background);
  const to = hex(art?.to, theme.colors.panelAlt);
  const glow = hex(art?.glow, theme.colors.accent);
  const accent = hex(art?.accent, theme.colors.secondary);
  const symbol = escapeXml(textValue(art?.symbol, "◆", 4));
  const subtitle = escapeXml(theme.brandSubtitle);
  const motif = textValue(art?.motif, "default", 24).toLowerCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
      <radialGradient id="halo"><stop stop-color="${glow}" stop-opacity=".44"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
      <pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M54 0H0V54" fill="none" stroke="${accent}" stroke-opacity=".08"/></pattern>
      <filter id="softGlow"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1600" height="520" fill="url(#background)"/>
    <rect width="1600" height="520" fill="url(#grid)"/>
    <ellipse cx="1260" cy="250" rx="430" ry="320" fill="url(#halo)"/>
    ${generatedMotif(motif, glow, accent)}
    <text x="1465" y="392" text-anchor="middle" fill="${accent}" fill-opacity=".22" font-family="system-ui,sans-serif" font-size="220" font-weight="800">${symbol}</text>
    <text x="1518" y="468" text-anchor="end" fill="#fff" fill-opacity=".44" font-family="system-ui,sans-serif" font-size="18" font-weight="700" letter-spacing="5">${subtitle}</text>
    <path d="M850 468h680" stroke="${glow}" stroke-width="2" opacity=".30"/>
  </svg>`;
}

async function imageDataUrl(imagePath) {
  const stat = await fs.stat(imagePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_ART_BYTES) {
    throw new Error(`Theme image must be a non-empty file no larger than ${MAX_ART_BYTES} bytes`);
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw new Error(`Unsupported theme image format: ${extension || "missing"}`);
  }
  const image = await fs.readFile(imagePath);
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp" : "image/png";
  return { artDataUrl: `data:${mime};base64,${image.toString("base64")}`, imageBytes: image.length };
}

async function loadBuiltInThemes() {
  const profilesRoot = path.join(root, "profiles");
  const entries = await fs.readdir(profilesRoot, { withFileTypes: true });
  const ids = new Set();
  const loadedThemes = [];
  let imageBytes = 0;
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const profileRoot = path.join(profilesRoot, entry.name);
    const configPath = path.join(profileRoot, "theme.json");
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (raw.schemaVersion !== 1 || typeof raw.image !== "string" || !raw.image) {
      throw new Error(`${configPath} has an unsupported schema or image field`);
    }
    if (path.basename(raw.image) !== raw.image) throw new Error(`Theme image escapes profile: ${raw.image}`);
    const theme = normalizeTheme(raw, entry.name, "builtin");
    if (ids.has(theme.id)) throw new Error(`Duplicate built-in theme id: ${theme.id}`);
    ids.add(theme.id);
    const loaded = await imageDataUrl(path.join(profileRoot, raw.image));
    imageBytes += loaded.imageBytes;
    loadedThemes.push({
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 1000,
      theme: { ...theme, artDataUrl: loaded.artDataUrl },
    });
  }
  loadedThemes.sort((left, right) => left.order - right.order || left.theme.name.localeCompare(right.theme.name));
  const themes = loadedThemes.map((item, index) => ({ ...item.theme, index: index + 1 }));
  if (themes.length !== BUILTIN_THEME_COUNT) {
    throw new Error(`${profilesRoot} must define exactly ${BUILTIN_THEME_COUNT} valid themes`);
  }
  if (themes.some((theme) => !LAYOUT_VARIANTS.has(theme.layoutVariant) || !EFFECT_TYPES.has(theme.effect))) {
    throw new Error("Every built-in theme must define a supported layout and effect");
  }
  return { themes, imageBytes };
}

async function loadCustomTheme(themeDir) {
  if (!themeDir) return null;
  const configPath = path.join(themeDir, "theme.json");
  try {
    await fs.access(configPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const raw = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (raw.schemaVersion !== 1 || typeof raw.image !== "string" || !raw.image) {
    throw new Error(`${configPath} has an unsupported schema or image field`);
  }
  if (path.basename(raw.image) !== raw.image) throw new Error("Custom theme image must stay inside its theme directory");
  const theme = normalizeTheme(raw, "custom", "custom");
  const loaded = await imageDataUrl(path.join(themeDir, raw.image));
  return { theme: { ...theme, artDataUrl: loaded.artDataUrl, index: null }, imageBytes: loaded.imageBytes };
}

async function loadPayload(themeDir) {
  const [css, template, builtins, custom] = await Promise.all([
    fs.readFile(path.join(root, "assets", "dream-skin.css"), "utf8"),
    fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
    loadBuiltInThemes(),
    loadCustomTheme(themeDir),
  ]);
  const customIsBuiltin = custom && builtins.themes.some((theme) => theme.id === custom.theme.id);
  const includedCustom = custom && !customIsBuiltin ? custom : null;
  const themes = includedCustom ? [includedCustom.theme, ...builtins.themes] : builtins.themes;
  const themePack = {
    schemaVersion: 1,
    builtinCount: builtins.themes.length,
    customThemeId: includedCustom?.theme.id ?? null,
    themes,
  };
  const preferredTheme = customIsBuiltin
    ? builtins.themes.find((theme) => theme.id === custom.theme.id)
    : includedCustom?.theme ?? builtins.themes[0];
  const payload = template
    .replace("__DREAM_SKIN_CSS_JSON__", JSON.stringify(css))
    .replace("__DREAM_SKIN_THEME_PACK_JSON__", JSON.stringify(themePack))
    .replace("__DREAM_SKIN_VERSION_JSON__", JSON.stringify(SKIN_VERSION));
  return {
    imageBytes: builtins.imageBytes + (includedCustom?.imageBytes ?? 0),
    payload,
    theme: preferredTheme,
    builtinThemeCount: builtins.themes.length,
    secondThemeId: builtins.themes[1].id,
  };
}

async function applyToSession(session, payload) {
  return session.evaluate(payload);
}

async function selectThemeInSession(session, themeId) {
  const selected = await session.evaluate(`(() => {
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    const button = [...document.querySelectorAll('#codex-dream-skin-theme-picker [data-dream-theme-id]')]
      .find((candidate) => candidate.dataset.dreamThemeId === ${JSON.stringify(themeId)});
    if (button) {
      button.click();
      return state?.themeId === ${JSON.stringify(themeId)};
    }
    return typeof state?.setActiveTheme === 'function' && state.setActiveTheme(${JSON.stringify(themeId)}, true);
  })()`);
  if (!selected) throw new Error(`Theme is unavailable in the live renderer: ${themeId}`);
}

async function navigateHomeInSession(session) {
  const navigation = await session.evaluate(`(() => {
    const icon = document.querySelector('[data-testid="home-icon"]');
    const labelled = [...document.querySelectorAll('aside button, aside a, aside [role="button"]')]
      .find(node => /^(home|主页|首页|新建任务)(⌘N)?$/i.test((node.getAttribute('aria-label') || node.textContent || '').trim()));
    const target = icon?.closest('button, a, [role="button"]') || icon || labelled;
    if (!target) return {
      clicked: false,
      candidates: [...document.querySelectorAll('aside button, aside a, aside [role="button"]')].slice(0, 30).map(node => ({
        text: (node.textContent || '').trim().slice(0, 80),
        ariaLabel: node.getAttribute('aria-label'),
        href: node.getAttribute('href'),
        testId: node.getAttribute('data-testid'),
      })),
    };
    target.click();
    return { clicked: true };
  })()`);
  if (!navigation?.clicked) throw new Error(`Could not find the native Codex home control: ${JSON.stringify(navigation?.candidates || [])}`);
  await new Promise((resolve) => setTimeout(resolve, 900));
}

async function navigateBackInSession(session) {
  await session.evaluate(`(() => { history.back(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 900));
}

async function removeFromSession(session) {
  return session.evaluate(`(() => {
    window.__CODEX_DREAM_SKIN_DISABLED__ = true;
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (state?.cleanup) return state.cleanup();
    document.documentElement?.classList.remove('codex-dream-skin');
    document.documentElement?.style.removeProperty('--dream-skin-art');
    document.getElementById('codex-dream-skin-style')?.remove();
    document.getElementById('codex-dream-skin-chrome')?.remove();
    document.getElementById('codex-dream-skin-theme-picker')?.remove();
    delete window.__CODEX_DREAM_SKIN_STATE__;
    return true;
  })()`);
}

async function verifyRemovedSession(session) {
  return session.evaluate(`(() =>
    !document.documentElement.classList.contains('codex-dream-skin') &&
    !document.getElementById('codex-dream-skin-style') &&
    !document.getElementById('codex-dream-skin-chrome') &&
    !document.getElementById('codex-dream-skin-theme-picker') &&
    !window.__CODEX_DREAM_SKIN_STATE__
  )()`);
}

async function verifySession(session, allowStartupFrame = false) {
  return session.evaluate(`(async () => {
    const allowStartupFrame = ${allowStartupFrame ? "true" : "false"};
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      };
    };
    const homeIndicator = document.querySelector('[data-testid="home-icon"]');
    const homeSignal = homeIndicator ?? document.querySelector('[data-feature="game-source"]') ??
      document.querySelector('.group\\\\/home-suggestions');
    const homeRoute = homeSignal?.closest('[role="main"]') ?? null;
    const home = document.querySelector('[role="main"].dream-skin-home');
    const suggestions = home?.querySelector('.group\\\\/home-suggestions') ?? null;
    const cardBoxes = suggestions ? [...suggestions.querySelectorAll('button')].map(box) : [];
    const visibleCards = cardBoxes.filter((item) => item?.visible);
    const fallbackActions = [...document.querySelectorAll('#codex-dream-skin-chrome .dream-skin-fallback-actions button')].map(box);
    const visibleFallbackActions = fallbackActions.filter((item) => item?.visible);
    const visibleMissionCards = visibleCards.length >= 2 ? visibleCards : visibleFallbackActions;
    const heroElement = home?.firstElementChild?.firstElementChild?.firstElementChild ?? null;
    const hero = box(heroElement);
    const heroWallpaper = heroElement?.querySelector(':scope > .dream-skin-hero-wallpaper') ?? null;
    const heroArt = heroWallpaper?.querySelector('.dream-skin-hero-art') ?? null;
    const heroEffect = heroWallpaper?.querySelector('.dream-skin-hero-fx .dream-skin-fx-field') ?? null;
    const projectButton = box(home?.querySelector('.group\\\\/project-selector > button'));
    const projectPanel = box(home?.querySelector('div:has(> .horizontal-scroll-fade-mask [class~="group/project-selector"])'));
    const composer = box(document.querySelector('.composer-surface-chrome'));
    const sidebar = box(document.querySelector('aside.app-shell-left-panel'));
    const mainSurface = document.querySelector('main.main-surface');
    const mainSurfaceStyle = getComputedStyle(mainSurface || document.body);
    const taskArtStyle = mainSurface ? getComputedStyle(mainSurface, '::before') : null;
    const chrome = document.getElementById('codex-dream-skin-chrome');
    const viewportEffect = chrome?.querySelector('.dream-skin-viewport-fx .dream-skin-fx-field') ?? null;
    const picker = document.getElementById('codex-dream-skin-theme-picker');
    const pickerTrigger = box(picker?.querySelector('.dream-skin-theme-trigger'));
    const uploadButton = box(picker?.querySelector('.dream-skin-upload-button'));
    const uploadInput = picker?.querySelector('.dream-skin-upload-input');
    const themeEditor = picker?.querySelector('.dream-skin-theme-editor');
    const themeState = window.__CODEX_DREAM_SKIN_STATE__;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const artStyle = home ? (heroArt ? getComputedStyle(heroArt) : null) : taskArtStyle;
    const effectNode = home ? heroEffect : viewportEffect;
    const motionStyle = effectNode ? getComputedStyle(effectNode) : null;
    const motionBackgroundStart = motionStyle?.backgroundPosition ?? null;
    const motionTimelineStart = effectNode?.getAnimations?.()[0]?.currentTime ?? null;
    if (themeState?.themeId !== 'system-default' && !reducedMotion && motionStyle) {
      await new Promise(resolve => setTimeout(resolve, 420));
    }
    const motionStyleAfter = effectNode ? getComputedStyle(effectNode) : null;
    const motionBackgroundEnd = motionStyleAfter?.backgroundPosition ?? null;
    const motionTimelineEnd = effectNode?.getAnimations?.()[0]?.currentTime ?? null;
    const result = {
      installed: document.documentElement.classList.contains('codex-dream-skin'),
      version: themeState?.version ?? null,
      themeId: themeState?.themeId ?? null,
      themeName: themeState?.themeName ?? null,
      layoutVariant: themeState?.layoutVariant ?? null,
      motionProfile: themeState?.motionProfile ?? null,
      effectType: themeState?.effectType ?? null,
      builtinEffectTypeCount: new Set(themeState?.effectTypes ?? []).size,
      systemDefault: themeState?.themeId === 'system-default',
      builtinThemeCount: themeState?.builtinThemeCount ?? 0,
      secondThemeId: themeState?.themeIds?.[1] ?? null,
      stylePresent: Boolean(document.getElementById('codex-dream-skin-style')),
      chromePresent: Boolean(chrome),
      chromePointerEvents: getComputedStyle(chrome || document.body).pointerEvents,
      pickerPresent: Boolean(picker),
      pickerTrigger,
      pickerPointerEvents: getComputedStyle(picker || document.body).pointerEvents,
      pickerCardCount: picker?.querySelectorAll('[data-dream-theme-id]').length ?? 0,
      defaultThemeAvailable: Boolean(picker?.querySelector('[data-dream-theme-id="system-default"]')),
      uploadEnabled: themeState?.uploadEnabled === true,
      uploadsReady: themeState?.uploadsReady === true,
      uploadStorage: themeState?.uploadStorage ?? null,
      uploadButton,
      uploadInputConfigured: Boolean(uploadInput?.accept.includes('image/png') &&
        uploadInput.accept.includes('image/jpeg') && uploadInput.accept.includes('image/webp')),
      themeEditorAvailable: Boolean(themeEditor && themeEditor.querySelectorAll('[data-theme-color]').length === 4 &&
        themeEditor.querySelector('[name="theme-layout"]')),
      homeRoute: Boolean(homeRoute),
      homePresent: Boolean(home),
      suggestionsPresent: Boolean(suggestions),
      hero,
      cards: cardBoxes,
      visibleCardCount: visibleCards.length,
      fallbackActions,
      visibleFallbackActionCount: visibleFallbackActions.length,
      orbitalCommand: {
        cardCount: visibleMissionCards.length,
        singleRow: visibleMissionCards.length === 4 &&
          Math.max(...visibleMissionCards.map((item) => item.y)) -
            Math.min(...visibleMissionCards.map((item) => item.y)) <= 4,
        asymmetricDeck: visibleMissionCards.length === 4 && (() => {
          const [first, second, third, fourth] = visibleMissionCards;
          return Math.abs(first.y - second.y) <= 4 && Math.abs(second.y - third.y) <= 4 &&
            fourth.y >= second.y + second.height - 4 && first.height >= second.height + fourth.height - 12 &&
            Math.abs(fourth.x - second.x) <= 4 &&
            Math.abs((fourth.x + fourth.width) - (third.x + third.width)) <= 4;
        })(),
        deckAligned: visibleMissionCards.length === 4 && projectPanel && composer &&
          Math.abs(Math.min(...visibleMissionCards.map((item) => item.x)) - composer.x) <= 4 &&
          Math.abs(Math.max(...visibleMissionCards.map((item) => item.x + item.width)) -
            (composer.x + composer.width)) <= 4 &&
          Math.abs(projectPanel.x - composer.x) <= 4 &&
          Math.abs((projectPanel.x + projectPanel.width) - (composer.x + composer.width)) <= 4,
        cardsToProjectPanelGap: projectPanel && visibleMissionCards.length
          ? Math.round(projectPanel.y - Math.max(...visibleMissionCards.map((item) => item.y + item.height)))
          : null,
        projectGap: projectButton && visibleMissionCards.length
          ? Math.round(projectButton.y - Math.max(...visibleMissionCards.map((item) => item.y + item.height)))
          : null,
      },
      projectButton,
      projectPanel,
      composer,
      sidebar,
      dynamicWallpaper: {
        source: home ? 'hero' : 'task',
        effectType: document.documentElement.dataset.dreamSkinEffect ?? null,
        layerPresent: home ? Boolean(heroWallpaper && heroArt && heroEffect)
          : Boolean(mainSurface && taskArtStyle?.content !== 'none' && viewportEffect),
        pointerEvents: effectNode ? getComputedStyle(effectNode).pointerEvents : null,
        artAnimationName: artStyle?.animationName ?? null,
        artTransform: artStyle?.transform ?? null,
        artStatic: artStyle?.animationName === 'none' && artStyle?.transform === 'none',
        animationName: motionStyleAfter?.animationName ?? null,
        animationPlayState: motionStyleAfter?.animationPlayState ?? null,
        backgroundPositionStart: motionBackgroundStart,
        backgroundPositionEnd: motionBackgroundEnd,
        timelineStart: motionTimelineStart,
        timelineEnd: motionTimelineEnd,
        effectChanged: Boolean(
          (motionBackgroundStart && motionBackgroundEnd && motionBackgroundStart !== motionBackgroundEnd) ||
          (Number.isFinite(motionTimelineStart) && Number.isFinite(motionTimelineEnd) &&
            motionTimelineEnd > motionTimelineStart)
        ),
        startupFrameAccepted: Boolean(allowStartupFrame),
        reducedMotion,
        reducedMotionHonored: !reducedMotion || motionStyleAfter?.animationName === 'none',
      },
      taskBackground: {
        size: taskArtStyle?.backgroundSize ?? mainSurfaceStyle.backgroundSize,
        position: taskArtStyle?.backgroundPosition ?? mainSurfaceStyle.backgroundPosition,
        fullBleed: (taskArtStyle?.backgroundSize ?? '').split(',').at(-1)?.trim() === 'cover',
      },
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    const sharedPass = result.version === ${JSON.stringify(SKIN_VERSION)} && result.stylePresent &&
      result.pickerPresent && Boolean(result.pickerTrigger?.visible) && result.pickerPointerEvents !== 'none' &&
      result.builtinThemeCount === ${BUILTIN_THEME_COUNT} &&
      result.builtinEffectTypeCount === ${EFFECT_TYPES.size} &&
      result.pickerCardCount >= ${BUILTIN_THEME_COUNT + 1} && result.defaultThemeAvailable &&
      result.uploadEnabled && result.uploadsReady && result.uploadStorage === 'indexedDB' &&
      Boolean(result.uploadButton) && result.uploadInputConfigured && result.themeEditorAvailable &&
      Boolean(result.composer?.visible) && Boolean(result.sidebar?.visible) && !result.documentOverflow.x;
    const motionPass = result.dynamicWallpaper.layerPresent && result.dynamicWallpaper.pointerEvents === 'none' &&
      result.dynamicWallpaper.artStatic && /^[0-5]$/.test(String(result.motionProfile)) &&
      result.dynamicWallpaper.reducedMotionHonored &&
      (result.dynamicWallpaper.reducedMotion || (
        result.dynamicWallpaper.animationName.split(',').some(name => name.trim().startsWith('ds-fx-')) &&
        result.dynamicWallpaper.animationPlayState === 'running' &&
        (result.dynamicWallpaper.effectChanged || result.dynamicWallpaper.startupFrameAccepted)
      ));
    const themedPass = result.installed && result.chromePresent && result.chromePointerEvents === 'none' && motionPass;
    const systemDefaultPass = result.systemDefault && !result.installed && !result.chromePresent && !result.homePresent;
    const orbitalPass = true;
    const taskBackgroundPass = result.homeRoute || result.taskBackground.fullBleed;
    const homePass = !result.homeRoute || (
      result.homePresent && result.hero?.visible && result.hero.width >= 320 && result.hero.height >= 160 &&
      ((result.suggestionsPresent && result.visibleCardCount >= 2 && result.visibleCardCount <= 4) ||
        (!result.suggestionsPresent && result.visibleFallbackActionCount === 4)) &&
      Boolean(result.projectButton?.visible)
    );
    result.pass = Boolean(sharedPass && (result.systemDefault ? systemDefaultPass :
      themedPass && homePass && orbitalPass && taskBackgroundPass));
    return result;
  })()`, 120000);
}

async function testThemeStudioSession(session, previewOnly = false) {
  return session.evaluate(`(async () => {
    const previewOnly = ${previewOnly ? "true" : "false"};
    const waitFor = async (check, timeout = 10000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Theme Studio self-test timed out');
    };
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    const picker = document.getElementById('codex-dream-skin-theme-picker');
    const input = picker?.querySelector('.dream-skin-upload-input');
    const editor = picker?.querySelector('.dream-skin-theme-editor');
    if (!state?.uploadEnabled || !state.uploadsReady || !picker || !input || !editor) {
      return { pass: false, error: 'Theme Studio is not ready' };
    }
    const originalThemeId = state.themeId;
    const originalConfirm = window.confirm;
    let savedId = null;
    let processed = null;
    let savedMotion = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 540;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 960, 540);
      gradient.addColorStop(0, '#10194d');
      gradient.addColorStop(.52, '#e4485e');
      gradient.addColorStop(1, '#36d7e8');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 960, 540);
      context.fillStyle = '#f6e04b';
      context.beginPath();
      context.arc(730, 210, 125, 0, Math.PI * 2);
      context.fill();
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create test image')), 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'Codex-Theme-Studio-Self-Test.png', { type: 'image/png' }));
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => !editor.hidden || picker.querySelector('.dream-skin-upload-status')?.dataset.tone === 'error');
      if (editor.hidden) throw new Error(picker.querySelector('.dream-skin-upload-status')?.textContent || 'Image analysis failed');
      const colors = [...editor.querySelectorAll('[data-theme-color]')].map(node => node.value);
      const preview = editor.querySelector('.dream-skin-editor-preview');
      processed = {
        colorCount: colors.length,
        distinctColors: new Set(colors).size,
        previewReady: getComputedStyle(preview).backgroundImage.includes('data:image/webp'),
      };
      if (previewOnly) {
        return {
          pass: processed.colorCount === 4 && processed.distinctColors >= 2 && processed.previewReady,
          processed,
          previewOnly: true,
        };
      }
      editor.querySelector('[name="theme-name"]').value = '__Codex Theme Studio Self-Test__';
      editor.querySelector('[name="theme-layout"]').value = 'command-center';
      editor.requestSubmit();
      savedId = await waitFor(() => state.themeId?.startsWith('custom-upload-') && state.themeId);
      await waitFor(() => picker.querySelector('[data-dream-theme-id="' + savedId + '"]'));
      const savedThemeId = savedId;
      const savedLayout = document.documentElement.dataset.dreamSkinLayout;
      const heroArt = document.querySelector('.dream-skin-hero-art');
      const heroEffect = document.querySelector('.dream-skin-hero-fx .dream-skin-fx-field');
      const mainSurface = document.querySelector('main.main-surface');
      const viewportEffect = document.querySelector('.dream-skin-viewport-fx .dream-skin-fx-field');
      const artStyle = heroArt ? getComputedStyle(heroArt)
        : mainSurface ? getComputedStyle(mainSurface, '::before') : null;
      const effectNode = heroEffect || viewportEffect;
      const motionStyle = effectNode ? getComputedStyle(effectNode) : null;
      const motionStart = motionStyle?.backgroundPosition ?? null;
      const timelineStart = effectNode?.getAnimations?.()[0]?.currentTime ?? null;
      await new Promise(resolve => setTimeout(resolve, 420));
      const motionStyleAfter = effectNode ? getComputedStyle(effectNode) : null;
      const motionEnd = motionStyleAfter?.backgroundPosition ?? null;
      const timelineEnd = effectNode?.getAnimations?.()[0]?.currentTime ?? null;
      savedMotion = {
        source: heroArt ? 'hero' : 'task',
        profile: document.documentElement.dataset.dreamSkinMotion ?? null,
        effectType: document.documentElement.dataset.dreamSkinEffect ?? null,
        artStatic: artStyle?.animationName === 'none' && artStyle?.transform === 'none',
        animationName: motionStyleAfter?.animationName ?? null,
        animationPlayState: motionStyleAfter?.animationPlayState ?? null,
        pointerEvents: motionStyleAfter?.pointerEvents ?? null,
        effectChanged: Boolean(
          (motionStart && motionEnd && motionStart !== motionEnd) ||
          (Number.isFinite(timelineStart) && Number.isFinite(timelineEnd) && timelineEnd > timelineStart)
        ),
      };
      const shell = picker.querySelector('[data-dream-theme-id="' + savedId + '"]')?.closest('.dream-skin-custom-card-shell');
      window.confirm = () => true;
      shell?.querySelector('.dream-skin-custom-remove')?.click();
      await waitFor(() => !picker.querySelector('[data-dream-theme-id="' + savedThemeId + '"]'));
      savedId = null;
      if (state.themeId !== originalThemeId) state.setActiveTheme(originalThemeId, true);
      return {
        pass: processed.colorCount === 4 && processed.distinctColors >= 2 && processed.previewReady &&
          savedLayout === 'command-center' && /^[0-5]$/.test(String(savedMotion.profile)) &&
          savedMotion.artStatic && savedMotion.animationName.split(',').some(name => name.trim().startsWith('ds-fx-')) &&
          savedMotion.animationPlayState === 'running' && savedMotion.pointerEvents === 'none' &&
          savedMotion.effectChanged && state.themeId === originalThemeId,
        processed,
        savedLayout,
        savedMotion,
        restoredThemeId: state.themeId,
      };
    } catch (error) {
      return { pass: false, error: error.message || String(error), processed, savedMotion, savedId };
    } finally {
      window.confirm = originalConfirm;
      if (savedId) {
        try {
          const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open('codex-dream-skin-studio', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise((resolve, reject) => {
            const transaction = database.transaction('uploaded-themes', 'readwrite');
            transaction.objectStore('uploaded-themes').delete(savedId);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
          });
          const shell = picker.querySelector('[data-dream-theme-id="' + savedId + '"]')?.closest('.dream-skin-custom-card-shell');
          window.confirm = () => true;
          shell?.querySelector('.dream-skin-custom-remove')?.click();
        } catch { /* Best-effort cleanup is followed by restoring the original theme. */ }
      }
      if (state.themeId !== originalThemeId) state.setActiveTheme(originalThemeId, true);
      window.confirm = originalConfirm;
      if (!previewOnly) {
        const status = picker.querySelector('.dream-skin-upload-status');
        if (status) {
          status.textContent = '图片只保存在这台电脑，不会覆盖内置主题。';
          status.dataset.tone = 'neutral';
        }
      }
    }
  })()`);
}

async function testAllEffectsSession(session) {
  return session.evaluate(`(async () => {
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (!state?.setActiveTheme || !Array.isArray(state.themeIds) || state.themeIds.length !== ${BUILTIN_THEME_COUNT}) {
      return { pass: false, error: 'Theme state is not ready for all-effects verification' };
    }
    const allowedEffects = new Set(${JSON.stringify([...EFFECT_TYPES])});
    const originalThemeId = state.themeId;
    const results = [];
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    try {
      for (let index = 0; index < state.themeIds.length; index += 1) {
        const themeId = state.themeIds[index];
        if (!state.setActiveTheme(themeId, false)) {
          results.push({ themeId, pass: false, error: 'Theme switch failed' });
          continue;
        }
        await wait(140);
        const heroArt = document.querySelector('.dream-skin-hero-art');
        const mainSurface = document.querySelector('main.main-surface');
        const effectNode = document.querySelector('.dream-skin-hero-fx .dream-skin-fx-field') ||
          document.querySelector('.dream-skin-viewport-fx .dream-skin-fx-field');
        const artStyle = heroArt ? getComputedStyle(heroArt)
          : mainSurface ? getComputedStyle(mainSurface, '::before') : null;
        const before = effectNode ? getComputedStyle(effectNode) : null;
        const backgroundStart = before?.backgroundPosition ?? null;
        const timelineStart = effectNode?.getAnimations?.()[0]?.currentTime ?? null;
        await wait(180);
        const after = effectNode ? getComputedStyle(effectNode) : null;
        const backgroundEnd = after?.backgroundPosition ?? null;
        const timelineEnd = effectNode?.getAnimations?.()[0]?.currentTime ?? null;
        const effectType = document.documentElement.dataset.dreamSkinEffect ?? null;
        const animationNames = String(after?.animationName || '').split(',').map(value => value.trim());
        const changed = Boolean(
          (backgroundStart && backgroundEnd && backgroundStart !== backgroundEnd) ||
          (Number.isFinite(timelineStart) && Number.isFinite(timelineEnd) && timelineEnd > timelineStart)
        );
        const item = {
          slot: index + 1,
          themeId,
          effectType,
          expectedEffectType: null,
          animationName: after?.animationName ?? null,
          animationPlayState: after?.animationPlayState ?? null,
          pointerEvents: after?.pointerEvents ?? null,
          artStatic: artStyle?.animationName === 'none' && artStyle?.transform === 'none',
          effectChanged: changed,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
        item.pass = allowedEffects.has(item.effectType) &&
          animationNames.some(name => name.startsWith('ds-fx-')) &&
          item.animationPlayState === 'running' && item.pointerEvents === 'none' && item.artStatic &&
          item.effectChanged && !item.horizontalOverflow;
        results.push(item);
      }
    } finally {
      if (originalThemeId && state.themeId !== originalThemeId) state.setActiveTheme(originalThemeId, false);
    }
    const uniqueEffects = new Set(results.map(item => item.effectType)).size;
    return {
      pass: results.length === ${BUILTIN_THEME_COUNT} && results.every(item => item.pass) &&
        uniqueEffects === ${EFFECT_TYPES.size} && state.themeId === originalThemeId,
      uniqueEffects,
      originalThemeId,
      restoredThemeId: state.themeId,
      results,
    };
  })()`, 120000);
}

async function testReducedMotionSession(session) {
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  try {
    return await verifySession(session);
  } finally {
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
}

async function testSystemDefaultSession(session) {
  return session.evaluate(`(async () => {
    const state = window.__CODEX_DREAM_SKIN_STATE__;
    if (!state?.setActiveTheme || !state.themeId) return { pass: false, error: 'Theme state is unavailable' };
    const originalThemeId = state.themeId;
    const waitFrame = () => new Promise(resolve => setTimeout(resolve, 180));
    try {
      if (!state.setActiveTheme('system-default', false)) return { pass: false, error: 'System Default could not be selected' };
      await waitFrame();
      const defaultState = {
        themeId: state.themeId,
        rootClassRemoved: !document.documentElement.classList.contains('codex-dream-skin'),
        chromeRemoved: !document.getElementById('codex-dream-skin-chrome'),
        homeClassRemoved: !document.querySelector('.dream-skin-home'),
        pickerPresent: Boolean(document.getElementById('codex-dream-skin-theme-picker')),
      };
      state.setActiveTheme(originalThemeId, false);
      await waitFrame();
      return {
        pass: defaultState.themeId === 'system-default' && defaultState.rootClassRemoved &&
          defaultState.chromeRemoved && defaultState.homeClassRemoved && defaultState.pickerPresent &&
          state.themeId === originalThemeId,
        originalThemeId,
        restoredThemeId: state.themeId,
        defaultState,
      };
    } catch (error) {
      if (state.themeId !== originalThemeId) state.setActiveTheme(originalThemeId, false);
      return { pass: false, error: error.message || String(error), originalThemeId, restoredThemeId: state.themeId };
    }
  })()`);
}

async function waitForVerifiedSession(session, timeoutMs, allowStartupFrame = false) {
  const deadline = Date.now() + timeoutMs;
  let lastResult;
  while (Date.now() < deadline) {
    lastResult = await verifySession(session, allowStartupFrame);
    if (lastResult.pass) return lastResult;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastResult;
}

async function capture(session, outputPath, dismissOverlays = true) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (dismissOverlays) {
    await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  const viewport = await session.evaluate("({ width: innerWidth, height: innerHeight })");
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(viewport.width * 0.64),
    y: Math.round(viewport.height * 0.62),
    button: "none",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  let result;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      result = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    }
  }
  if (!result?.data) throw lastError || new Error("CDP returned an empty screenshot");
  await fs.writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function runOneShot(options) {
  const connected = await connectCodexTargets(options.port, options.timeoutMs);
  const loaded = (options.mode === "once" || options.reload) ? await loadPayload(options.themeDir) : null;
  const payload = loaded?.payload ?? null;
  const results = [];
  let screenshotCaptured = false;

  for (const { target, session, probe } of connected) {
    try {
      if (options.mode === "remove") await removeFromSession(session);
      else if (options.mode === "once") await applyToSession(session, payload);
      else if (options.mode === "select") await selectThemeInSession(session, options.themeId);
      else if (options.mode === "home") await navigateHomeInSession(session);
      else if (options.mode === "back") await navigateBackInSession(session);

      if (options.reload) {
        await session.send("Page.reload", { ignoreCache: true });
        await new Promise((resolve) => setTimeout(resolve, 1600));
        await session.send("Page.bringToFront");
        if (options.mode !== "remove" && options.mode !== "verify") await applyToSession(session, payload);
      }

      const result = options.mode === "remove"
        ? await verifyRemovedSession(session)
        : options.mode === "studio-test" || options.mode === "studio-preview"
          ? await testThemeStudioSession(session, options.mode === "studio-preview")
          : options.mode === "effects-test"
            ? await testAllEffectsSession(session)
            : options.mode === "reduced-motion-test"
              ? await testReducedMotionSession(session)
              : options.mode === "system-default-test"
                ? await testSystemDefaultSession(session)
          : await waitForVerifiedSession(session, options.timeoutMs, options.reload);
      results.push({ targetId: target.id, title: target.title, url: target.url, probe, result });

      if (options.screenshot && !screenshotCaptured) {
        if (options.openThemePicker) {
          await session.evaluate(`(() => {
            const trigger = document.querySelector('#codex-dream-skin-theme-picker .dream-skin-theme-trigger');
            if (!trigger) return false;
            if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
            return true;
          })()`);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await capture(session, options.screenshot, !options.openThemePicker);
        screenshotCaptured = true;
      }
    } finally {
      session.close();
    }
  }

  console.log(JSON.stringify({ mode: options.mode, version: SKIN_VERSION, port: options.port, targets: results }, null, 2));
  const failed = results.length === 0 || results.some((item) => options.mode === "remove" ? item.result !== true : !item.result?.pass);
  if (failed) process.exitCode = 2;
}

async function runWatch(options) {
  const { payload } = await loadPayload(options.themeDir);
  const sessions = new Map();
  const rejected = new Set();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    let targets = [];
    try {
      targets = await listAppTargets(options.port);
    } catch (error) {
      console.error(`[dream-skin] ${new Date().toISOString()} ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const activeIds = new Set(targets.map((target) => target.id));
    for (const [id, session] of sessions) {
      if (!activeIds.has(id) || session.closed) {
        session.close();
        sessions.delete(id);
      }
    }

    for (const target of targets) {
      if (sessions.has(target.id)) continue;
      let session;
      try {
        session = await connectTarget(target, options.port);
        const probe = await probeSession(session);
        if (!probe?.codex) {
          session.close();
          if (!rejected.has(target.id)) {
            console.error(`[dream-skin] rejected non-Codex app target ${target.id}`);
            rejected.add(target.id);
          }
          continue;
        }
        rejected.delete(target.id);
        session.on("Page.loadEventFired", () => {
          setTimeout(() => applyToSession(session, payload).catch((error) => {
            console.error(`[dream-skin] reinject failed: ${error.message}`);
          }), 250);
        });
        await applyToSession(session, payload);
        sessions.set(target.id, session);
        console.log(`[dream-skin] injected verified Codex target ${target.id} (${target.title || target.url})`);
      } catch (error) {
        session?.close();
        console.error(`[dream-skin] inject failed for ${target.id}: ${error.message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  for (const session of sessions.values()) session.close();
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "check") {
    const loaded = await loadPayload(options.themeDir);
    console.log(JSON.stringify({
      pass: true,
      version: SKIN_VERSION,
      themeId: loaded.theme.id,
      themeName: loaded.theme.name,
      layoutVariant: loaded.theme.layoutVariant,
      builtinThemeCount: loaded.builtinThemeCount,
      secondThemeId: loaded.secondThemeId,
      imageBytes: loaded.imageBytes,
      payloadBytes: Buffer.byteLength(loaded.payload),
    }, null, 2));
  } else if (options.mode === "watch") await runWatch(options);
  else await runOneShot(options);
} catch (error) {
  console.error(`[dream-skin] ${error.stack || error.message}`);
  process.exitCode = 1;
}
