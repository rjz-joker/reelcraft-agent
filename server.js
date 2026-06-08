import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const publicRoot = process.env.NODE_ENV === "production" ? join(root, "dist") : root;
const seedanceTasks = new Map();
const starterTasks = new Map();
const generatedDir = join(root, "generated");
const projectsFile = join(generatedDir, "projects.json");
const fontCandidates = [
  process.env.REELCRAFT_VIDEO_FONT,
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
].filter(Boolean);
let videoFont = fontCandidates.at(-1);

for (const fontPath of fontCandidates) {
  try {
    await access(fontPath);
    videoFont = fontPath;
    break;
  } catch {
    // Try the next font path.
  }
}

async function loadLocalEnv() {
  try {
    const file = await readFile(join(root, ".env.local"), "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadLocalEnv();
let projectRecords = await loadProjectRecords();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": contentTypes[".json"] });
  response.end(JSON.stringify(body));
}

async function loadProjectRecords() {
  try {
    return JSON.parse(await readFile(projectsFile, "utf8"));
  } catch {
    return [];
  }
}

async function saveProjectRecords() {
  await mkdir(generatedDir, { recursive: true });
  await writeFile(projectsFile, JSON.stringify(projectRecords.slice(0, 50), null, 2));
}

function getPostingPackage({ product, concept, engine, scheduledAt = "" }) {
  const title = cleanOverlayText(product?.title || "Product video", 80);
  const productType = product?.productType || "Product";
  const sellingPoints = product?.analysis?.sellingPoints || [];
  const primaryBenefit = sellingPoints[0] || "Everyday upgrade";
  const secondaryBenefit = sellingPoints[1] || productType;
  const baseTags = [
    productType,
    product?.vendor,
    primaryBenefit,
    "ProductFinds",
    "TikTokMadeMeBuyIt",
    "ShopTok",
    "EverydayEssentials"
  ].filter(Boolean);
  const hashtags = [...new Set(baseTags)]
    .map((tag) => `#${String(tag).replace(/[^a-zA-Z0-9]/g, "")}`)
    .filter((tag) => tag.length > 1)
    .slice(0, 8);
  const caption = [
    `${title} in motion.`,
    `${primaryBenefit}${secondaryBenefit ? `, ${secondaryBenefit.toLowerCase()}` : ""}.`,
    "Save this for your next upgrade.",
    hashtags.join(" ")
  ].join(" ");
  return {
    platform: "TikTok",
    status: scheduledAt ? "scheduled" : "draft",
    scheduledAt,
    caption: cleanOverlayText(caption, 2200),
    headline: cleanOverlayText(concept?.title || "Product spotlight", 80),
    hashtags,
    privacy: "public",
    allowComments: true,
    allowDuet: true,
    allowStitch: true,
    disclosure: engine === "Seedance 2.0" ? "AI-generated product clip" : "Animated product listing video",
    checklist: [
      "Confirm product claims match the storefront.",
      "Add a native TikTok sound manually before publishing if needed.",
      "Engage with comments during the first hour after posting."
    ]
  };
}

async function addProjectRecord({ product, concept, engine, videoUrl, duration, taskId }) {
  if (projectRecords.some((project) => project.taskId === taskId)) {
    return projectRecords.find((project) => project.taskId === taskId);
  }
  const project = {
    id: getTaskId("project"),
    taskId,
    title: product?.title || "Generated product video",
    productType: product?.productType || "Product",
    conceptTitle: concept?.title || "Product video",
    engine,
    videoUrl,
    thumbnail: product?.image || product?.images?.[0] || "",
    duration,
    createdAt: new Date().toISOString(),
    publishing: getPostingPackage({ product, concept, engine })
  };
  projectRecords = [project, ...projectRecords].slice(0, 50);
  await saveProjectRecords();
  return project;
}

async function updateProjectPublishing(projectId, patch) {
  const project = projectRecords.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");
  const current = project.publishing || getPostingPackage({
    product: { title: project.title, productType: project.productType },
    concept: { title: project.conceptTitle },
    engine: project.engine
  });
  const allowed = ["caption", "hashtags", "scheduledAt", "privacy", "allowComments", "allowDuet", "allowStitch", "status"];
  for (const key of allowed) {
    if (key in patch) current[key] = patch[key];
  }
  current.caption = cleanOverlayText(current.caption, 2200);
  if (Array.isArray(current.hashtags)) {
    current.hashtags = current.hashtags
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .map((tag) => tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`)
      .slice(0, 12);
  }
  if (current.scheduledAt && current.status === "draft") current.status = "scheduled";
  if (!current.scheduledAt && current.status === "scheduled") current.status = "draft";
  project.publishing = current;
  await saveProjectRecords();
  return project;
}

function getTaskId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 200_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized === "0:0:0:0:0:0:0:1"
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
    || normalized.startsWith("0.")
    || normalized.startsWith("127.")
    || normalized.startsWith("10.")
    || normalized.startsWith("169.254.")
    || normalized.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

async function assertPublicHost(hostname) {
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Private or local storefront URLs are not supported.");
  }
}

function getProductHandle(pathname) {
  const match = pathname.match(/\/products\/([^/?#]+)/i);
  if (!match) throw new Error("Use a Shopify product page URL containing /products/.");
  return decodeURIComponent(match[1]).replace(/\.js$/i, "");
}

function stripHtml(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrice(cents, currency = "USD") {
  if (!Number.isFinite(cents)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function normalizeMediaUrl(value) {
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function cleanOverlayText(value, maxLength = 58) {
  const clean = String(value || "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3).trim()}...` : clean;
}

function formatPriceRange(prices, currency) {
  if (!prices.length) return null;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high
    ? formatPrice(low, currency)
    : `${formatPrice(low, currency)} – ${formatPrice(high, currency)}`;
}

function sentenceCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function getSellingPoints(product, description) {
  const text = description.toLowerCase();
  const points = [];
  const patterns = [
    ["Comfort-focused", ["comfort", "comfortable", "soft", "smooth", "cushion"]],
    ["Lightweight design", ["lightweight", "light-weight", "breathable", "airy"]],
    ["Made for everyday use", ["everyday", "daily", "versatile", "casual"]],
    ["Premium material story", ["premium", "natural", "responsibly", "sourced", "organic"]],
    ["Performance-led", ["performance", "durable", "water-resistant", "support", "traction"]],
    ["Easy care", ["washable", "easy to clean", "machine wash", "low maintenance"]]
  ];

  for (const [label, keywords] of patterns) {
    if (keywords.some((keyword) => text.includes(keyword))) points.push(label);
  }

  for (const tag of getTags(product)) {
    if (points.length >= 4) break;
    if (!points.some((point) => point.toLowerCase().includes(tag.toLowerCase()))) {
      points.push(sentenceCase(tag));
    }
  }

  return points.slice(0, 4);
}

function getContentOpportunities({ description, images, variantsCount, sellingPoints }) {
  const opportunities = [];
  if (images.length >= 3) opportunities.push("Use a fast visual carousel to show the product from multiple angles.");
  if (variantsCount > 1) opportunities.push(`Feature choice and variety: ${variantsCount} variants are available.`);
  if (sellingPoints[0]) opportunities.push(`Lead with “${sellingPoints[0]}” as the opening benefit hook.`);
  if (description.length > 120) opportunities.push("Turn the product story into a concise lifestyle-led voiceover.");
  return opportunities.slice(0, 4);
}

function getTags(product) {
  const tags = Array.isArray(product.tags)
    ? product.tags
    : String(product.tags || "").split(",");
  const cleanTags = tags
    .map((tag) => String(tag).trim())
    .filter((tag) => tag
      && tag.length <= 32
      && !tag.includes("::")
      && !tag.includes("=>")
      && !tag.includes("_"))
    .slice(0, 4);
  return [...new Set([
    ...cleanTags,
    product.type || product.product_type,
    product.vendor,
    `${product.variants.length} variants`
  ].filter(Boolean))].slice(0, 4);
}

async function parseShopifyProduct(rawUrl) {
  let pageUrl;
  try {
    pageUrl = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid Shopify product URL.");
  }

  if (!["http:", "https:"].includes(pageUrl.protocol) || pageUrl.username || pageUrl.password || pageUrl.port) {
    throw new Error("Only public HTTP or HTTPS storefront URLs are supported.");
  }

  await assertPublicHost(pageUrl.hostname);
  const handle = getProductHandle(pageUrl.pathname);
  const productApiUrl = new URL(`/products/${encodeURIComponent(handle)}.js`, pageUrl.origin);
  const upstream = await fetch(productApiUrl, {
    headers: { Accept: "application/json", "User-Agent": "ReelCraft-Shopify-Parser/0.1" },
    redirect: "error",
    signal: AbortSignal.timeout(8000)
  });

  if (!upstream.ok) {
    throw new Error("This Shopify storefront did not expose the requested product.");
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.includes("json") && !contentType.includes("javascript")) {
    throw new Error("The storefront returned an unsupported product response.");
  }

  const product = await upstream.json();
  if (!product?.title || !Array.isArray(product.variants)) {
    throw new Error("The storefront response did not contain a Shopify product.");
  }

  const currency = upstream.headers.get("x-shopify-currency") || "USD";
  const prices = product.variants.map((variant) => Number(variant.price)).filter(Number.isFinite);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const images = (product.images || []).slice(0, 8).map(normalizeMediaUrl).filter(Boolean);
  const description = stripHtml(product.description);
  const sellingPoints = getSellingPoints(product, description);
  const availableVariants = product.variants.filter((variant) => variant.available).length;
  const options = (product.options || []).map((option) => ({
    name: option.name,
    values: option.values || []
  }));

  return {
    source: "shopify",
    storefront: pageUrl.hostname,
    productUrl: pageUrl.href,
    title: product.title,
    vendor: product.vendor || null,
    productType: product.type || product.product_type || null,
    description: description.slice(0, 320),
    price: formatPrice(minPrice, currency),
    priceRange: formatPriceRange(prices, currency),
    currency,
    image: normalizeMediaUrl(product.featured_image || product.images?.[0]),
    images,
    tags: getTags(product),
    variantsCount: product.variants.length,
    availableVariants,
    options,
    analysis: {
      listingHealth: description.length >= 120 && images.length >= 3 ? "Strong" : "Needs enrichment",
      descriptionWords: description.split(/\s+/).filter(Boolean).length,
      sellingPoints,
      contentOpportunities: getContentOpportunities({
        description,
        images,
        variantsCount: product.variants.length,
        sellingPoints
      }),
      assetAudit: `${images.length} product image${images.length === 1 ? "" : "s"} available for video generation`
    },
    reviews: {
      available: false,
      message: "Reviews are not included in Shopify's standard product endpoint."
    }
  };
}

function getSeedanceConfig() {
  return {
    apiKey: process.env.SEEGEN_API_KEY || process.env.SEEDANCE_API_KEY || "",
    model: process.env.SEEGEN_MODEL || "dreamina-seedance-2-0-260128",
    baseUrl: (process.env.SEEGEN_BASE_URL || "https://api.seegen.ai").replace(/\/$/, ""),
    provider: "Seegen"
  };
}

function validateGenerationInput(input) {
  if (!input?.product?.title || !input?.product?.image) {
    throw new Error("Analyze a Shopify product before generating a video.");
  }
  if (!input?.concept?.title || !input?.concept?.copy) {
    throw new Error("Choose a creative concept before generating a video.");
  }
}

function buildSeedancePrompt({ product, concept }) {
  const benefits = (product.analysis?.sellingPoints || []).slice(0, 3).join(", ");
  return [
    "Create a polished 5-second vertical ecommerce product video for social media.",
    `Product: ${product.title}.`,
    product.productType ? `Category: ${product.productType}.` : "",
    benefits ? `Key product signals: ${benefits}.` : "",
    `Creative direction: ${concept.title}. Hook: ${concept.copy}`,
    "Use the reference image as the source of truth for product shape, material, color, and branding.",
    "Start with a clean close-up hero shot, then add a subtle slow camera push-in and a gentle product-focused reveal.",
    "Premium natural lighting, realistic commercial photography, clean background, crisp material detail.",
    "Keep the product visually consistent. Do not invent text, logos, extra products, people, hands, or packaging.",
    "Leave clear lower-third negative space for captions. No on-screen text. No watermark."
  ].filter(Boolean).join(" ");
}

async function requestSeedance(path, options = {}) {
  const { apiKey, baseUrl } = getSeedanceConfig();
  if (!apiKey) throw new Error("Seedance is not configured. Add a new API key to .env.local.");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body.error?.code || body.code;
    const message = body.error?.message || body.message || body.error || `Seegen request failed (${response.status}).`;
    throw new Error(`Seegen rejected the request${code ? ` [${code}]` : ""}: ${message}`);
  }
  return body;
}

async function createSeedanceTask(input) {
  validateGenerationInput(input);
  const { model } = getSeedanceConfig();
  const prompt = buildSeedancePrompt(input);
  const task = await requestSeedance("/v1/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify({
      model,
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: normalizeMediaUrl(input.product.image) },
          role: "reference_image"
        }
      ],
      generate_audio: false,
      ratio: "9:16",
      resolution: "720p",
      duration: 5,
      watermark: false
    })
  });
  const taskId = task.id;
  if (!taskId) throw new Error("Seegen accepted the request but did not return a task ID.");
  seedanceTasks.set(taskId, { prompt, input, createdAt: Date.now() });
  return { id: taskId, status: task.status || "running", prompt };
}

function extractSeedanceVideoUrl(task) {
  if (task.video_url) return task.video_url;
  if (task.output?.video_url) return task.output.video_url;
  if (task.content?.video_url) return task.content.video_url;
  if (Array.isArray(task.content)) {
    const video = task.content.find((item) => item.type === "video_url" || item.video_url);
    return video?.video_url?.url || video?.video_url || video?.url || null;
  }
  return null;
}

async function retrieveSeedanceTask(taskId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error("Invalid Seedance task ID.");
  const task = await requestSeedance(`/v1/contents/generations/tasks/${taskId}`);
  const taskRecord = seedanceTasks.get(taskId);
  const status = String(task.status || "running").toLowerCase();
  const videoUrl = extractSeedanceVideoUrl(task);
  let project = null;
  if (status === "succeeded" && videoUrl && taskRecord?.input) {
    project = await addProjectRecord({
      ...taskRecord.input,
      engine: "Seedance 2.0",
      videoUrl,
      duration: "00:05",
      taskId
    });
  }
  return {
    id: task.id || taskId,
    status,
    videoUrl,
    lastFrameUrl: null,
    error: task.error?.message || task.message || null,
    usage: task.usage || null,
    project
  };
}

async function downloadStarterImage(rawUrl, destination) {
  const url = new URL(normalizeMediaUrl(rawUrl));
  if (url.protocol !== "https:") throw new Error("Starter images must use HTTPS.");
  await assertPublicHost(url.hostname);
  const response = await fetch(url, {
    headers: { "User-Agent": "ReelCraft-Starter-Video/0.1" },
    redirect: "error",
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error("A product image could not be downloaded.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 12_000_000) throw new Error("A product image is too large for Starter generation.");
  await writeFile(destination, bytes);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args);
    let errorOutput = "";
    process.stderr.on("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-4000);
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`Starter video render failed (${code}). ${errorOutput.slice(-600)}`));
    });
  });
}

function getStarterScenes(input) {
  const product = input.product;
  const benefits = product.analysis?.sellingPoints || [];
  return [
    { eyebrow: "NEW PRODUCT SPOTLIGHT", headline: cleanOverlayText(product.title, 28), body: cleanOverlayText(input.concept.copy, 44) },
    { eyebrow: "WHY IT STANDS OUT", headline: cleanOverlayText(benefits[0] || "Designed for everyday use", 28), body: cleanOverlayText(benefits[1] || product.description, 44) },
    { eyebrow: "THE DETAILS MATTER", headline: cleanOverlayText(benefits[2] || "Made to fit your routine", 28), body: cleanOverlayText(product.analysis?.assetAudit || "Explore every angle", 44) },
    { eyebrow: "SHOP THE COLLECTION", headline: cleanOverlayText(product.title, 28), body: cleanOverlayText(`${product.priceRange || product.price || ""}  |  ${product.variantsCount || 1} options available`, 44) }
  ];
}

function starterVideoFilter(textFiles) {
  const escapePath = (path) => path.replace(/\\/g, "/").replace(/:/g, "\\:");
  return [
    "scale=620:1080:force_original_aspect_ratio=decrease",
    "format=rgba"
  ].join(",");
}

function starterCompositeFilter(textFiles) {
  const escapePath = (path) => path.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `${[
    `[0:v]${starterVideoFilter(textFiles)}[product];[1:v][product]overlay=(W-w)/2:(H-h)/2:format=auto`,
    "zoompan=z='min(zoom+0.0008,1.08)':d=113:s=720x1280:fps=30",
    "drawbox=x=0:y=900:w=720:h=380:color=0x17251d@0.88:t=fill",
    `drawtext=fontfile='${escapePath(videoFont)}':textfile='${escapePath(textFiles.eyebrow)}':fontcolor=0xcdec77:fontsize=22:x=54:y=970`,
    `drawtext=fontfile='${escapePath(videoFont)}':textfile='${escapePath(textFiles.headline)}':fontcolor=white:fontsize=44:x=54:y=1020`,
    `drawtext=fontfile='${escapePath(videoFont)}':textfile='${escapePath(textFiles.body)}':fontcolor=0xe4ebe5:fontsize=25:x=54:y=1100`,
    `drawtext=fontfile='${escapePath(videoFont)}':text='REELCRAFT  /  STARTER VIDEO':fontcolor=0xadc0b2:fontsize=17:x=54:y=1215`
  ].join(",")}`;
}

async function renderStarterVideo(taskId, input) {
  const task = starterTasks.get(taskId);
  const workDir = await mkdtemp(join(tmpdir(), "reelcraft-starter-"));
  try {
    task.status = "downloading_assets";
    const sourceImages = [...new Set([input.product.image, ...(input.product.images || [])].filter(Boolean))].slice(0, 4);
    if (!sourceImages.length) throw new Error("No product images are available for Starter generation.");
    const imagePaths = [];
    for (const [index, image] of sourceImages.entries()) {
      const imagePath = join(workDir, `image-${index}.jpg`);
      await downloadStarterImage(image, imagePath);
      imagePaths.push(imagePath);
    }

    task.status = "rendering_scenes";
    const scenes = getStarterScenes(input);
    const segmentPaths = [];
    for (const [index, scene] of scenes.entries()) {
      const sceneTextFiles = {
        eyebrow: join(workDir, `eyebrow-${index}.txt`),
        headline: join(workDir, `headline-${index}.txt`),
        body: join(workDir, `body-${index}.txt`)
      };
      await Promise.all([
        writeFile(sceneTextFiles.eyebrow, scene.eyebrow),
        writeFile(sceneTextFiles.headline, scene.headline),
        writeFile(sceneTextFiles.body, scene.body)
      ]);
      const segmentPath = join(workDir, `segment-${index}.mp4`);
      await runFfmpeg([
        "-y", "-loop", "1", "-i", imagePaths[index % imagePaths.length],
        "-f", "lavfi", "-i", "color=c=0xf4f6f0:s=720x1280:d=3.75",
        "-filter_complex", starterCompositeFilter(sceneTextFiles),
        "-t", "3.75", "-r", "30", "-an", "-c:v", "libx264", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", segmentPath
      ]);
      segmentPaths.push(segmentPath);
    }

    task.status = "assembling_video";
    await mkdir(generatedDir, { recursive: true });
    const concatFile = join(workDir, "segments.txt");
    await writeFile(concatFile, segmentPaths.map((path) => `file '${path}'`).join("\n"));
    const outputPath = join(generatedDir, `${taskId}.mp4`);
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", outputPath]);
    task.status = "succeeded";
    task.videoUrl = `/generated/${taskId}.mp4`;
    task.project = await addProjectRecord({
      ...input,
      engine: "Starter Free",
      videoUrl: task.videoUrl,
      duration: "00:15",
      taskId
    });
  } catch (error) {
    task.status = "failed";
    task.error = error.message;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function createStarterTask(input) {
  validateGenerationInput(input);
  const id = getTaskId("starter");
  const task = { id, status: "queued", videoUrl: null, error: null };
  starterTasks.set(id, task);
  void renderStarterVideo(id, input);
  return task;
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (requestedPath.startsWith(".") || requestedPath.includes("/.")) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  const staticRoot = requestedPath.startsWith("generated/") ? root : publicRoot;
  const filePath = join(staticRoot, normalize(requestedPath));
  if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}/`)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

export async function handleRequest(request, response) {
  if (request.method === "GET" && request.url.startsWith("/api/shopify/product")) {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const productUrl = requestUrl.searchParams.get("url");
      if (!productUrl) return sendJson(response, 400, { error: "Missing product URL." });
      sendJson(response, 200, { product: await parseShopifyProduct(productUrl) });
    } catch (error) {
      sendJson(response, 422, { error: error.message || "Unable to analyze this Shopify product." });
    }
    return;
  }

  if (request.method === "GET" && request.url === "/api/seedance/config") {
    const { apiKey, model, provider } = getSeedanceConfig();
    return sendJson(response, 200, { configured: Boolean(apiKey), model, provider });
  }

  if (request.method === "POST" && request.url === "/api/seedance/prompts/preview") {
    try {
      const input = await readJson(request);
      validateGenerationInput(input);
      return sendJson(response, 200, {
        prompt: buildSeedancePrompt(input),
        settings: { ratio: "9:16", duration: 5, resolution: "720p", generateAudio: false }
      });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }

  if (request.method === "POST" && request.url === "/api/seedance/tasks") {
    try {
      return sendJson(response, 202, { task: await createSeedanceTask(await readJson(request)) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }

  if (request.method === "GET" && request.url.startsWith("/api/seedance/tasks/")) {
    try {
      const taskId = decodeURIComponent(request.url.split("/").pop());
      return sendJson(response, 200, { task: await retrieveSeedanceTask(taskId) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }

  if (request.method === "GET" && request.url === "/api/projects") {
    projectRecords = projectRecords.map((project) => ({
      ...project,
      publishing: project.publishing || getPostingPackage({
        product: { title: project.title, productType: project.productType },
        concept: { title: project.conceptTitle },
        engine: project.engine
      })
    }));
    return sendJson(response, 200, { projects: projectRecords });
  }

  if (request.method === "PATCH" && request.url.startsWith("/api/projects/")) {
    try {
      const projectId = decodeURIComponent(request.url.split("/").pop());
      return sendJson(response, 200, { project: await updateProjectPublishing(projectId, await readJson(request)) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }

  if (request.method === "POST" && request.url === "/api/starter/tasks") {
    try {
      return sendJson(response, 202, { task: createStarterTask(await readJson(request)) });
    } catch (error) {
      return sendJson(response, 422, { error: error.message });
    }
  }

  if (request.method === "GET" && request.url.startsWith("/api/starter/tasks/")) {
    const taskId = decodeURIComponent(request.url.split("/").pop());
    const task = starterTasks.get(taskId);
    return task
      ? sendJson(response, 200, { task })
      : sendJson(response, 404, { error: "Starter video task not found." });
  }

  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
  await serveStatic(request, response);
}

if (!process.env.VERCEL) {
  const server = createServer(handleRequest);
  server.listen(port, () => {
    console.log(`ReelCraft MVP running at http://127.0.0.1:${port}`);
  });
}
