((cssText, themePack) => {
  const STATE_KEY = "__CODEX_DREAM_SKIN_STATE__";
  const DISABLED_KEY = "__CODEX_DREAM_SKIN_DISABLED__";
  const STYLE_ID = "codex-dream-skin-style";
  const CHROME_ID = "codex-dream-skin-chrome";
  const PICKER_ID = "codex-dream-skin-theme-picker";
  const STORAGE_KEY = "codex-dream-skin-theme-id";
  const CUSTOM_SEEN_KEY = "codex-dream-skin-custom-theme-seen";
  const UPLOAD_DB_NAME = "codex-dream-skin-studio";
  const UPLOAD_DB_STORE = "uploaded-themes";
  const UPLOAD_DB_VERSION = 1;
  const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
  const MAX_STORED_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_UPLOADED_THEMES = 12;
  const SYSTEM_DEFAULT_ID = "system-default";
  const VERSION = __DREAM_SKIN_VERSION_JSON__;
  const PACK = themePack && typeof themePack === "object" ? themePack : {};
  const BUILTIN_COUNT = Number(PACK.builtinCount) || 0;
  const LAYOUT_OPTIONS = [
    ["cinematic-banner", "电影横幅"],
    ["immersive-board", "沉浸任务板"],
    ["command-center", "指挥中心"],
  ];
  const LAYOUT_IDS = new Set(LAYOUT_OPTIONS.map(([id]) => id));
  const EFFECT_TYPES = new Set([
    "portal-sparks", "orbital-scan", "aurora-ribbons", "sakura-petals",
  ]);
  const THEME_VARIABLES = [
    "--ds-bg", "--ds-panel", "--ds-panel-2", "--ds-green", "--ds-lime",
    "--ds-cyan", "--ds-purple", "--ds-text", "--ds-muted", "--ds-line",
    "--ds-accent-rgb", "--ds-accent-alt-rgb", "--ds-secondary-rgb",
    "--ds-highlight-rgb", "--ds-text-rgb", "--dream-skin-art",
    "--dream-skin-name", "--dream-skin-tagline", "--dream-skin-project-prefix",
    "--dream-skin-project-label",
  ];

  const previous = window[STATE_KEY];
  if (previous?.cleanup) previous.cleanup();
  else {
    previous?.observer?.disconnect();
    if (previous?.timer) clearInterval(previous.timer);
    if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
    if (previous?.resizeHandler) window.removeEventListener("resize", previous.resizeHandler);
    if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
  }
  window[DISABLED_KEY] = false;
  let disposed = false;

  const dataUrlToObjectUrl = (dataUrl) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return "";
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return "";
    const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || "image/png";
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };

  const artUrls = [];
  const themes = Array.isArray(PACK.themes) ? PACK.themes
    .filter((theme) => theme && typeof theme.id === "string" && typeof theme.name === "string")
    .map((theme) => {
      const artUrl = dataUrlToObjectUrl(theme.artDataUrl);
      if (artUrl) artUrls.push(artUrl);
      return { ...theme, artUrl };
    }) : [];
  const systemDefaultTheme = {
    id: SYSTEM_DEFAULT_ID,
    name: "系统默认 · 原生 Codex",
    brandSubtitle: "RESTORE NATIVE CODEX",
    source: "system",
    index: 0,
    layoutVariant: "system-default",
    colors: {
      background: "#151515", panel: "#202020", panelAlt: "#2a2a2a",
      accent: "#f2f2f2", accentAlt: "#ffffff", secondary: "#a5a5a5",
      highlight: "#454545", text: "#f5f5f5", muted: "#a8a8a8",
      line: "rgba(255, 255, 255, .18)",
    },
  };
  const themeById = new Map([
    [SYSTEM_DEFAULT_ID, systemDefaultTheme],
    ...themes.map((theme) => [theme.id, theme]),
  ]);
  const builtinThemes = themes.filter((theme) => theme.source === "builtin");
  const customThemes = themes.filter((theme) => theme.source === "custom");
  if (BUILTIN_COUNT < 1 || builtinThemes.length !== BUILTIN_COUNT) {
    throw new Error("Codex SkinKit did not receive a valid built-in theme registry.");
  }

  const safeStorageGet = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const safeStorageSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Renderer storage may be restricted. */ }
  };
  const currentCustomId = typeof PACK.customThemeId === "string" ? PACK.customThemeId : null;
  const storedId = safeStorageGet(STORAGE_KEY);
  const seenCustomId = safeStorageGet(CUSTOM_SEEN_KEY);
  let pendingStoredId = storedId && !themeById.has(storedId) ? storedId : null;
  let activeTheme = currentCustomId && currentCustomId !== seenCustomId && themeById.has(currentCustomId)
    ? themeById.get(currentCustomId)
    : themeById.get(storedId) || builtinThemes[0];
  if (currentCustomId && currentCustomId !== seenCustomId) {
    pendingStoredId = null;
    safeStorageSet(CUSTOM_SEEN_KEY, currentCustomId);
    safeStorageSet(STORAGE_KEY, activeTheme.id);
  } else if (!pendingStoredId) {
    safeStorageSet(STORAGE_KEY, activeTheme.id);
  }

  const cssString = (value) => JSON.stringify(String(value ?? ""));
  const motionProfileForTheme = (theme) => {
    if (Number.isInteger(theme?.index) && theme.index > 0) return String((theme.index - 1) % 6);
    const id = String(theme?.id || "custom-theme");
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) hash = ((hash * 31) + id.charCodeAt(index)) >>> 0;
    return String(hash % 6);
  };
  const effectProfileForTheme = (theme) => {
    if (EFFECT_TYPES.has(theme?.effect)) return theme.effect;
    const accent = String(theme?.colors?.accent || "#7cff46");
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(accent);
    if (!match) return "portal-sparks";
    const [red, green, blue] = match.slice(1).map((value) => parseInt(value, 16) / 255);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    const saturation = max === 0 ? 0 : delta / max;
    let hue = 0;
    if (delta) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
      else hue = 60 * (((red - green) / delta) + 4);
    }
    if (hue < 0) hue += 360;
    if (saturation < .20) return "portal-sparks";
    if (hue < 60 || hue >= 345) return "sakura-petals";
    if (hue < 180) return "portal-sparks";
    if (hue < 250) return "orbital-scan";
    return "aurora-ribbons";
  };
  const DEFAULT_ACTIONS = [
    { icon: "</>", title: "探索并理解代码", hint: "洞察逻辑，梳理关键结构", prompt: "请探索并解释当前项目的代码结构、关键模块与运行方式。" },
    { icon: "✦", title: "构建新功能", hint: "把想法变成可运行功能", prompt: "请基于当前项目构建一个实用的新功能，并完成必要验证。" },
    { icon: "✓", title: "审查代码", hint: "发现风险并提出改进", prompt: "请审查当前项目代码，找出问题、风险和可执行的改进建议。" },
    { icon: "⚔", title: "修复问题", hint: "定位根因，修复并验证", prompt: "请诊断当前项目存在的问题，修复根因并完成验证。" },
  ];
  const NARUTO_ACTIONS = [
    { icon: "</>", title: "探索代码之道", hint: "洞察逻辑，发现代码奥义", prompt: "请探索当前项目，梳理代码结构、核心逻辑与关键依赖。" },
    { icon: "✦", title: "构建忍者应用", hint: "结印成术，构建强大应用", prompt: "请基于当前项目构建一个实用的新功能，并完成必要验证。" },
    { icon: "✓", title: "审查代码之术", hint: "洞察破绽，提升代码质量", prompt: "请审查当前项目代码，找出缺陷、风险和可执行的改进建议。" },
    { icon: "⚔", title: "修复问题之道", hint: "定位症结，修复 Bug", prompt: "请诊断当前项目的问题，修复根因并完成验证。" },
  ];
  const MECHA_ACTIONS = [
    { icon: "01", title: "创建作战任务", hint: "CREATE MISSION", prompt: "请把当前目标整理为一项可执行的开发任务，明确范围、步骤、风险与验收条件。" },
    { icon: "02", title: "调用智能助手", hint: "AI CO-PILOT", prompt: "请分析当前项目和目标，给出最有效的实现方案并协助完成。" },
    { icon: "03", title: "管理项目舰队", hint: "PROJECT FLEET", prompt: "请梳理当前项目结构、依赖、任务状态与下一步优先级。" },
    { icon: "04", title: "启动自动化引擎", hint: "AUTOMATION CORE", prompt: "请识别当前流程中适合自动化的环节，完成实现并验证运行结果。" },
  ];
  const rgbTriplet = (value, fallback) => {
    const match = /^#([0-9a-f]{6})$/i.exec(value || "");
    if (!match) return fallback;
    const number = Number.parseInt(match[1], 16);
    return `${number >> 16}, ${(number >> 8) & 255}, ${number & 255}`;
  };

  const hexToRgb = (value, fallback = [124, 255, 70]) => {
    const match = /^#([0-9a-f]{6})$/i.exec(value || "");
    if (!match) return fallback;
    const number = Number.parseInt(match[1], 16);
    return [number >> 16, (number >> 8) & 255, number & 255];
  };
  const rgbToHex = (red, green, blue) => `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
  const mixHex = (from, to, amount) => {
    const first = hexToRgb(from);
    const second = hexToRgb(to);
    const ratio = Math.max(0, Math.min(1, amount));
    return rgbToHex(...first.map((value, index) => value + (second[index] - value) * ratio));
  };
  const rgbaHex = (value, alpha) => {
    const [red, green, blue] = hexToRgb(value);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  };
  const colorLuminance = ([red, green, blue]) => (red * .2126 + green * .7152 + blue * .0722) / 255;
  const colorSaturation = ([red, green, blue]) => {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    return max === 0 ? 0 : (max - min) / max;
  };
  const colorDistance = (first, second) => Math.sqrt(first.reduce((sum, value, index) =>
    sum + (value - second[index]) ** 2, 0));
  const readableAccent = (value) => {
    const rgb = hexToRgb(value);
    const luminance = colorLuminance(rgb);
    if (luminance < .34) return mixHex(value, "#ffffff", .34);
    if (luminance > .86) return mixHex(value, "#101820", .16);
    return value;
  };
  const completeColors = ({ accent, secondary, panel, text, background }) => {
    const safeAccent = readableAccent(accent);
    const safeSecondary = readableAccent(secondary);
    const safePanel = /^#[0-9a-f]{6}$/i.test(panel || "") ? panel : "#101820";
    const safeText = /^#[0-9a-f]{6}$/i.test(text || "") ? text : "#f5fbff";
    const safeBackground = /^#[0-9a-f]{6}$/i.test(background || "")
      ? background : mixHex(safePanel, "#020407", .55);
    return {
      background: safeBackground,
      panel: safePanel,
      panelAlt: mixHex(safePanel, "#ffffff", .10),
      accent: safeAccent,
      accentAlt: mixHex(safeAccent, "#ffffff", .24),
      secondary: safeSecondary,
      highlight: mixHex(safeSecondary, safeAccent, .38),
      text: safeText,
      muted: mixHex(safeText, safePanel, .54),
      line: rgbaHex(safeAccent, .30),
    };
  };

  const extractPalette = (sourceCanvas) => {
    const sample = document.createElement("canvas");
    sample.width = 48;
    sample.height = 48;
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(sourceCanvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    const bins = new Map();
    let totals = [0, 0, 0];
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 180) continue;
      const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
      totals = totals.map((value, channel) => value + rgb[channel]);
      count += 1;
      const quantized = rgb.map((value) => Math.min(255, Math.round(value / 32) * 32));
      const key = quantized.join(",");
      const entry = bins.get(key) || { rgb: quantized, count: 0 };
      entry.count += 1;
      bins.set(key, entry);
    }
    if (!count) throw new Error("无法从图片中读取有效颜色。");
    const average = totals.map((value) => value / count);
    const candidates = [...bins.values()]
      .filter(({ rgb }) => colorLuminance(rgb) > .10 && colorLuminance(rgb) < .92)
      .sort((first, second) => {
        const firstScore = first.count * (.35 + colorSaturation(first.rgb) * 1.65);
        const secondScore = second.count * (.35 + colorSaturation(second.rgb) * 1.65);
        return secondScore - firstScore;
      });
    const primary = candidates[0]?.rgb || average;
    const secondary = candidates.slice(1, 20)
      .sort((first, second) => colorDistance(second.rgb, primary) - colorDistance(first.rgb, primary))[0]?.rgb
      || [...primary].reverse();
    const averageHex = rgbToHex(...average);
    const panel = mixHex(averageHex, "#070b10", .68);
    return completeColors({
      accent: rgbToHex(...primary),
      secondary: rgbToHex(...secondary),
      panel,
      background: mixHex(panel, "#010204", .52),
      text: "#f5fbff",
    });
  };

  const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败。")), type, quality);
  });
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
  const decodeImageFile = async (file) => {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch { /* Fall through to the image element decoder. */ }
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("图片格式无法解码。"));
      image.src = objectUrl;
    }).catch((error) => {
      URL.revokeObjectURL(objectUrl);
      throw error;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  };
  const prepareUploadedImage = async (file) => {
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!file || !allowedTypes.has(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
    if (file.size < 1 || file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("图片必须小于 50 MB。");
    const decoded = await decodeImageFile(file);
    try {
      if (decoded.width < 320 || decoded.height < 180) throw new Error("图片至少需要 320×180 像素。");
      const scale = Math.min(1, 1600 / decoded.width, 1000 / decoded.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      const colors = extractPalette(canvas);
      let blob = await canvasToBlob(canvas, "image/webp", .86);
      if (blob.size > MAX_STORED_IMAGE_BYTES) blob = await canvasToBlob(canvas, "image/webp", .68);
      if (blob.size > MAX_STORED_IMAGE_BYTES) throw new Error("压缩后图片仍超过 5 MB，请选择尺寸更小的素材。");
      const artDataUrl = await blobToDataUrl(blob);
      return {
        artDataUrl,
        colors,
        width: canvas.width,
        height: canvas.height,
        bytes: blob.size,
      };
    } finally {
      decoded.close();
    }
  };

  let uploadDbPromise = null;
  const openUploadDatabase = () => {
    if (!uploadDbPromise) uploadDbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前 Codex 渲染器不支持本地主题数据库。"));
        return;
      }
      const request = indexedDB.open(UPLOAD_DB_NAME, UPLOAD_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(UPLOAD_DB_STORE)) {
          database.createObjectStore(UPLOAD_DB_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("本地主题数据库打开失败。"));
    });
    return uploadDbPromise;
  };
  const uploadDbRequest = async (mode, operation) => {
    const database = await openUploadDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(UPLOAD_DB_STORE, mode);
      const store = transaction.objectStore(UPLOAD_DB_STORE);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("本地主题数据库操作失败。"));
      transaction.onabort = () => reject(transaction.error || new Error("本地主题数据库事务失败。"));
    });
  };
  const loadUploadedThemeRecords = () => uploadDbRequest("readonly", (store) => store.getAll());
  const saveUploadedThemeRecord = (record) => uploadDbRequest("readwrite", (store) => store.put(record));
  const deleteUploadedThemeRecord = (id) => uploadDbRequest("readwrite", (store) => store.delete(id));

  const normalizeUploadedRecord = (record) => {
    if (!record || record.schemaVersion !== 1 || !/^custom-upload-[a-z0-9-]{1,64}$/i.test(record.id || "")) return null;
    if (typeof record.artDataUrl !== "string" ||
        !/^data:image\/(?:webp|jpeg|png);base64,/i.test(record.artDataUrl) ||
        record.artDataUrl.length > MAX_STORED_IMAGE_BYTES * 1.5) return null;
    const colors = record.colors || {};
    const requiredColors = ["background", "panel", "panelAlt", "accent", "accentAlt", "secondary", "highlight", "text", "muted"];
    if (requiredColors.some((key) => !/^#[0-9a-f]{6}$/i.test(colors[key] || ""))) return null;
    return {
      schemaVersion: 1,
      id: record.id,
      name: String(record.name || "我的 Codex 主题").trim().slice(0, 80) || "我的 Codex 主题",
      brandSubtitle: "MY CODEX THEME",
      tagline: "由本机素材自动生成，可继续调整颜色和布局。",
      projectPrefix: "选择项目 · ",
      projectLabel: "◉  选择项目",
      statusText: "CUSTOM THEME ONLINE",
      quote: "MAKE IT YOURS",
      layoutVariant: LAYOUT_IDS.has(record.layoutVariant) ? record.layoutVariant : "cinematic-banner",
      source: "custom",
      uploaded: true,
      artDataUrl: record.artDataUrl,
      colors: { ...colors, line: typeof colors.line === "string" ? colors.line : rgbaHex(colors.accent, .30) },
      createdAt: Number(record.createdAt) || Date.now(),
      updatedAt: Number(record.updatedAt) || Date.now(),
    };
  };

  const applyTheme = (root, theme) => {
    const colors = theme.colors || {};
    const variables = {
      "--ds-bg": colors.background,
      "--ds-panel": colors.panel,
      "--ds-panel-2": colors.panelAlt,
      "--ds-green": colors.accent,
      "--ds-lime": colors.accentAlt,
      "--ds-cyan": colors.secondary,
      "--ds-purple": colors.highlight,
      "--ds-text": colors.text,
      "--ds-muted": colors.muted,
      "--ds-line": colors.line,
      "--ds-accent-rgb": rgbTriplet(colors.accent, "124, 255, 70"),
      "--ds-accent-alt-rgb": rgbTriplet(colors.accentAlt, "184, 255, 61"),
      "--ds-secondary-rgb": rgbTriplet(colors.secondary, "54, 215, 232"),
      "--ds-highlight-rgb": rgbTriplet(colors.highlight, "100, 42, 140"),
      "--ds-text-rgb": rgbTriplet(colors.text, "233, 255, 241"),
    };
    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === "string" && value) root.style.setProperty(name, value);
    }
    root.style.setProperty("--dream-skin-art", `url("${theme.artUrl}")`);
    root.style.setProperty("--dream-skin-name", cssString(theme.name || "Codex Dream Skin"));
    root.style.setProperty("--dream-skin-tagline", cssString(theme.tagline || "Make something wonderful."));
    root.style.setProperty("--dream-skin-project-prefix", cssString(theme.projectPrefix || "选择项目 · "));
    root.style.setProperty("--dream-skin-project-label", cssString(theme.projectLabel || "◉  选择项目"));
    root.dataset.dreamSkinTheme = theme.id;
    root.dataset.dreamSkinLayout = theme.layoutVariant || "cinematic-banner";
    root.dataset.dreamSkinMotion = motionProfileForTheme(theme);
    root.dataset.dreamSkinEffect = effectProfileForTheme(theme);
  };

  const clearSkinSurface = () => {
    const root = document.documentElement;
    root?.classList.remove("codex-dream-skin");
    if (root) {
      delete root.dataset.dreamSkinTheme;
      delete root.dataset.dreamSkinLayout;
      delete root.dataset.dreamSkinMotion;
      delete root.dataset.dreamSkinEffect;
      for (const name of THEME_VARIABLES) root.style.removeProperty(name);
    }
    document.querySelectorAll(".dream-skin-home").forEach((node) => node.classList.remove("dream-skin-home"));
    document.querySelectorAll(".dream-skin-home-shell").forEach((node) => node.classList.remove("dream-skin-home-shell"));
    document.querySelectorAll(".dream-skin-hero-wallpaper").forEach((node) => node.remove());
    document.getElementById(CHROME_ID)?.remove();
  };

  const ensureHeroWallpaper = (home) => {
    const hero = home?.firstElementChild?.firstElementChild?.firstElementChild || null;
    for (const wallpaper of document.querySelectorAll(".dream-skin-hero-wallpaper")) {
      if (!hero || wallpaper.parentElement !== hero) wallpaper.remove();
    }
    if (!hero) return null;
    let wallpaper = [...hero.children].find((node) => node.classList?.contains("dream-skin-hero-wallpaper"));
    if (!wallpaper) {
      wallpaper = document.createElement("span");
      wallpaper.className = "dream-skin-hero-wallpaper";
      wallpaper.setAttribute("aria-hidden", "true");
      wallpaper.innerHTML = `
        <i class="dream-skin-hero-art"></i>
        <b class="dream-skin-hero-ambient"></b>
        <span class="dream-skin-hero-fx">
          <i class="dream-skin-fx-field"></i>
          <b class="dream-skin-fx-sweep"></b>
          <em class="dream-skin-fx-energy"></em>
        </span>`;
      hero.appendChild(wallpaper);
    }
    return wallpaper;
  };

  const updateChrome = () => {
    const chrome = document.getElementById(CHROME_ID);
    if (!chrome) return;
    chrome.querySelector(".dream-skin-brand b").textContent = activeTheme.name || "Codex Dream Skin";
    chrome.querySelector(".dream-skin-brand small").textContent = activeTheme.brandSubtitle || "CODEX DREAM SKIN";
    chrome.querySelector(".dream-skin-status span").textContent = activeTheme.statusText || "DREAM SKIN ONLINE";
    chrome.querySelector(".dream-skin-quote").textContent = activeTheme.quote || "MAKE SOMETHING WONDERFUL";
    chrome.querySelector(".dream-skin-hero-copy small").textContent = activeTheme.heroEyebrow || "";
    chrome.querySelector(".dream-skin-hero-copy h2 span").textContent = activeTheme.heroTitle || "";
    chrome.querySelector(".dream-skin-hero-copy h2 b").textContent = activeTheme.heroEmphasis || "";
    chrome.querySelector(".dream-skin-hero-copy p").textContent = activeTheme.heroDescription || "";
    const actions = DEFAULT_ACTIONS;
    chrome.querySelectorAll(".dream-skin-fallback-actions button").forEach((button, index) => {
      const action = actions[index] || DEFAULT_ACTIONS[index];
      button.querySelector("i").textContent = action.icon;
      button.querySelector("b").textContent = action.title;
      button.querySelector("small").textContent = action.hint;
      button.dataset.prompt = action.prompt;
      button.setAttribute("aria-label", `${action.title}：${action.hint}`);
    });
  };

  const insertActionPrompt = (prompt) => {
    const editor = document.querySelector('.composer-surface-chrome [contenteditable="true"]') ||
      document.querySelector('.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[role="textbox"][contenteditable="true"]');
    if (!editor || !prompt) return false;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, prompt); } catch { /* fall through */ }
    if (!inserted) {
      editor.textContent = prompt;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    }
    return true;
  };

  const updatePicker = () => {
    const picker = document.getElementById(PICKER_ID);
    if (!picker) return;
    const current = picker.querySelector(".dream-skin-theme-current");
    const count = picker.querySelector(".dream-skin-theme-position");
    if (current) current.textContent = activeTheme.source === "custom" ? "我的主题" : activeTheme.name;
    if (count) count.textContent = activeTheme.source === "system" ? "DEFAULT"
      : activeTheme.source === "custom" ? "CUSTOM"
        : `${String(activeTheme.index).padStart(2, "0")}/${BUILTIN_COUNT}`;
    const pickerColors = activeTheme.colors || systemDefaultTheme.colors;
    const pickerVariables = {
      "--ds-bg": pickerColors.background,
      "--ds-panel": pickerColors.panel,
      "--ds-panel-2": pickerColors.panelAlt,
      "--ds-green": pickerColors.accent,
      "--ds-lime": pickerColors.accentAlt,
      "--ds-cyan": pickerColors.secondary,
      "--ds-purple": pickerColors.highlight,
      "--ds-text": pickerColors.text,
      "--ds-muted": pickerColors.muted,
      "--ds-line": pickerColors.line,
      "--ds-accent-rgb": rgbTriplet(pickerColors.accent, "242, 242, 242"),
      "--ds-accent-alt-rgb": rgbTriplet(pickerColors.accentAlt, "255, 255, 255"),
      "--ds-secondary-rgb": rgbTriplet(pickerColors.secondary, "165, 165, 165"),
      "--ds-highlight-rgb": rgbTriplet(pickerColors.highlight, "69, 69, 69"),
      "--ds-text-rgb": rgbTriplet(pickerColors.text, "245, 245, 245"),
    };
    for (const [name, value] of Object.entries(pickerVariables)) picker.style.setProperty(name, value);
    picker.style.setProperty("--picker-accent", pickerColors.accent || "#f2f2f2");
    picker.classList.toggle("dream-skin-system-default", activeTheme.source === "system");
    picker.querySelectorAll("[data-dream-theme-id]").forEach((button) => {
      const selected = button.dataset.dreamThemeId === activeTheme.id;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  };

  const setActiveTheme = (themeId, persist = true) => {
    const next = themeById.get(themeId);
    if (!next) return false;
    activeTheme = next;
    if (persist) safeStorageSet(STORAGE_KEY, next.id);
    const root = document.documentElement;
    if (next.source === "system") clearSkinSurface();
    else if (root) {
      root.classList.add("codex-dream-skin");
      applyTheme(root, next);
    }
    updateChrome();
    updatePicker();
    const state = window[STATE_KEY];
    if (state) {
      state.themeId = next.id;
      state.themeName = next.name;
      state.layoutVariant = next.layoutVariant;
      state.motionProfile = next.source === "system" ? null : motionProfileForTheme(next);
      state.effectType = next.source === "system" ? null : effectProfileForTheme(next);
    }
    if (next.source !== "system") requestAnimationFrame(() => ensure());
    return true;
  };

  const closePicker = () => {
    const picker = document.getElementById(PICKER_ID);
    const panel = picker?.querySelector(".dream-skin-theme-panel");
    const trigger = picker?.querySelector(".dream-skin-theme-trigger");
    if (!panel || !trigger) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  const togglePicker = () => {
    const picker = document.getElementById(PICKER_ID);
    const panel = picker?.querySelector(".dream-skin-theme-panel");
    const trigger = picker?.querySelector(".dream-skin-theme-trigger");
    if (!panel || !trigger) return;
    panel.hidden = !panel.hidden;
    trigger.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) panel.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  };

  let uploadDraft = null;

  const setStudioStatus = (message, tone = "neutral") => {
    const status = document.querySelector(`#${PICKER_ID} .dream-skin-upload-status`);
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  };

  const createThemeCard = (theme) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dream-skin-theme-card";
    if (theme.source === "system") button.classList.add("dream-skin-system-card");
    button.dataset.dreamThemeId = theme.id;
    button.setAttribute("aria-pressed", "false");
    if (theme.artUrl) button.style.setProperty("--theme-preview", `url("${theme.artUrl}")`);
    button.style.setProperty("--theme-accent", theme.colors?.accent || "#7cff46");
    const preview = document.createElement("span");
    preview.className = "dream-skin-theme-preview";
    const badge = document.createElement("i");
    badge.textContent = theme.source === "system" ? "原生"
      : theme.source === "custom" ? "我的" : String(theme.index).padStart(2, "0");
    preview.appendChild(badge);
    const copy = document.createElement("span");
    copy.className = "dream-skin-theme-copy";
    const title = document.createElement("b");
    title.textContent = theme.name;
    const subtitle = document.createElement("small");
    subtitle.textContent = theme.source === "system" ? "清除皮肤，恢复 Codex 原生界面"
      : theme.source === "custom" ? "客户自定义素材" : theme.brandSubtitle;
    copy.append(title, subtitle);
    button.append(preview, copy);
    button.addEventListener("click", () => {
      setActiveTheme(theme.id, true);
      closePicker();
    });
    return button;
  };

  const renderCustomThemeCards = () => {
    const container = document.querySelector(`#${PICKER_ID} .dream-skin-custom-themes`);
    const list = container?.querySelector(".dream-skin-custom-list");
    const count = container?.querySelector(".dream-skin-custom-count");
    if (!container || !list || !count) return;
    list.replaceChildren();
    count.textContent = customThemes.length ? `${customThemes.length} 款` : "尚未创建";
    container.classList.toggle("is-empty", customThemes.length === 0);
    const ordered = [...customThemes].sort((first, second) =>
      Number(Boolean(second.uploaded)) - Number(Boolean(first.uploaded)) ||
      (Number(second.updatedAt) || 0) - (Number(first.updatedAt) || 0));
    for (const theme of ordered) {
      const shell = document.createElement("div");
      shell.className = "dream-skin-custom-card-shell";
      shell.append(createThemeCard(theme));
      if (theme.uploaded) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "dream-skin-custom-remove";
        remove.setAttribute("aria-label", `删除自定义主题 ${theme.name}`);
        remove.title = "删除这个自定义主题";
        remove.textContent = "×";
        remove.addEventListener("click", async () => {
          if (!window.confirm(`删除“${theme.name}”？内置主题不会受影响。`)) return;
          try {
            await deleteUploadedThemeRecord(theme.id);
            if (activeTheme.id === theme.id) setActiveTheme(builtinThemes[0].id, true);
            themeById.delete(theme.id);
            const index = customThemes.findIndex((candidate) => candidate.id === theme.id);
            if (index >= 0) customThemes.splice(index, 1);
            if (theme.artUrl) URL.revokeObjectURL(theme.artUrl);
            renderCustomThemeCards();
            updatePicker();
            const state = window[STATE_KEY];
            if (state) state.customThemeCount = customThemes.length;
            setStudioStatus(`已删除“${theme.name}”。`, "success");
          } catch (error) {
            setStudioStatus(error.message || "删除主题失败。", "error");
          }
        });
        shell.append(remove);
      }
      list.append(shell);
    }
  };

  const registerUploadedTheme = (record) => {
    const normalized = normalizeUploadedRecord(record);
    if (!normalized) return null;
    const previousTheme = themeById.get(normalized.id);
    if (previousTheme?.source === "builtin" || previousTheme?.source === "system") return null;
    if (previousTheme) {
      const previousIndex = customThemes.findIndex((theme) => theme.id === normalized.id);
      if (previousIndex >= 0) customThemes.splice(previousIndex, 1);
      if (previousTheme.artUrl) URL.revokeObjectURL(previousTheme.artUrl);
    }
    const artUrl = dataUrlToObjectUrl(normalized.artDataUrl);
    if (!artUrl) return null;
    artUrls.push(artUrl);
    const theme = { ...normalized, artUrl };
    themeById.set(theme.id, theme);
    customThemes.push(theme);
    renderCustomThemeCards();
    const state = window[STATE_KEY];
    if (state) state.customThemeCount = customThemes.length;
    return theme;
  };

  const showUploadDraft = (draft, fileName) => {
    uploadDraft = draft;
    const picker = document.getElementById(PICKER_ID);
    const editor = picker?.querySelector(".dream-skin-theme-editor");
    if (!editor) return;
    const baseName = String(fileName || "我的主题").replace(/\.[^.]+$/, "").trim().slice(0, 80);
    editor.querySelector('[name="theme-name"]').value = baseName || "我的主题";
    editor.querySelector('[name="theme-layout"]').value = "cinematic-banner";
    for (const input of editor.querySelectorAll("[data-theme-color]")) {
      input.value = draft.colors[input.dataset.themeColor];
    }
    const preview = editor.querySelector(".dream-skin-editor-preview");
    preview.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,.18), transparent), url("${draft.artDataUrl}")`;
    preview.style.setProperty("--draft-accent", draft.colors.accent);
    editor.hidden = false;
    setStudioStatus(`已压缩为 ${draft.width}×${draft.height} · ${Math.max(1, Math.round(draft.bytes / 1024))} KB，并自动提取配色。`, "success");
  };

  const wireThemeStudio = (picker) => {
    const input = picker.querySelector(".dream-skin-upload-input");
    const uploadButton = picker.querySelector(".dream-skin-upload-button");
    const editor = picker.querySelector(".dream-skin-theme-editor");
    uploadButton.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      uploadButton.disabled = true;
      editor.hidden = true;
      setStudioStatus("正在压缩图片并分析主色……", "busy");
      try {
        const draft = await prepareUploadedImage(file);
        showUploadDraft(draft, file.name);
      } catch (error) {
        uploadDraft = null;
        setStudioStatus(error.message || "图片处理失败。", "error");
      } finally {
        uploadButton.disabled = false;
        input.value = "";
      }
    });
    editor.querySelectorAll("[data-theme-color]").forEach((colorInput) => {
      colorInput.addEventListener("input", () => {
        editor.querySelector(".dream-skin-editor-preview")
          .style.setProperty("--draft-accent", editor.querySelector('[data-theme-color="accent"]').value);
      });
    });
    editor.querySelector(".dream-skin-editor-cancel").addEventListener("click", () => {
      uploadDraft = null;
      editor.hidden = true;
      setStudioStatus("未保存这次上传，已有主题没有变化。", "neutral");
    });
    editor.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!uploadDraft) return;
      const uploadedCount = customThemes.filter((theme) => theme.uploaded).length;
      if (uploadedCount >= MAX_UPLOADED_THEMES) {
        setStudioStatus(`最多保存 ${MAX_UPLOADED_THEMES} 款上传主题，请先删除一款。`, "error");
        return;
      }
      const name = editor.querySelector('[name="theme-name"]').value.trim().slice(0, 80) || "我的主题";
      const layoutVariant = editor.querySelector('[name="theme-layout"]').value;
      const accent = editor.querySelector('[data-theme-color="accent"]').value;
      const secondary = editor.querySelector('[data-theme-color="secondary"]').value;
      const panel = editor.querySelector('[data-theme-color="panel"]').value;
      const text = editor.querySelector('[data-theme-color="text"]').value;
      const colors = completeColors({
        accent,
        secondary,
        panel,
        text,
        background: mixHex(panel, "#010204", .52),
      });
      const now = Date.now();
      const record = {
        schemaVersion: 1,
        id: `custom-upload-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        layoutVariant: LAYOUT_IDS.has(layoutVariant) ? layoutVariant : "cinematic-banner",
        colors,
        artDataUrl: uploadDraft.artDataUrl,
        createdAt: now,
        updatedAt: now,
      };
      const submit = editor.querySelector('button[type="submit"]');
      submit.disabled = true;
      setStudioStatus("正在保存到本机主题库……", "busy");
      try {
        await saveUploadedThemeRecord(record);
        const theme = registerUploadedTheme(record);
        if (!theme) throw new Error("保存后的主题数据没有通过安全校验。");
        setActiveTheme(theme.id, true);
        uploadDraft = null;
        editor.hidden = true;
        setStudioStatus(`“${theme.name}”已保存并立即应用，重启后仍可选择。`, "success");
      } catch (error) {
        setStudioStatus(error.message || "保存自定义主题失败。", "error");
      } finally {
        submit.disabled = false;
      }
    });
  };

  const ensurePicker = () => {
    let picker = document.getElementById(PICKER_ID);
    if (picker) return picker;
    picker = document.createElement("div");
    picker.id = PICKER_ID;
    picker.innerHTML = `
      <button class="dream-skin-theme-trigger" type="button" aria-label="选择 Codex 主题" aria-expanded="false">
        <span class="dream-skin-theme-trigger-icon">◈</span>
        <span><small>主题</small><b class="dream-skin-theme-current"></b></span>
        <em class="dream-skin-theme-position"></em>
      </button>
      <section class="dream-skin-theme-panel" role="dialog" aria-label="Codex 主题中心" hidden>
        <header><span><b>Codex 主题中心</b><small>上传素材自动取色 · 系统默认 + ${BUILTIN_COUNT} 款内置主题</small></span><button type="button" aria-label="关闭主题中心">×</button></header>
        <div class="dream-skin-theme-scroll">
          <div class="dream-skin-default-theme"><div class="dream-skin-default-heading"><b>永久恢复入口</b><span>随时回到原生 Codex</span></div></div>
          <section class="dream-skin-theme-studio" aria-label="制作自定义主题">
            <div class="dream-skin-studio-intro"><span><b>制作我的主题</b><small>PNG / JPEG / WebP · 本机压缩与自动取色</small></span><button class="dream-skin-upload-button" type="button">＋ 上传图片</button></div>
            <input class="dream-skin-upload-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
            <p class="dream-skin-upload-status" role="status" data-tone="neutral">图片只保存在这台电脑，不会覆盖内置主题。</p>
            <form class="dream-skin-theme-editor" hidden>
              <div class="dream-skin-editor-preview"><span>实时预览</span></div>
              <div class="dream-skin-editor-fields">
                <label><span>主题名称</span><input name="theme-name" type="text" maxlength="80" required></label>
                <label><span>模块布局</span><select name="theme-layout">${LAYOUT_OPTIONS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>
                <div class="dream-skin-color-fields">
                  <label><span>强调</span><input data-theme-color="accent" type="color"></label>
                  <label><span>辅助</span><input data-theme-color="secondary" type="color"></label>
                  <label><span>面板</span><input data-theme-color="panel" type="color"></label>
                  <label><span>文字</span><input data-theme-color="text" type="color"></label>
                </div>
                <div class="dream-skin-editor-actions"><button class="dream-skin-editor-cancel" type="button">取消</button><button type="submit">保存并应用</button></div>
              </div>
            </form>
          </section>
          <div class="dream-skin-custom-themes is-empty"><div class="dream-skin-custom-heading"><b>我的主题</b><span class="dream-skin-custom-count">尚未创建</span></div><div class="dream-skin-custom-list"></div></div>
          <div class="dream-skin-builtin-heading"><b>内置主题</b><span>第 2 款 · 火影忍者</span></div>
          <div class="dream-skin-theme-grid"></div>
        </div>
      </section>`;
    picker.querySelector(".dream-skin-default-theme").append(createThemeCard(systemDefaultTheme));
    renderCustomThemeCards();
    picker.querySelector(".dream-skin-theme-grid").append(...builtinThemes.map(createThemeCard));
    picker.querySelector(".dream-skin-theme-trigger").addEventListener("click", togglePicker);
    picker.querySelector(".dream-skin-theme-panel header button").addEventListener("click", closePicker);
    wireThemeStudio(picker);
    document.body.appendChild(picker);
    renderCustomThemeCards();
    updatePicker();
    return picker;
  };

  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = cssText;
    existingStyle.dataset.dreamSkinVersion = VERSION;
  }

  const ensure = () => {
    if (window[DISABLED_KEY]) return;
    const root = document.documentElement;
    if (!root) return;

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.dreamSkinVersion !== VERSION) {
      style.textContent = cssText;
      style.dataset.dreamSkinVersion = VERSION;
    }

    const shellMain = document.querySelector("main.main-surface") || document.querySelector("main");
    if (activeTheme.source === "system") {
      clearSkinSurface();
      if (!shellMain || !document.body) return;
      const shellBox = shellMain.getBoundingClientRect();
      const picker = ensurePicker();
      picker.style.top = `${Math.max(7, Math.round(shellBox.top + 7))}px`;
      picker.style.right = `${Math.max(84, Math.round(innerWidth - shellBox.right + 84))}px`;
      updatePicker();
      return;
    }

    root.classList.add("codex-dream-skin");
    applyTheme(root, activeTheme);
    const homeIndicator = document.querySelector('[data-testid="home-icon"]');
    const home = homeIndicator?.closest('[role="main"]') ||
      [...document.querySelectorAll('[role="main"]')].find((candidate) =>
        candidate.querySelector('[data-feature="game-source"]') &&
        candidate.querySelector('.group\\/home-suggestions')) || null;
    for (const candidate of document.querySelectorAll('[role="main"].dream-skin-home')) {
      if (candidate !== home) candidate.classList.remove("dream-skin-home");
    }
    if (home) home.classList.add("dream-skin-home");
    ensureHeroWallpaper(home);

    if (!shellMain || !document.body) return;
    shellMain.classList.toggle("dream-skin-home-shell", Boolean(home));
    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.innerHTML = `
        <div class="dream-skin-brand">
          <span class="dream-skin-portal-mark">◉</span>
          <span><b></b><small></small></span>
        </div>
        <div class="dream-skin-status"><i></i><span></span></div>
        <div class="dream-skin-hero-copy"><small></small><h2><span></span><b></b></h2><p></p></div>
        <div class="dream-skin-fallback-actions" aria-label="Codex 快捷任务">
          <button type="button"><i></i><span><b></b><small></small></span></button>
          <button type="button"><i></i><span><b></b><small></small></span></button>
          <button type="button"><i></i><span><b></b><small></small></span></button>
          <button type="button"><i></i><span><b></b><small></small></span></button>
        </div>
        <div class="dream-skin-viewport-fx" aria-hidden="true">
          <i class="dream-skin-fx-field"></i>
          <b class="dream-skin-fx-sweep"></b>
          <em class="dream-skin-fx-energy"></em>
        </div>
        <div class="dream-skin-quote"></div>
        <div class="dream-skin-particles"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="dream-skin-orbit"></div>`;
      chrome.querySelector(".dream-skin-fallback-actions").addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (button) insertActionPrompt(button.dataset.prompt || "");
      });
      document.body.appendChild(chrome);
    }
    updateChrome();
    const shellBox = shellMain.getBoundingClientRect();
    chrome.style.left = `${Math.round(shellBox.left)}px`;
    chrome.style.top = `${Math.round(shellBox.top)}px`;
    chrome.style.width = `${Math.round(shellBox.width)}px`;
    chrome.style.height = `${Math.round(shellBox.height)}px`;
    chrome.classList.toggle("dream-skin-home-shell", Boolean(home));
    const nativeSuggestions = home?.querySelector('.group\\/home-suggestions');
    const nativeSuggestionCount = nativeSuggestions?.querySelectorAll("button").length ?? 0;
    chrome.classList.toggle("dream-skin-fallback-actions-visible", Boolean(home && nativeSuggestionCount < 2));

    const picker = ensurePicker();
    picker.style.top = `${Math.max(7, Math.round(shellBox.top + 7))}px`;
    picker.style.right = `${Math.max(84, Math.round(innerWidth - shellBox.right + 84))}px`;
  };

  const documentPointerHandler = (event) => {
    const picker = document.getElementById(PICKER_ID);
    if (picker && !picker.contains(event.target)) closePicker();
  };
  const documentKeyHandler = (event) => {
    if (event.key === "Escape") closePicker();
  };
  document.addEventListener("pointerdown", documentPointerHandler, true);
  document.addEventListener("keydown", documentKeyHandler, true);

  const cleanup = () => {
    disposed = true;
    window[DISABLED_KEY] = true;
    document.removeEventListener("pointerdown", documentPointerHandler, true);
    document.removeEventListener("keydown", documentKeyHandler, true);
    document.documentElement?.classList.remove("codex-dream-skin");
    delete document.documentElement?.dataset.dreamSkinTheme;
    delete document.documentElement?.dataset.dreamSkinLayout;
    delete document.documentElement?.dataset.dreamSkinMotion;
    delete document.documentElement?.dataset.dreamSkinEffect;
    for (const name of THEME_VARIABLES) document.documentElement?.style.removeProperty(name);
    document.querySelectorAll(".dream-skin-home").forEach((node) => node.classList.remove("dream-skin-home"));
    document.querySelectorAll(".dream-skin-home-shell").forEach((node) => node.classList.remove("dream-skin-home-shell"));
    document.querySelectorAll(".dream-skin-hero-wallpaper").forEach((node) => node.remove());
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    document.getElementById(PICKER_ID)?.remove();
    const state = window[STATE_KEY];
    state?.observer?.disconnect();
    if (state?.timer) clearInterval(state.timer);
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.resizeHandler) window.removeEventListener("resize", state.resizeHandler);
    for (const artUrl of artUrls) URL.revokeObjectURL(artUrl);
    delete window[STATE_KEY];
    return true;
  };

  const scheduler = { timeout: null };
  const scheduleEnsure = () => {
    if (scheduler.timeout) clearTimeout(scheduler.timeout);
    scheduler.timeout = setTimeout(() => {
      scheduler.timeout = null;
      ensure();
    }, 180);
  };
  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(ensure, 5000);
  const resizeHandler = scheduleEnsure;
  window.addEventListener("resize", resizeHandler, { passive: true });
  const restoreUploadedThemes = async () => {
    try {
      const records = await loadUploadedThemeRecords();
      if (disposed) return;
      const validRecords = records
        .map(normalizeUploadedRecord)
        .filter(Boolean)
        .sort((first, second) => second.updatedAt - first.updatedAt)
        .slice(0, MAX_UPLOADED_THEMES);
      for (const record of validRecords) registerUploadedTheme(record);
      if (disposed) return;
      const requested = pendingStoredId;
      pendingStoredId = null;
      if (requested && themeById.has(requested)) setActiveTheme(requested, true);
      else if (requested) safeStorageSet(STORAGE_KEY, activeTheme.id);
      const state = window[STATE_KEY];
      if (state) {
        state.uploadsReady = true;
        state.customThemeCount = customThemes.length;
      }
      if (validRecords.length) {
        setStudioStatus(`已载入 ${validRecords.length} 款本机上传主题。`, "success");
      }
    } catch (error) {
      if (disposed) return;
      pendingStoredId = null;
      safeStorageSet(STORAGE_KEY, activeTheme.id);
      const state = window[STATE_KEY];
      if (state) {
        state.uploadsReady = false;
        state.uploadStorageError = error.message || "IndexedDB unavailable";
      }
      setStudioStatus("本机主题库暂不可用；内置主题仍可正常切换。", "error");
    }
  };
  window[STATE_KEY] = {
    ensure,
    cleanup,
    setActiveTheme,
    observer,
    timer,
    scheduler,
    resizeHandler,
    version: VERSION,
    themeId: activeTheme.id,
    themeName: activeTheme.name,
    layoutVariant: activeTheme.layoutVariant,
    motionProfile: activeTheme.source === "system" ? null : motionProfileForTheme(activeTheme),
    effectType: activeTheme.source === "system" ? null : effectProfileForTheme(activeTheme),
    effectTypes: builtinThemes.map((theme) => effectProfileForTheme(theme)),
    builtinThemeCount: BUILTIN_COUNT,
    themeIds: builtinThemes.map((theme) => theme.id),
    customThemeCount: customThemes.length,
    uploadEnabled: true,
    uploadsReady: false,
    uploadStorage: "indexedDB",
  };
  ensure();
  restoreUploadedThemes();
  return {
    installed: true,
    version: VERSION,
    themeId: activeTheme.id,
    layoutVariant: activeTheme.layoutVariant,
    motionProfile: activeTheme.source === "system" ? null : motionProfileForTheme(activeTheme),
    effectType: activeTheme.source === "system" ? null : effectProfileForTheme(activeTheme),
    builtinThemeCount: BUILTIN_COUNT,
    secondThemeId: builtinThemes[1].id,
    uploadEnabled: true,
  };
})(__DREAM_SKIN_CSS_JSON__, __DREAM_SKIN_THEME_PACK_JSON__)
