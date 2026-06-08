let concepts = [
  {
    icon: "✦",
    title: "Everyday luxury",
    type: "LIFESTYLE HOOK",
    copy: "POV: your home suddenly feels like a boutique hotel.",
    meta: "Warm · Aspirational · Product-led"
  },
  {
    icon: "❝",
    title: "The review said it best",
    type: "SOCIAL PROOF",
    copy: "I finally found a candle that fills the room without taking over.",
    meta: "Authentic · Trust-building · UGC"
  },
  {
    icon: "◒",
    title: "Your evening reset",
    type: "ROUTINE STORY",
    copy: "Three little things that make winding down feel intentional.",
    meta: "Calm · Relatable · Routine-led"
  }
];

const form = document.querySelector("#product-form");
const conceptList = document.querySelector("#concept-list");
const stepper = document.querySelector(".stepper");
const creditCount = document.querySelector("#credit-count");
let selectedConcept = 0;
let currentProduct = null;
let promptInput = null;
let pollingTimer = null;
let generationEngine = "seedance";
let recentProjects = [];
let pendingProjects = JSON.parse(window.localStorage.getItem("reelcraftPendingProjects") || "[]");
let activeProject = null;
let projectFilter = "all";
let authUser = JSON.parse(window.localStorage.getItem("reelcraftUser") || "null");
let activeView = "create";
const viewMeta = {
  create: { label: "New video", hash: "#create" },
  projects: { label: "My projects", hash: "#projects" },
  brand: { label: "Brand kit", hash: "#brand" },
  inspiration: { label: "Inspiration", hash: "#inspiration" },
  help: { label: "Help center", hash: "#help" }
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConcepts() {
  conceptList.innerHTML = concepts.map((item, index) => `
    <button class="concept-card ${index === selectedConcept ? "selected" : ""}" data-index="${index}">
      <span class="concept-icon">${escapeHtml(item.icon)}</span>
      <span class="concept-text">
        <span class="concept-top"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.type)}</small></span>
        <em>“${escapeHtml(item.copy)}”</em>
        <span class="concept-meta">${escapeHtml(item.meta)}</span>
      </span>
      <span class="radio"><i></i></span>
    </button>
  `).join("");
}

function setStage(name, step) {
  document.querySelectorAll(".stage").forEach((node) => node.classList.remove("active"));
  document.querySelector(`#${name}-stage`).classList.add("active");
  document.querySelector("#creator-panel").classList.toggle("generation-dock-active", name === "concept");
  document.querySelector("#create-view").classList.toggle("generation-view-active", name === "concept");
  document.querySelector("#create-view").classList.toggle("result-view-active", name === "result");
  document.querySelectorAll(".step").forEach((node, index) => {
    node.classList.toggle("active", index <= step);
    node.classList.toggle("current", index === step);
  });
  document.querySelectorAll(".step-line").forEach((node, index) => node.classList.toggle("active", index < step));
  stepper.scrollIntoView({ behavior: "smooth", block: "center" });
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2400);
}

function switchView(view, { updateHash = true } = {}) {
  activeView = viewMeta[view] ? view : "create";
  if (activeView !== "create") {
    document.querySelector("#create-view").classList.remove("generation-view-active", "result-view-active");
    document.querySelector("#creator-panel").classList.remove("generation-dock-active");
  }
  document.querySelectorAll(".app-view").forEach((section) => {
    const isActive = section.dataset.view === activeView;
    section.hidden = !isActive;
    section.classList.toggle("active", isActive);
  });
  document.querySelectorAll("[data-view-target]").forEach((link) => {
    link.classList.toggle("active", link.dataset.viewTarget === activeView);
  });
  document.querySelector("#breadcrumb-page").textContent = viewMeta[activeView].label;
  if (updateHash) window.history.replaceState(null, "", viewMeta[activeView].hash);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function startNewProject() {
  activeProject = null;
  document.querySelector("#publish-panel").hidden = true;
  switchView("create");
  setStage("input", 0);
}

function getInitials(email = "") {
  const name = email.split("@")[0] || "User";
  return name
    .split(/[._-\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function renderAuthState() {
  const loginButton = document.querySelector("#open-auth-modal");
  const avatar = document.querySelector("#account-avatar");
  if (!authUser) {
    loginButton.textContent = "Log in";
    avatar.hidden = true;
    creditCount.textContent = "12";
    return;
  }
  loginButton.textContent = authUser.provider === "google" ? "Google account" : "Account";
  avatar.hidden = false;
  avatar.textContent = getInitials(authUser.email);
  creditCount.textContent = "36";
}

function setAuthModalOpen(open) {
  document.querySelector("#auth-modal").hidden = !open;
}

function completeLogin(user) {
  authUser = {
    email: user.email,
    provider: user.provider,
    loggedInAt: new Date().toISOString()
  };
  window.localStorage.setItem("reelcraftUser", JSON.stringify(authUser));
  renderAuthState();
  setAuthModalOpen(false);
  toast("Logged in. Extra creation credits are available.");
}

function buildConcepts(product) {
  const name = product.title;
  const category = product.productType || "product";
  return [
    {
      icon: "✦",
      title: "Product spotlight",
      type: "BENEFIT HOOK",
      copy: `Meet ${name}: a closer look at the details that make it stand out.`,
      meta: `${category} · Product-led · Polished`
    },
    {
      icon: "◒",
      title: "Why it belongs in your routine",
      type: "LIFESTYLE STORY",
      copy: `One simple upgrade: make ${name} part of your everyday routine.`,
      meta: "Relatable · Lifestyle · Conversion-ready"
    },
    {
      icon: "↗",
      title: "From every angle",
      type: "VISUAL SHOWCASE",
      copy: `${name}, shown in motion. The small details do the talking.`,
      meta: "Visual · Fast-paced · Product-first"
    }
  ];
}

function renderProduct(product) {
  currentProduct = product;
  const generatedVideo = document.querySelector("#generated-video");
  generatedVideo.hidden = true;
  generatedVideo.removeAttribute("src");
  document.querySelector("#video-placeholder").hidden = false;
  document.querySelector(".video-gradient").hidden = false;
  document.querySelector(".scene-pill").hidden = false;
  document.querySelector(".video-caption").hidden = false;
  document.querySelector(".preview-play").hidden = false;
  document.querySelector(".timeline").hidden = false;
  const image = product.image || product.images?.[0];
  if (image) document.querySelector("#product-image").src = image;
  document.querySelector("#product-image").alt = product.title;
  document.querySelector("#product-source").textContent = product.source;
  document.querySelector("#product-title").textContent = product.title;
  document.querySelector("#product-summary").textContent =
    product.description || [product.vendor, product.productType].filter(Boolean).join(" · ") || "Product details loaded from Shopify";
  document.querySelector("#product-price").textContent = product.price || "Price varies";
  document.querySelector("#product-variants").textContent = `${product.variantsCount} variant${product.variantsCount === 1 ? "" : "s"} · ${product.storefront}`;
  document.querySelector("#listing-health").textContent = product.analysis.listingHealth;
  document.querySelector("#fact-price").textContent = product.priceRange || "Price varies";
  document.querySelector("#fact-stock").textContent = `${product.availableVariants}/${product.variantsCount} variants live`;
  document.querySelector("#fact-assets").textContent = `${product.images.length} images ready`;
  document.querySelector("#fact-description").textContent = `${product.analysis.descriptionWords} words`;
  document.querySelector("#review-status").textContent = product.reviews.message;
  document.querySelector("#product-tags").innerHTML = product.tags
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  document.querySelector("#product-options").innerHTML = product.options.length
    ? product.options.map((option) => `
      <div><small>${escapeHtml(option.name)}</small><b>${escapeHtml(option.values.slice(0, 4).join(" · "))}${option.values.length > 4 ? ` +${option.values.length - 4}` : ""}</b></div>
    `).join("")
    : "<div><small>OPTIONS</small><b>Single configuration</b></div>";
  document.querySelector("#selling-points").innerHTML = product.analysis.sellingPoints
    .map((point, index) => `<div><b>0${index + 1}</b><span>${escapeHtml(point)}</span></div>`)
    .join("");
  document.querySelector("#content-opportunities").innerHTML = product.analysis.contentOpportunities
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const preview = document.querySelector("#video-placeholder");
  if (image) preview.src = image;
  preview.alt = `${product.title} generated video preview`;
  concepts = buildConcepts(product);
  selectedConcept = 0;
  renderConcepts();
}

function getGenerationInput() {
  return { product: currentProduct, concept: concepts[selectedConcept] };
}

function setModalOpen(open) {
  document.querySelector("#prompt-modal").hidden = !open;
}

async function getPromptPreview() {
  const response = await fetch("/api/seedance/prompts/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getGenerationInput())
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to build the Seedance prompt.");
  return body;
}

async function getSeedanceConfig() {
  const response = await fetch("/api/seedance/config");
  return response.json();
}

function showGenerationProgress(status = "queued") {
  const button = document.querySelector("#confirm-generation");
  button.disabled = true;
  button.textContent = `Seedance task ${status}...`;
  document.querySelector("#seedance-config-note").textContent =
    "Keep this page open while ReelCraft waits for the generated clip.";
}

const generationProgress = {
  queued: [8, "Queued for generation"],
  running: [18, "Preparing your AI video"],
  pending: [18, "Preparing your AI video"],
  processing: [42, "Generating product scenes"],
  downloading_assets: [22, "Downloading product assets"],
  rendering_scenes: [58, "Rendering product scenes"],
  assembling_video: [88, "Assembling the final video"],
  succeeded: [100, "Video completed"],
  failed: [100, "Generation failed"],
  expired: [100, "Generation expired"]
};

function savePendingProjects() {
  window.localStorage.setItem("reelcraftPendingProjects", JSON.stringify(pendingProjects));
}

function addPendingProject(taskId, engine) {
  const existing = pendingProjects.find((project) => project.taskId === taskId);
  if (existing) return existing;
  const project = {
    id: `pending_${taskId}`,
    taskId,
    title: currentProduct?.title || "Product video",
    conceptTitle: concepts[selectedConcept]?.title || "Product spotlight",
    engine: engine === "starter" ? "Starter Free" : "Seedance 2.0",
    thumbnail: currentProduct?.image || currentProduct?.images?.[0] || "",
    duration: engine === "starter" ? "00:15" : "00:05",
    generationStatus: "queued",
    progress: 8,
    progressLabel: "Queued for generation",
    createdAt: new Date().toISOString()
  };
  pendingProjects = [project, ...pendingProjects];
  savePendingProjects();
  renderProjects(recentProjects);
  return project;
}

function updatePendingProject(taskId, status, error = "") {
  const project = pendingProjects.find((item) => item.taskId === taskId);
  if (!project) return;
  const [progress, label] = generationProgress[status] || [35, "Generating your video"];
  project.generationStatus = status;
  project.progress = progress;
  project.progressLabel = error || label;
  savePendingProjects();
  renderProjects(recentProjects);
}

function removePendingProject(taskId) {
  pendingProjects = pendingProjects.filter((project) => project.taskId !== taskId);
  savePendingProjects();
}

function showGeneratedVideo({ videoUrl, engine }) {
  const video = document.querySelector("#generated-video");
  video.src = videoUrl;
  video.load();
  video.hidden = false;
  document.querySelector("#video-placeholder").hidden = true;
  document.querySelector(".video-gradient").hidden = true;
  document.querySelector(".scene-pill").hidden = true;
  document.querySelector(".video-caption").hidden = true;
  document.querySelector(".preview-play").hidden = true;
  document.querySelector(".timeline").hidden = true;
  document.querySelector("#result-download").href = videoUrl;
  document.querySelector("#result-title").textContent = engine === "starter"
    ? "Your Starter video is ready."
    : "Your Seedance clip is ready.";
  document.querySelector("#result-description").textContent = engine === "starter"
    ? "Generated locally from your Shopify listing with animated product scenes, selling-point captions, and a closing CTA."
    : "Generated as a real 5-second product-focused test clip. This is the first building block for the full video workflow.";
  document.querySelector("#result-length").textContent = engine === "starter" ? "00:15" : "00:05";
  document.querySelector("#result-type").textContent = engine === "starter" ? "Starter Free MP4" : "Seedance test clip";
  document.querySelector("#generation-note").textContent = engine === "starter"
    ? "✓ Generated locally with Starter Free"
    : "✦ Generated with Seedance 2.0";
  setStage("result", 2);
}

function toLocalDateTimeValue(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeValue(value) {
  return value ? new Date(value).toISOString() : "";
}

function renderPublishingPanel(project) {
  activeProject = project;
  const panel = document.querySelector("#publish-panel");
  const publishing = project.publishing || {};
  panel.hidden = false;
  document.querySelector("#publish-status").textContent = publishing.status || "draft";
  document.querySelector("#publish-caption").value = publishing.caption || "";
  document.querySelector("#publish-hashtags").value = (publishing.hashtags || []).join(" ");
  document.querySelector("#publish-privacy").value = publishing.privacy || "public";
  document.querySelector("#publish-scheduled-at").value = toLocalDateTimeValue(publishing.scheduledAt);
  document.querySelector("#publish-comments").checked = publishing.allowComments !== false;
  document.querySelector("#publish-duet").checked = publishing.allowDuet !== false;
  document.querySelector("#publish-stitch").checked = publishing.allowStitch !== false;
  document.querySelector("#publish-checklist").innerHTML = (publishing.checklist || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function showProject(project) {
  switchView("create");
  showGeneratedVideo({
    videoUrl: project.videoUrl,
    engine: project.engine === "Starter Free" ? "starter" : "seedance"
  });
  document.querySelector("#result-title").textContent = project.title;
  document.querySelector("#result-description").textContent = `${project.conceptTitle} · ${project.productType} · ${project.engine}`;
  document.querySelector("#result-length").textContent = project.duration;
  document.querySelector("#result-type").textContent = project.engine;
  document.querySelector("#generation-note").textContent = `✓ Saved to recent projects · ${new Date(project.createdAt).toLocaleString()}`;
  renderPublishingPanel(project);
}

function renderProjects(projects) {
  recentProjects = projects;
  const grid = document.querySelector("#recent-grid");
  const counts = {
    all: projects.length + pendingProjects.length,
    draft: projects.filter((project) => (project.publishing?.status || "draft") === "draft").length,
    scheduled: projects.filter((project) => project.publishing?.status === "scheduled").length
  };
  document.querySelector("#project-count-all").textContent = counts.all;
  document.querySelector("#project-count-draft").textContent = counts.draft;
  document.querySelector("#project-count-scheduled").textContent = counts.scheduled;
  document.querySelector("#project-total-label").textContent = `${counts.all} project${counts.all === 1 ? "" : "s"}`;
  const viewCopy = {
    all: ["Recent activity", "Generated videos, TikTok drafts, and scheduled posts live in one place."],
    draft: ["Drafts", "Videos that have publish copy ready but no scheduled time yet."],
    scheduled: ["Scheduled posts", "Videos with saved TikTok timing and publishing settings."]
  };
  document.querySelector("#project-view-title").textContent = viewCopy[projectFilter][0];
  document.querySelector("#project-view-copy").textContent = viewCopy[projectFilter][1];
  document.querySelectorAll(".project-filter").forEach((button) => {
    button.classList.toggle("active", button.dataset.projectFilter === projectFilter);
  });
  const visibleProjects = projectFilter === "all"
    ? projects
    : projects.filter((project) => (project.publishing?.status || "draft") === projectFilter);
  const pendingCards = projectFilter === "all" ? pendingProjects.map((project) => {
    const failed = ["failed", "expired"].includes(project.generationStatus);
    return `
      <article class="project-card generation-project ${failed ? "generation-failed" : ""}" data-pending-task-id="${escapeHtml(project.taskId)}">
        <div class="generation-thumbnail">
          ${project.thumbnail ? `<img src="${escapeHtml(project.thumbnail)}" alt="${escapeHtml(project.title)}">` : ""}
          <div class="generation-thumbnail-overlay"><span>${failed ? "!" : "✦"}</span></div>
        </div>
        <span class="duration">${escapeHtml(project.duration)}</span>
        <span class="publish-badge generation-status">${failed ? "failed" : "generating"}</span>
        <div class="project-card-body">
          <h3>${escapeHtml(project.title)}</h3>
          <p>${escapeHtml(project.engine)} · ${escapeHtml(project.conceptTitle)}</p>
          <div class="project-progress"><i style="width:${project.progress}%"></i></div>
          <small>${escapeHtml(project.progressLabel)} · ${project.progress}%</small>
        </div>
      </article>
    `;
  }).join("") : "";
  const projectCards = visibleProjects.map((project) => `
    <article class="project-card" data-project-id="${escapeHtml(project.id)}">
      <img src="${escapeHtml(project.thumbnail)}" alt="${escapeHtml(project.title)}">
      <span class="duration">${escapeHtml(project.duration)}</span>
      <span class="publish-badge completed-badge">completed</span>
      <div class="project-card-body">
        <h3>${escapeHtml(project.title)}</h3>
        <p>${escapeHtml(project.engine)} · ${escapeHtml(project.conceptTitle)}</p>
        <small>${escapeHtml(project.publishing?.status || "draft")} · ${escapeHtml(project.publishing?.scheduledAt ? new Date(project.publishing.scheduledAt).toLocaleString() : "No publish time set")}</small>
      </div>
    </article>
  `).join("");
  grid.innerHTML = `${pendingCards}${projectCards || (!pendingCards ? `
    <article class="empty-projects"><div>○</div><h3>No projects in this view</h3><p>Generate a video or switch filters to see more work.</p></article>
  ` : "")}
    <article class="new-project"><div>＋</div><h3>Start a new project</h3><p>Turn your next product into a story</p></article>`;
}

async function refreshProjects() {
  const response = await fetch("/api/projects");
  const body = await response.json();
  renderProjects(body.projects || []);
}

function resumePendingGeneration() {
  const project = pendingProjects.find((item) => !["failed", "expired"].includes(item.generationStatus));
  if (!project) return;
  if (project.engine === "Starter Free") pollStarterTask(project.taskId);
  else pollSeedanceTask(project.taskId);
}

async function savePublishing(statusOverride) {
  if (!activeProject) return toast("Open a generated video before saving publish settings.");
  const hashtags = document.querySelector("#publish-hashtags").value
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const payload = {
    caption: document.querySelector("#publish-caption").value,
    hashtags,
    privacy: document.querySelector("#publish-privacy").value,
    scheduledAt: fromLocalDateTimeValue(document.querySelector("#publish-scheduled-at").value),
    allowComments: document.querySelector("#publish-comments").checked,
    allowDuet: document.querySelector("#publish-duet").checked,
    allowStitch: document.querySelector("#publish-stitch").checked,
    status: statusOverride
  };
  const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) return toast(body.error || "Unable to save publish settings.");
  showProject(body.project);
  await refreshProjects();
  toast(statusOverride === "scheduled" ? "TikTok post scheduled locally." : "TikTok publish draft saved.");
}

async function pollStarterTask(taskId) {
  window.clearTimeout(pollingTimer);
  const button = document.querySelector("#generate-btn");
  try {
    const response = await fetch(`/api/starter/tasks/${encodeURIComponent(taskId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to retrieve the Starter task.");
    const { task } = body;
    updatePendingProject(taskId, task.status);
    button.disabled = true;
    button.innerHTML = `Starter video: ${escapeHtml(task.status.replaceAll("_", " "))}...`;
    if (task.status === "succeeded" && task.videoUrl) {
      button.disabled = false;
      button.innerHTML = "Generate free video <span>FREE</span>";
      removePendingProject(taskId);
      await refreshProjects();
      switchView("projects");
      toast("Your free Starter MP4 is ready.");
      return;
    }
    if (task.status === "failed") throw new Error(task.error || "Starter video generation failed.");
    pollingTimer = window.setTimeout(() => pollStarterTask(taskId), 1200);
  } catch (error) {
    updatePendingProject(taskId, "failed", error.message);
    button.disabled = false;
    button.innerHTML = "Try Starter again <span>FREE</span>";
    toast(error.message);
  }
}

async function startStarterGeneration() {
  const button = document.querySelector("#generate-btn");
  button.disabled = true;
  button.textContent = "Starting local render...";
  const response = await fetch("/api/starter/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getGenerationInput())
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to start Starter generation.");
  addPendingProject(body.task.id, "starter");
  switchView("projects");
  toast("Video generation started. You can track progress here.");
  pollStarterTask(body.task.id);
}

async function pollSeedanceTask(taskId) {
  window.clearTimeout(pollingTimer);
  try {
    const response = await fetch(`/api/seedance/tasks/${encodeURIComponent(taskId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to retrieve the Seedance task.");
    const { task } = body;
    updatePendingProject(taskId, task.status);
    showGenerationProgress(task.status);
    if (task.status === "succeeded" && task.videoUrl) {
      setModalOpen(false);
      removePendingProject(taskId);
      await refreshProjects();
      switchView("projects");
      toast("Your real Seedance 2.0 clip is ready.");
      return;
    }
    if (task.status === "failed" || task.status === "expired") {
      throw new Error(task.error || `Seedance task ${task.status}.`);
    }
    pollingTimer = window.setTimeout(() => pollSeedanceTask(taskId), 3500);
  } catch (error) {
    updatePendingProject(taskId, "failed", error.message);
    document.querySelector("#confirm-generation").disabled = false;
    document.querySelector("#confirm-generation").innerHTML = "Try again <span>→</span>";
    document.querySelector("#seedance-config-note").textContent = error.message;
  }
}

function resetProgress() {
  document.querySelector("#loading-progress").style.width = "8%";
  document.querySelector("#loading-message").textContent = "Connecting to Shopify storefront";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#form-error");
  error.textContent = "";
  resetProgress();
  setStage("loading", 0);
  const progress = document.querySelector("#loading-progress");
  const message = document.querySelector("#loading-message");
  const steps = [
    [22, "Connecting to Shopify storefront"],
    [48, "Pulling product details and images"],
    [74, "Organizing product signals"],
    [92, "Building creative concepts"]
  ];
  let index = 0;
  const interval = window.setInterval(() => {
    const [percent, copy] = steps[index];
    progress.style.width = `${percent}%`;
    message.textContent = copy;
    index += 1;
    if (index === steps.length) window.clearInterval(interval);
  }, 560);

  try {
    const url = document.querySelector("#product-url").value;
    const response = await fetch(`/api/shopify/product?url=${encodeURIComponent(url)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to analyze this product.");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    window.clearInterval(interval);
    progress.style.width = "100%";
    message.textContent = "Shopify product loaded";
    renderProduct(body.product);
    window.setTimeout(() => setStage("concept", 1), 250);
  } catch (requestError) {
    window.clearInterval(interval);
    error.textContent = requestError.message;
    setStage("input", 0);
  }
});

conceptList.addEventListener("click", (event) => {
  const button = event.target.closest(".concept-card");
  if (!button) return;
  selectedConcept = Number(button.dataset.index);
  renderConcepts();
});

document.querySelectorAll(".engine-card").forEach((button) => {
  button.addEventListener("click", () => {
    generationEngine = button.dataset.engine;
    document.querySelectorAll(".engine-card").forEach((node) => node.classList.toggle("selected", node === button));
    document.querySelector(".generation-dock-label b").textContent = generationEngine === "starter"
      ? "Starter Free"
      : "Seedance 2.0 Premium";
    document.querySelector(".generation-dock-label > span").textContent = generationEngine === "starter" ? "✓" : "✦";
    document.querySelector("#generate-btn").innerHTML = generationEngine === "starter"
      ? "Generate free video <span>FREE</span>"
      : "Generate with Seedance <span>✦ 4</span>";
    document.querySelector("#duration-value").textContent = generationEngine === "starter"
      ? "15 seconds⌄"
      : "5 seconds⌄";
  });
});

document.querySelector("#generate-btn").addEventListener("click", async () => {
  try {
    if (generationEngine === "starter") {
      await startStarterGeneration();
      return;
    }
    const [preview, config] = await Promise.all([getPromptPreview(), getSeedanceConfig()]);
    promptInput = getGenerationInput();
    document.querySelector("#seedance-prompt").value = preview.prompt;
    document.querySelector("#seedance-config-note").textContent = config.configured
      ? `Connected to ${config.provider}: ${config.model}. Confirm to start a real generation.`
      : "Seegen is not configured yet. Add your API key to .env.local before confirming.";
    document.querySelector("#confirm-generation").disabled = !config.configured;
    document.querySelector("#confirm-generation").innerHTML = "Confirm and generate <span>→</span>";
    setModalOpen(true);
  } catch (error) {
    const button = document.querySelector("#generate-btn");
    button.disabled = false;
    button.innerHTML = generationEngine === "starter"
      ? "Try Starter again <span>FREE</span>"
      : "Generate with Seedance <span>✦ 4</span>";
    toast(error.message);
  }
});

document.querySelector("#confirm-generation").addEventListener("click", async () => {
  if (!promptInput) return;
  showGenerationProgress();
  try {
    const response = await fetch("/api/seedance/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promptInput)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to start Seedance generation.");
    creditCount.textContent = Math.max(0, Number(creditCount.textContent) - 4);
    addPendingProject(body.task.id, "seedance");
    setModalOpen(false);
    switchView("projects");
    toast("Seedance generation started. You can track progress here.");
    pollSeedanceTask(body.task.id);
  } catch (error) {
    document.querySelector("#confirm-generation").disabled = false;
    document.querySelector("#confirm-generation").innerHTML = "Try again <span>→</span>";
    document.querySelector("#seedance-config-note").textContent = error.message;
  }
});

document.querySelector("#close-prompt-modal").addEventListener("click", () => setModalOpen(false));
document.querySelector("#cancel-generation").addEventListener("click", () => setModalOpen(false));
document.querySelector("#another-btn").addEventListener("click", () => setStage("concept", 1));
document.querySelector("#result-back-projects").addEventListener("click", () => switchView("projects"));
document.querySelector("#save-publish-draft").addEventListener("click", () => savePublishing("draft"));
document.querySelector("#schedule-publish").addEventListener("click", () => savePublishing("scheduled"));
document.querySelector("#open-auth-modal").addEventListener("click", () => setAuthModalOpen(true));
document.querySelector("#close-auth-modal").addEventListener("click", () => setAuthModalOpen(false));
document.querySelector("#google-login").addEventListener("click", () => {
  completeLogin({ email: "google.user@reelcraft.local", provider: "google" });
});
document.querySelector("#email-login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  completeLogin({ email: document.querySelector("#login-email").value, provider: "email" });
});
document.querySelector(".credits").addEventListener("click", () => toast("Starter videos are free. Seedance Premium uses 4 credits per clip."));
document.querySelectorAll("[data-view-target]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (link.dataset.viewTarget === "create") {
      startNewProject();
      return;
    }
    switchView(link.dataset.viewTarget);
  });
});
document.querySelectorAll(".project-filter").forEach((button) => {
  button.addEventListener("click", () => {
    projectFilter = button.dataset.projectFilter;
    renderProjects(recentProjects);
  });
});
document.querySelector("#new-project-btn").addEventListener("click", startNewProject);
document.querySelector("#projects-create-btn").addEventListener("click", startNewProject);
document.querySelectorAll(".fake-action").forEach((button) => {
  button.addEventListener("click", () => toast(button.dataset.toast));
});
document.querySelectorAll(".use-idea").forEach((button) => {
  button.addEventListener("click", () => {
    switchView("create");
    setStage("input", 0);
    toast(`“${button.dataset.concept}” added as your creative direction.`);
  });
});

const filterIdeas = () => {
  const query = document.querySelector("#idea-search").value.trim().toLowerCase();
  const activeFilter = document.querySelector("[data-idea-filter].active")?.dataset.ideaFilter || "all";
  let visible = 0;
  document.querySelectorAll("[data-idea-card]").forEach((card) => {
    const matchesFilter = activeFilter === "all" || card.dataset.category.includes(activeFilter);
    const matchesQuery = !query || `${card.textContent} ${card.dataset.keywords}`.toLowerCase().includes(query);
    card.hidden = !(matchesFilter && matchesQuery);
    if (!card.hidden) visible += 1;
  });
  document.querySelector("#idea-count").textContent = `${visible} idea${visible === 1 ? "" : "s"}`;
  document.querySelector("#idea-empty").hidden = visible !== 0;
};

document.querySelector("#idea-search").addEventListener("input", filterIdeas);
document.querySelectorAll("[data-idea-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-idea-filter]").forEach((item) => item.classList.toggle("active", item === button));
    filterIdeas();
  });
});

const filterHelpArticles = (value) => {
  const query = value.trim().toLowerCase();
  const input = document.querySelector("#help-search");
  input.value = value;
  let visible = 0;
  document.querySelectorAll("[data-help-article]").forEach((article) => {
    article.hidden = Boolean(query) && !`${article.textContent} ${article.dataset.keywords}`.toLowerCase().includes(query);
    if (!article.hidden) visible += 1;
  });
  document.querySelector("#help-result-count").textContent = `${visible} article${visible === 1 ? "" : "s"}`;
  document.querySelector("#help-empty").hidden = visible !== 0;
};

document.querySelector("#help-search").addEventListener("input", (event) => filterHelpArticles(event.target.value));
document.querySelectorAll("[data-help-query]").forEach((button) => {
  button.addEventListener("click", () => filterHelpArticles(button.dataset.helpQuery));
});
document.querySelectorAll("[data-help-article]").forEach((article) => {
  article.addEventListener("click", () => toast("Article preview opened. Full documentation content can be connected next."));
});
document.querySelector("#contact-support").addEventListener("click", () => {
  toast("Support request drafted. Email and ticket delivery can be connected next.");
});
document.querySelector("#recent-grid").addEventListener("click", (event) => {
  const card = event.target.closest(".project-card");
  if (card) {
    const project = recentProjects.find((item) => item.id === card.dataset.projectId);
    if (project) showProject(project);
    return;
  }
  if (event.target.closest(".new-project")) startNewProject();
});

renderConcepts();
renderAuthState();
refreshProjects().then(resumePendingGeneration);
const initialView = Object.keys(viewMeta).find((view) => viewMeta[view].hash === window.location.hash) || "create";
switchView(initialView, { updateHash: false });
