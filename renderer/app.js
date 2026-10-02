(() => {
  "use strict";

  const STARTER_PROTOCOL = `You are one of two independent analysts answering the same user question. Your job is to improve the answer through precise, constructive criticism. The user will manually bring replies from the other analyst into this chat.

FIRST RESPONSE
1. Answer the user's question on your own, without assuming what the other analyst will say.
2. Show the reasoning, calculations, evidence, and important assumptions needed to assess your answer. Distinguish established facts from estimates or uncertainty.
3. State any limitation or missing information that could materially change the result.

WHEN THE OTHER ANALYST'S RESPONSE ARRIVES
1. Read it carefully. Check the factual claims, logic, arithmetic, interpretation of the question, and any cited evidence. Look for omissions as well as direct errors.
2. Identify specific, material problems. Quote or paraphrase only enough to locate each problem. Explain why it matters, and offer a correction. Do not manufacture disagreements merely to keep the exchange going.
3. Accept valid corrections to your own earlier answer. If the other analyst is right, say so plainly. Then write a revised, self-contained answer that a reader can use without reading this debate.
4. Where uncertainty remains, say exactly what is uncertain and what would resolve it. Do not turn a plausible guess into a certainty.

END EACH RESPONSE WITH
• Verdict: AGREE ON SUBSTANCE, or MATERIAL DISAGREEMENT.
• Remaining issues: a short list, or “None identified.”
• Revised answer: your best current answer.

Use AGREE ON SUBSTANCE only when you find no material factual, logical, or practical issue with the other analyst's current answer and your revised answer is substantively consistent with it. Agreement is a stopping signal for this exercise, not proof of 100% correctness. Never claim that agreement alone verifies a fact. Keep the critique respectful and focused on the user's question.`;

  const $ = (id) => document.getElementById(id);
  const ui = {
    appShell: $("appShell"), sidebar: $("sidebar"), openSidebar: $("openSidebar"), closeSidebar: $("closeSidebar"),
    modeAuto: $("modeAuto"), modeManual: $("modeManual"), autoWorkspace: $("autoWorkspace"), manualWorkspace: $("manualWorkspace"),
    autoSidebarContent: $("autoSidebarContent"), manualSidebarContent: $("manualSidebarContent"), footerModeText: $("footerModeText"),
    apiDot: $("apiDot"), apiStatus: $("apiStatus"), autoApiKey: $("autoApiKey"), toggleAutoKey: $("toggleAutoKey"), saveAutoKey: $("saveAutoKey"), clearAutoKey: $("clearAutoKey"), autoProviderCodex: $("autoProviderCodex"), autoProviderApi: $("autoProviderApi"), codexProviderStatus: $("codexProviderStatus"),
    autoLeftModel: $("autoLeftModel"), autoLeftEffort: $("autoLeftEffort"), autoRightModel: $("autoRightModel"), autoRightEffort: $("autoRightEffort"), autoModelSuggestions: $("autoModelSuggestions"), autoMaxRounds: $("autoMaxRounds"), autoRoundMinus: $("autoRoundMinus"), autoRoundPlus: $("autoRoundPlus"), autoPrompt: $("autoPrompt"),
    autoRoundDisplay: $("autoRoundDisplay"), autoUsageDisplay: $("autoUsageDisplay"), autoStageBanner: $("autoStageBanner"), autoStageTitle: $("autoStageTitle"), autoStageDetail: $("autoStageDetail"),
    autoLeftMessages: $("autoLeftMessages"), autoRightMessages: $("autoRightMessages"), autoLeftCount: $("autoLeftCount"), autoRightCount: $("autoRightCount"), autoCandidateText: $("autoCandidateText"), autoOpenResult: $("autoOpenResult"),
    autoQuestion: $("autoQuestion"), autoAttachments: $("autoAttachments"), autoAttach: $("autoAttach"), autoClearAttachments: $("autoClearAttachments"), autoStart: $("autoStart"), autoStop: $("autoStop"),
    autoResultScrim: $("autoResultScrim"), autoResultDrawer: $("autoResultDrawer"), autoCloseResult: $("autoCloseResult"), autoResultStatusCard: $("autoResultStatusCard"), autoResultSymbol: $("autoResultSymbol"), autoResultStatus: $("autoResultStatus"), autoResultExplanation: $("autoResultExplanation"), autoResultContent: $("autoResultContent"), autoResultIssues: $("autoResultIssues"), autoIssuesList: $("autoIssuesList"), autoDrawerUsage: $("autoDrawerUsage"), autoCopyAnswer: $("autoCopyAnswer"), autoExportAnswer: $("autoExportAnswer"),
    connectionDot: $("connectionDot"), connectionStatus: $("connectionStatus"), cookieInput: $("cookieInput"), toggleCookie: $("toggleCookie"),
    importCookies: $("importCookies"), clearSession: $("clearSession"), openPages: $("openPages"),
    debatePrompt: $("debatePrompt"), copyProtocol: $("copyProtocol"), sessionNotes: $("sessionNotes"), exportNotes: $("exportNotes"),
    versionLabel: $("versionLabel"), statusPill: $("statusPill"), statusText: $("statusText"), newChats: $("newChats"),
    focusMode: $("focusMode"), focusModeLabel: $("focusModeLabel"),
    stageBanner: $("stageBanner"), stageTitle: $("stageTitle"), stageDetail: $("stageDetail"),
    leftWebSlot: $("leftWebSlot"), rightWebSlot: $("rightWebSlot"), leftPageState: $("leftPageState"), rightPageState: $("rightPageState"),
    reloadLeft: $("reloadLeft"), reloadRight: $("reloadRight"), pasteLeft: $("pasteLeft"), pasteRight: $("pasteRight"),
    questionInput: $("questionInput"), copyQuestion: $("copyQuestion"), inspectClipboard: $("inspectClipboard"),
    clipboardModal: $("clipboardModal"), clipboardText: $("clipboardText"), closeClipboard: $("closeClipboard"), refreshClipboard: $("refreshClipboard"),
    toast: $("toast")
  };

  const state = {
    mode: "auto",
    auto: { hasKey: false, codexAvailable: false, codexLoggedIn: false, provider: "codex", running: false, attachments: [], leftCount: 0, rightCount: 0, round: 0, usage: null, candidate: "", result: null, resultHandled: false },
    manualStage: { title: "Connect your browser session", detail: "Import your session cookies, then open both pages.", tone: "idle" },
    automaticStage: { title: "Checking automatic access", detail: "Use your local Codex account or add an API key.", tone: "idle" },
    hasSession: false,
    pagesOpen: false,
    pageStates: { left: "waiting", right: "waiting" },
    busy: false,
    sidebarCollapsed: window.innerWidth <= 1120,
    focusMode: false,
    clipboardOpen: false,
    lastBounds: "",
    boundsQueue: Promise.resolve(),
    layoutFrame: 0,
    toastTimer: 0
  };

  function getBridge() {
    return window.duet;
  }

  function getAutoBridge() {
    return window.converge && window.converge.auto;
  }

  function errorText(error) {
    if (typeof error === "string") return error;
    if (error && typeof error.message === "string") return error.message;
    return "That action could not be completed. Please try again.";
  }

  function checkResult(result) {
    if (result && result.ok === false) throw new Error(result.message || result.error || "The action did not complete.");
    return result;
  }

  function toast(message, isError = false) {
    clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.toggle("is-error", isError);
    ui.toast.classList.add("is-visible");
    state.toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), isError ? 5500 : 3400);
  }

  function stage(title, detail, tone = "idle") {
    state.manualStage = { title, detail, tone };
    ui.stageTitle.textContent = title;
    ui.stageDetail.textContent = detail;
    ui.stageBanner.classList.toggle("is-running", tone === "running");
    ui.stageBanner.classList.toggle("is-error", tone === "error");
    if (state.mode === "manual") renderTopStatus();
  }

  function autoStage(title, detail, tone = "idle") {
    state.automaticStage = { title, detail, tone };
    ui.autoStageTitle.textContent = title;
    ui.autoStageDetail.textContent = detail;
    ui.autoStageBanner.classList.toggle("is-running", tone === "running");
    ui.autoStageBanner.classList.toggle("is-error", tone === "error");
    if (state.mode === "auto") renderTopStatus();
  }

  function autoProviderReady() {
    return state.auto.provider === "codex"
      ? state.auto.codexAvailable && state.auto.codexLoggedIn
      : state.auto.hasKey;
  }

  function renderTopStatus() {
    const automatic = state.mode === "auto";
    const current = automatic ? state.automaticStage : state.manualStage;
    ui.statusPill.classList.toggle("is-running", current.tone === "running");
    ui.statusPill.classList.toggle("is-error", current.tone === "error");
    ui.statusText.textContent = current.tone === "error" ? "Needs attention" : automatic
      ? state.auto.running ? "Debate running" : state.auto.result ? "Result ready" : autoProviderReady() ? "Ready to begin" : "Connection needed"
      : current.tone === "running" ? "Pages are live" : state.pagesOpen ? "Manual session" : "Ready to set up";
  }

  function setConnected(connected, count) {
    state.hasSession = Boolean(connected);
    ui.connectionDot.classList.toggle("is-connected", state.hasSession);
    ui.connectionStatus.classList.toggle("is-connected", state.hasSession);
    ui.connectionStatus.textContent = state.hasSession
      ? (Number.isInteger(count) && count > 0 ? `${count} session cookie${count === 1 ? "" : "s"} imported` : "Browser session imported")
      : "No browser session imported";
    ui.openPages.disabled = !state.hasSession || state.busy;
    ui.clearSession.disabled = !state.hasSession || state.busy;
    if (!state.hasSession) {
      state.pagesOpen = false;
      setPageState("left", "waiting");
      setPageState("right", "waiting");
    }
    updatePageControls();
    scheduleBounds();
  }

  function updatePageControls() {
    const disabled = !state.pagesOpen || state.busy;
    ui.newChats.disabled = disabled;
    ui.reloadLeft.disabled = disabled;
    ui.reloadRight.disabled = disabled;
    ui.pasteLeft.disabled = disabled;
    ui.pasteRight.disabled = disabled;
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);
    ui.importCookies.disabled = state.busy;
    ui.openPages.disabled = !state.hasSession || state.busy;
    ui.clearSession.disabled = !state.hasSession || state.busy;
    updatePageControls();
  }

  function setPageState(side, pageState, message) {
    const element = side === "left" ? ui.leftPageState : ui.rightPageState;
    if (!element) return;
    state.pageStates[side] = pageState;
    element.classList.toggle("is-live", pageState === "loaded");
    element.textContent = pageState === "loaded" ? "Live" : pageState === "loading" ? "Loading…" : pageState === "error" ? "Error" : "Waiting";
    element.title = message || "";
  }

  function rectFor(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  }

  function updateBounds() {
    const bridge = getBridge();
    if (!bridge || typeof bridge.setViewBounds !== "function") return;
    const sidebarCovering = window.innerWidth <= 1120 && !state.sidebarCollapsed;
    const visible = state.mode === "manual" && state.pagesOpen && !state.clipboardOpen && !sidebarCovering;
    const bounds = visible
      ? { left: rectFor(ui.leftWebSlot), right: rectFor(ui.rightWebSlot) }
      : { left: null, right: null };
    const signature = JSON.stringify(bounds);
    if (signature === state.lastBounds) return;
    state.lastBounds = signature;
    state.boundsQueue = state.boundsQueue.catch(() => {}).then(() => bridge.setViewBounds(bounds));
  }

  function scheduleBounds() {
    if (state.layoutFrame) return;
    state.layoutFrame = requestAnimationFrame(() => {
      state.layoutFrame = 0;
      updateBounds();
    });
  }

  function setSidebarCollapsed(collapsed) {
    state.sidebarCollapsed = Boolean(collapsed);
    ui.appShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    ui.openSidebar.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    ui.openSidebar.setAttribute("aria-label", state.sidebarCollapsed ? "Open controls" : "Close controls");
    ui.openSidebar.title = state.sidebarCollapsed ? "Open controls" : "Close controls";
    scheduleBounds();
    setTimeout(scheduleBounds, 280);
  }

  function setFocusMode(enabled) {
    state.focusMode = Boolean(enabled);
    ui.appShell.classList.toggle("focus-mode", state.focusMode);
    ui.focusMode.setAttribute("aria-pressed", String(state.focusMode));
    ui.focusModeLabel.textContent = state.focusMode ? "Exit focus" : "Focus pages";
    ui.focusMode.title = state.focusMode ? "Show workspace tools" : "Give both pages more room";
    scheduleBounds();
  }

  async function switchMode(mode) {
    if (mode !== "auto" && mode !== "manual") return;
    state.mode = mode;
    const automatic = mode === "auto";
    ui.modeAuto.classList.toggle("is-active", automatic);
    ui.modeManual.classList.toggle("is-active", !automatic);
    ui.modeAuto.setAttribute("aria-pressed", String(automatic));
    ui.modeManual.setAttribute("aria-pressed", String(!automatic));
    ui.autoWorkspace.hidden = !automatic;
    ui.manualWorkspace.hidden = automatic;
    ui.autoSidebarContent.hidden = !automatic;
    ui.manualSidebarContent.hidden = automatic;
    ui.focusMode.hidden = automatic;
    ui.newChats.hidden = automatic;
    ui.footerModeText.textContent = automatic ? "Automatic review. You keep control." : "Manual exchange. You stay in control.";
    ui.sidebar.querySelector(".sidebar-scroll").scrollTop = 0;
    if (!automatic) closeAutoResult(false);
    renderTopStatus();
    scheduleBounds();
    try {
      if (window.converge && typeof window.converge.setMode === "function") await window.converge.setMode(mode);
    } catch (error) {
      toast(errorText(error), true);
    }
    scheduleBounds();
  }

  async function importCookies() {
    const text = ui.cookieInput.value.trim();
    if (!text) {
      toast("Paste your session cookies first.", true);
      ui.cookieInput.focus();
      return;
    }
    setBusy(true);
    try {
      const result = checkResult(await getBridge().importCookies({ text }));
      ui.cookieInput.value = "";
      ui.cookieInput.classList.remove("is-visible");
      ui.toggleCookie.textContent = "Show";
      ui.toggleCookie.setAttribute("aria-label", "Show cookie text");
      setConnected(true, result && result.count);
      stage("Session imported", "Open both pages, then select Temporary Chat in each page.");
      toast("Session imported. Open both pages when ready.");
    } catch (error) {
      stage("Session import failed", errorText(error), "error");
      toast(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function clearSession() {
    const pagesWereOpen = state.pagesOpen;
    state.pagesOpen = false;
    scheduleBounds();
    setBusy(true);
    try {
      checkResult(await getBridge().clearSession());
      setConnected(false);
      stage("Browser session cleared", "Import session cookies to open two new pages.");
      toast("Session cleared from this app.");
    } catch (error) {
      state.pagesOpen = pagesWereOpen;
      scheduleBounds();
      stage("Could not clear the session", errorText(error), "error");
      toast(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function openPages() {
    if (!state.hasSession) {
      toast("Import a browser session first.", true);
      return;
    }
    state.pagesOpen = true;
    setPageState("left", "loading");
    setPageState("right", "loading");
    setBusy(true);
    scheduleBounds();
    try {
      const result = checkResult(await getBridge().openPages());
      if (result && result.failed) {
        stage("One page needs attention", "Reload the page with an error, then select Temporary Chat in both pages.", "error");
      } else if (state.pageStates.left === "loaded" && state.pageStates.right === "loaded") {
        stage("Both pages are ready for your review", "Select Temporary Chat in each page, then paste the starter protocol.", "running");
      } else {
        stage("Two pages are opening", "Select Temporary Chat in each page, then paste the starter protocol.", "running");
      }
      updatePageControls();
      if (window.innerWidth <= 1120) setSidebarCollapsed(true);
      scheduleBounds();
      toast("Pages opened. Choose Temporary Chat in both pages.");
    } catch (error) {
      state.pagesOpen = false;
      scheduleBounds();
      stage("Could not open pages", errorText(error), "error");
      toast(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function newChats() {
    if (!state.pagesOpen) return;
    setPageState("left", "loading");
    setPageState("right", "loading");
    setBusy(true);
    try {
      const result = checkResult(await getBridge().newChats());
      stage(result && result.failed ? "One page needs attention" : "New chats are ready for your review", "Select Temporary Chat again in each page before sharing a question.", result && result.failed ? "error" : "running");
      toast("New chats opened. Check Temporary Chat in both pages.");
    } catch (error) {
      stage("Could not start new chats", errorText(error), "error");
      toast(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function reloadPage(side) {
    if (!state.pagesOpen) return;
    try {
      setPageState(side, "loading");
      checkResult(await getBridge().reloadPage(side));
      toast(`Reloading analyst ${side === "left" ? "A" : "B"}…`);
    } catch (error) {
      setPageState(side, "error", errorText(error));
      toast(errorText(error), true);
    }
  }

  async function pasteTo(side) {
    if (!state.pagesOpen) return;
    try {
      checkResult(await getBridge().pasteTo(side));
      toast(`Pasted into analyst ${side === "left" ? "A" : "B"}. Review the text before sending.`);
    } catch (error) {
      toast(errorText(error), true);
    }
  }

  async function copyText(text, emptyMessage, successMessage) {
    const content = text.trim();
    if (!content) {
      toast(emptyMessage, true);
      return;
    }
    try {
      checkResult(await getBridge().copy(content));
      toast(successMessage);
    } catch (error) {
      toast(errorText(error), true);
    }
  }

  async function exportNotes() {
    const notes = ui.sessionNotes.value.trim();
    if (!notes) {
      toast("Write your final notes before exporting.", true);
      ui.sessionNotes.focus();
      return;
    }
    const question = ui.questionInput.value.trim();
    const content = `# Converge session notes\n\n${question ? `## Question\n\n${question}\n\n` : ""}## My conclusion and open questions\n\n${notes}\n`;
    try {
      if (typeof getBridge().saveText === "function") {
        const result = checkResult(await getBridge().saveText({ content, defaultName: "converge-notes.md" }));
        if (result && result.saved === false) return;
        toast("Notes exported.");
      } else {
        checkResult(await getBridge().copy(content));
        toast("Notes copied to clipboard.");
      }
    } catch (error) {
      toast(errorText(error), true);
    }
  }

  function clampRounds(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.max(1, Math.min(20, number)) : 6;
  }

  function autoSettings() {
    return {
      left: { model: ui.autoLeftModel.value.trim(), effort: ui.autoLeftEffort.value },
      right: { model: ui.autoRightModel.value.trim(), effort: ui.autoRightEffort.value },
      maxRounds: clampRounds(ui.autoMaxRounds.value),
      debatePrompt: ui.autoPrompt.value.trim()
    };
  }

  function saveAutoSettings() {
    ui.autoMaxRounds.value = String(clampRounds(ui.autoMaxRounds.value));
    ui.autoRoundDisplay.textContent = `${state.auto.round || "—"} / ${ui.autoMaxRounds.value}`;
    try { localStorage.setItem("converge.autoSettings", JSON.stringify({ ...autoSettings(), provider: state.auto.provider })); } catch { /* Storage may be unavailable. */ }
  }

  function restoreAutoSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("converge.autoSettings") || "null");
      if (!saved || typeof saved !== "object") return;
      if (typeof saved.left?.model === "string") ui.autoLeftModel.value = saved.left.model;
      if (typeof saved.right?.model === "string") ui.autoRightModel.value = saved.right.model;
      const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
      if (efforts.includes(saved.left?.effort)) ui.autoLeftEffort.value = saved.left.effort;
      if (efforts.includes(saved.right?.effort)) ui.autoRightEffort.value = saved.right.effort;
      ui.autoMaxRounds.value = String(clampRounds(saved.maxRounds));
      if (typeof saved.debatePrompt === "string") ui.autoPrompt.value = saved.debatePrompt;
      if (saved.provider === "api" || saved.provider === "codex") state.auto.provider = saved.provider;
    } catch { /* Start with defaults. */ }
    ui.autoRoundDisplay.textContent = `— / ${clampRounds(ui.autoMaxRounds.value)}`;
  }

  function setAutoProvider(provider, save = true) {
    if (provider !== "codex" && provider !== "api") return;
    state.auto.provider = provider;
    ui.autoProviderCodex.checked = provider === "codex";
    ui.autoProviderApi.checked = provider === "api";
    ui.apiDot.classList.toggle("is-connected", autoProviderReady());
    ui.apiStatus.classList.toggle("is-connected", autoProviderReady());
    ui.apiStatus.textContent = provider === "codex"
      ? state.auto.codexLoggedIn ? "Codex account is ready" : state.auto.codexAvailable ? "Codex CLI needs sign-in" : "Codex CLI is unavailable"
      : state.auto.hasKey ? "API key is ready" : "Add an API key below";
    if (!state.auto.running && !state.auto.result) {
      if (autoProviderReady()) autoStage("Ready for a new debate", "Ask a question and set a round limit. You can stop the run at any time.");
      else autoStage(provider === "codex" ? "Codex account needs attention" : "Add an API key to begin", provider === "codex" ? "Sign in to the local Codex CLI, or choose the API key route." : "The API key route is separate from browser cookies.", "error");
    }
    updateAutoControls();
    if (save) saveAutoSettings();
  }

  function applyAutoAuth(status) {
    state.auto.hasKey = Boolean(status && status.hasKey);
    state.auto.codexAvailable = Boolean(status && status.codexAvailable);
    state.auto.codexLoggedIn = Boolean(status && status.codexLoggedIn);
    ui.codexProviderStatus.textContent = state.auto.codexLoggedIn ? "Signed in on this computer" : state.auto.codexAvailable ? "Sign in with the Codex CLI first" : "Codex CLI not found";
    ui.autoProviderCodex.disabled = !state.auto.codexAvailable;
    ui.clearAutoKey.disabled = !state.auto.hasKey;
    if (!state.auto.codexAvailable && state.auto.provider === "codex") state.auto.provider = "api";
    setAutoProvider(state.auto.provider, false);
  }

  async function refreshAutoAuth() {
    const bridge = getAutoBridge();
    if (!bridge || typeof bridge.getAuthStatus !== "function") {
      applyAutoAuth({});
      autoStage("Automatic engine unavailable", "This build does not expose the automatic debate engine.", "error");
      return;
    }
    try { applyAutoAuth(await bridge.getAuthStatus()); }
    catch (error) { autoStage("Could not check automatic access", errorText(error), "error"); }
  }

  async function saveAutoKey() {
    const key = ui.autoApiKey.value.trim();
    if (!key) { toast("Enter an API key first.", true); ui.autoApiKey.focus(); return; }
    ui.saveAutoKey.disabled = true;
    try {
      checkResult(await getAutoBridge().setApiKey(key));
      ui.autoApiKey.value = "";
      ui.autoApiKey.type = "password";
      ui.toggleAutoKey.textContent = "Show";
      state.auto.hasKey = true;
      setAutoProvider("api");
      toast("API key set for this app session.");
    } catch (error) { toast(errorText(error), true); }
    finally { ui.saveAutoKey.disabled = false; }
  }

  async function clearAutoKey() {
    try {
      checkResult(await getAutoBridge().clearApiKey());
      state.auto.hasKey = false;
      applyAutoAuth({ hasKey: false, codexAvailable: state.auto.codexAvailable, codexLoggedIn: state.auto.codexLoggedIn });
      toast("API key removed.");
    } catch (error) { toast(errorText(error), true); }
  }

  function updateAutoControls() {
    ui.autoStart.disabled = state.auto.running || !autoProviderReady();
    ui.autoStart.hidden = state.auto.running;
    ui.autoStop.hidden = !state.auto.running;
    ui.autoStop.disabled = !state.auto.running;
    ui.autoAttach.disabled = state.auto.running;
    ui.autoClearAttachments.disabled = state.auto.running;
    ui.autoProviderCodex.disabled = state.auto.running || !state.auto.codexAvailable;
    ui.autoProviderApi.disabled = state.auto.running;
  }

  function formatBytes(size) {
    if (!Number.isFinite(size) || size < 0) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderAutoAttachments() {
    ui.autoAttachments.replaceChildren();
    for (const item of state.auto.attachments) {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      const icon = document.createElement("span");
      icon.className = "chip-icon";
      icon.textContent = String(item.type || "").startsWith("image/") ? "▧" : "▤";
      const name = document.createElement("span");
      name.className = "chip-name";
      name.textContent = item.name || "Attachment";
      name.title = `${item.name || "Attachment"}${Number.isFinite(item.size) ? ` · ${formatBytes(item.size)}` : ""}`;
      chip.append(icon, name);
      ui.autoAttachments.append(chip);
    }
    ui.autoClearAttachments.hidden = state.auto.attachments.length === 0;
  }

  async function chooseAutoAttachments() {
    try {
      const selected = await getAutoBridge().chooseAttachments();
      if (!Array.isArray(selected)) return;
      state.auto.attachments = selected.filter((item) => item && typeof item.id === "string");
      renderAutoAttachments();
      if (selected.length) toast(`${selected.length} file${selected.length === 1 ? "" : "s"} ready for both analysts.`);
    } catch (error) { toast(errorText(error), true); }
  }

  async function clearAutoAttachments() {
    try {
      checkResult(await getAutoBridge().clearAttachments());
      state.auto.attachments = [];
      renderAutoAttachments();
      toast("Attachments cleared.");
    } catch (error) { toast(errorText(error), true); }
  }

  function appendInline(parent, value) {
    const text = String(value || "");
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let previous = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > previous) parent.append(document.createTextNode(text.slice(previous, match.index)));
      const token = match[0];
      const node = document.createElement(token.startsWith("**") ? "strong" : "code");
      node.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
      parent.append(node);
      previous = match.index + token.length;
    }
    if (previous < text.length) parent.append(document.createTextNode(text.slice(previous)));
  }

  function renderRichText(container, value) {
    container.replaceChildren();
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    let code = null;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const node = document.createElement("p");
      appendInline(node, paragraph.join("\n"));
      container.append(node);
      paragraph = [];
    };
    const flushCode = () => {
      if (code === null) return;
      const pre = document.createElement("pre");
      const inner = document.createElement("code");
      inner.textContent = code.join("\n");
      pre.append(inner);
      container.append(pre);
      code = null;
    };
    for (const line of lines) {
      if (/^\s*```/.test(line)) { flushParagraph(); list = null; if (code === null) code = []; else flushCode(); continue; }
      if (code !== null) { code.push(line); continue; }
      if (!line.trim()) { flushParagraph(); list = null; continue; }
      const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph(); list = null;
        const node = document.createElement(`h${heading[1].length}`);
        appendInline(node, heading[2]);
        container.append(node);
        continue;
      }
      const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (bullet || numbered) {
        flushParagraph();
        const kind = bullet ? "ul" : "ol";
        if (!list || list.tagName.toLowerCase() !== kind) { list = document.createElement(kind); container.append(list); }
        const item = document.createElement("li");
        appendInline(item, (bullet || numbered)[1]);
        list.append(item);
        continue;
      }
      list = null;
      paragraph.push(line);
    }
    flushParagraph();
    flushCode();
    if (!container.childNodes.length) {
      const empty = document.createElement("p");
      empty.textContent = "No answer was returned.";
      container.append(empty);
    }
  }

  function setAutoRound(round) {
    const number = Math.trunc(Number(round));
    if (Number.isFinite(number) && number > 0) state.auto.round = number;
    ui.autoRoundDisplay.textContent = `${state.auto.round || "—"} / ${clampRounds(ui.autoMaxRounds.value)}`;
  }

  function formatUsage(usage) {
    if (!usage || typeof usage !== "object") return "—";
    const input = Number(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens);
    const output = Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens);
    let total = Number(usage.totalTokens ?? usage.total_tokens);
    if (!Number.isFinite(total) && Number.isFinite(input) && Number.isFinite(output)) total = input + output;
    if (Number.isFinite(total) && total > 0) return `${Math.round(total).toLocaleString()} tokens`;
    const calls = Number(usage.calls);
    return Number.isFinite(calls) && calls > 0 ? `${calls} model call${calls === 1 ? "" : "s"}` : "—";
  }

  function renderAutoUsage(usage) {
    state.auto.usage = usage;
    const label = formatUsage(usage);
    ui.autoUsageDisplay.textContent = label === "—" ? "—" : label.replace(" tokens", "");
    ui.autoDrawerUsage.textContent = label;
  }

  function addAutoMessage(message) {
    if (!message || (message.side !== "left" && message.side !== "right")) return;
    const side = message.side;
    const area = side === "left" ? ui.autoLeftMessages : ui.autoRightMessages;
    if (area.querySelector(".empty-panel")) area.replaceChildren();
    const card = document.createElement("article");
    card.className = "message-card";
    card.dataset.role = String(message.role || "draft");
    const head = document.createElement("div");
    head.className = "message-head";
    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent = ({ draft: "Initial answer", review: "Challenge and revision", verify: "Independent check" })[message.role] || String(message.role || "Answer");
    const round = document.createElement("span");
    round.className = "message-round";
    round.textContent = `ROUND ${Number.isFinite(Number(message.round)) ? Math.max(1, Math.trunc(Number(message.round))) : state.auto.round || 1}`;
    head.append(role, round);
    const body = document.createElement("div");
    body.className = "message-body rich-text";
    renderRichText(body, message.text);
    card.append(head, body);
    area.append(card);
    area.scrollTop = area.scrollHeight;
    state.auto[side === "left" ? "leftCount" : "rightCount"] += 1;
    const count = state.auto[side === "left" ? "leftCount" : "rightCount"];
    (side === "left" ? ui.autoLeftCount : ui.autoRightCount).textContent = `${count} note${count === 1 ? "" : "s"}`;
    setAutoRound(message.round);
  }

  function renderCandidate(text) {
    state.auto.candidate = String(text || "").trim();
    ui.autoCandidateText.textContent = state.auto.candidate || "The answer taking shape will appear here as the exchange progresses.";
    ui.autoOpenResult.disabled = !state.auto.candidate && !state.auto.result;
    if (ui.autoResultDrawer.classList.contains("is-open") && !state.auto.result) {
      ui.autoResultStatus.textContent = "Working answer";
      ui.autoResultExplanation.textContent = "The analysts are still reviewing this candidate.";
      renderRichText(ui.autoResultContent, state.auto.candidate);
    }
  }

  function resetAutoRun() {
    const run = state.auto;
    run.leftCount = 0; run.rightCount = 0; run.round = 0; run.usage = null; run.candidate = ""; run.result = null; run.resultHandled = false;
    ui.autoLeftMessages.replaceChildren();
    ui.autoRightMessages.replaceChildren();
    ui.autoLeftCount.textContent = "0 notes";
    ui.autoRightCount.textContent = "0 notes";
    ui.autoRoundDisplay.textContent = `— / ${clampRounds(ui.autoMaxRounds.value)}`;
    ui.autoUsageDisplay.textContent = "—";
    ui.autoDrawerUsage.textContent = "—";
    renderCandidate("");
    ui.autoCopyAnswer.disabled = true;
    ui.autoExportAnswer.disabled = true;
    closeAutoResult(false);
  }

  function resultStatus(result) {
    const status = String(result?.status || "").toLowerCase();
    if (/agree|consensus|converg/.test(status)) return { title: "Substantive agreement", detail: "Both analysts accepted the same answer. Agreement does not guarantee correctness.", symbol: "✓", limited: false };
    if (/stop|abort|cancel/.test(status)) return { title: "Stopped by you", detail: "This is the best available answer from the interrupted exchange.", symbol: "■", limited: true };
    if (/limit|round|max/.test(status)) return { title: "Round limit reached", detail: "The analysts did not reach full substantive agreement within your limit.", symbol: "◷", limited: true };
    if (status === "stalled") return { title: "Review stalled", detail: "The analysts repeated the same position. Review the remaining issues yourself.", symbol: "◇", limited: true };
    if (status === "error") return { title: "Debate interrupted", detail: result.error || "The model connection stopped before verification finished.", symbol: "!", limited: true };
    return { title: "Review complete", detail: "Read the answer and any unresolved issues before using it.", symbol: "◇", limited: Boolean(result?.issues?.length) };
  }

  function finalizeAutoRun(rawResult) {
    if (state.auto.resultHandled) return;
    const result = rawResult?.result && !rawResult.answer ? rawResult.result : rawResult;
    if (!result || typeof result !== "object") return;
    state.auto.resultHandled = true;
    state.auto.running = false;
    state.auto.result = result;
    updateAutoControls();
    if (Array.isArray(result.transcript) && state.auto.leftCount + state.auto.rightCount === 0) {
      for (const message of result.transcript) addAutoMessage(message);
    }
    setAutoRound(result.rounds);
    if (result.usage) renderAutoUsage(result.usage);
    const answer = String(result.answer || state.auto.candidate || "").trim();
    renderCandidate(answer);
    const summary = resultStatus(result);
    ui.autoResultStatusCard.classList.toggle("is-limited", summary.limited);
    ui.autoResultSymbol.textContent = summary.symbol;
    ui.autoResultStatus.textContent = summary.title;
    ui.autoResultExplanation.textContent = summary.detail;
    renderRichText(ui.autoResultContent, answer);
    const openIssues = Array.isArray(result.issues) ? result.issues.filter((issue) => issue.status !== "resolved") : [];
    ui.autoResultIssues.hidden = openIssues.length === 0;
    ui.autoIssuesList.replaceChildren();
    for (const issue of openIssues) {
      const node = document.createElement("li");
      node.textContent = typeof issue === "string" ? issue : String(issue?.problem || issue?.text || issue?.issue || issue?.description || "Unresolved issue");
      ui.autoIssuesList.append(node);
    }
    ui.autoCopyAnswer.disabled = !answer;
    ui.autoExportAnswer.disabled = !answer;
    ui.autoOpenResult.disabled = !answer;
    autoStage(summary.title, summary.detail, summary.limited ? "idle" : "idle");
    if (state.mode === "auto") openAutoResult();
  }

  function openAutoResult() {
    if (!state.auto.candidate && !state.auto.result) return;
    ui.autoResultScrim.hidden = false;
    ui.autoResultDrawer.classList.add("is-open");
    ui.autoResultDrawer.setAttribute("aria-hidden", "false");
    ui.autoCloseResult.focus();
  }

  function closeAutoResult(restoreFocus = true) {
    ui.autoResultDrawer.classList.remove("is-open");
    ui.autoResultDrawer.setAttribute("aria-hidden", "true");
    ui.autoResultScrim.hidden = true;
    if (restoreFocus) ui.autoOpenResult.focus();
  }

  async function copyAutoAnswer() {
    const answer = String(state.auto.result?.answer || state.auto.candidate || "").trim();
    if (!answer) return;
    try {
      checkResult(await getBridge().copy(answer));
      toast("Answer copied.");
    } catch (error) { toast(errorText(error), true); }
  }

  async function exportAutoAnswer() {
    const result = state.auto.result;
    const answer = String(result?.answer || state.auto.candidate || "").trim();
    if (!answer) return;
    const openIssues = Array.isArray(result?.issues) ? result.issues.filter((issue) => issue.status !== "resolved") : [];
    const issueText = openIssues.length ? `\n\n## Open issues\n\n${openIssues.map((issue) => `- ${issue.problem || issue.text || "Unresolved issue"}`).join("\n")}` : "";
    const content = `# Converge answer\n\n## Question\n\n${ui.autoQuestion.value.trim()}\n\n## Result\n\n${resultStatus(result || {}).title}\n\n## Answer\n\n${answer}${issueText}\n`;
    try {
      const saved = checkResult(await getBridge().saveText({ content, defaultName: "converge-answer.md" }));
      if (saved?.saved) toast("Answer exported.");
    } catch (error) { toast(errorText(error), true); }
  }

  async function startAutoRun() {
    if (state.auto.running) return;
    const question = ui.autoQuestion.value.trim();
    if (!question) { toast("Write your question first.", true); ui.autoQuestion.focus(); return; }
    if (!autoProviderReady()) { toast("Choose a ready automatic connection.", true); return; }
    saveAutoSettings();
    resetAutoRun();
    state.auto.running = true;
    updateAutoControls();
    autoStage("Starting independent answers", "Both analysts are forming their first answer.", "running");
    try {
      const result = await getAutoBridge().start({
        provider: state.auto.provider,
        question,
        attachments: state.auto.attachments.map((item) => item.id),
        settings: autoSettings()
      });
      finalizeAutoRun(result);
    } catch (error) {
      state.auto.running = false;
      updateAutoControls();
      autoStage("Could not finish the debate", errorText(error), "error");
      toast(errorText(error), true);
    }
  }

  async function stopAutoRun() {
    if (!state.auto.running) return;
    autoStage("Stopping the debate", "The current model request is being cancelled.", "running");
    try { checkResult(await getAutoBridge().stop()); }
    catch (error) { toast(errorText(error), true); }
  }

  function handleAutoEvent(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "stage") {
      setAutoRound(event.round);
      autoStage(String(event.text || "Review in progress"), "The analysts are checking and revising the same answer.", "running");
    } else if (event.type === "message") {
      addAutoMessage(event);
    } else if (event.type === "candidate") {
      renderCandidate(event.text);
    } else if (event.type === "usage") {
      renderAutoUsage(event.usage);
    } else if (event.type === "done") {
      finalizeAutoRun(event.result);
    } else if (event.type === "error") {
      autoStage("Debate error", String(event.text || "The automatic connection failed."), "error");
    }
  }

  async function refreshClipboard() {
    try {
      const result = await getBridge().getClipboard();
      const content = typeof result === "string" ? result : result && typeof result.text === "string" ? result.text : "";
      ui.clipboardText.textContent = content || "(Clipboard is empty.)";
    } catch (error) {
      ui.clipboardText.textContent = `Could not read the clipboard: ${errorText(error)}`;
    }
  }

  async function openClipboard() {
    if (typeof getBridge().getClipboard !== "function") {
      toast("Clipboard preview is unavailable in this build.", true);
      return;
    }
    state.clipboardOpen = true;
    ui.clipboardModal.hidden = false;
    scheduleBounds();
    await refreshClipboard();
    ui.closeClipboard.focus();
  }

  function closeClipboard() {
    state.clipboardOpen = false;
    ui.clipboardModal.hidden = true;
    ui.clipboardText.textContent = "";
    scheduleBounds();
    ui.inspectClipboard.focus();
  }

  function handleEvent(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "page" && (event.side === "left" || event.side === "right")) {
      if (!state.pagesOpen || !state.hasSession) return;
      setPageState(event.side, event.state, event.message);
      if (event.state === "error") {
        stage(`${event.side === "left" ? "Left" : "Right"} page needs attention`, event.message || "Reload that page or reimport your session.", "error");
      } else if (event.state === "loaded") {
        if (state.pageStates.left === "loaded" && state.pageStates.right === "loaded") {
          stage("Both pages are ready for your review", "Select Temporary Chat in each page. Copy and paste messages only when you choose.", "running");
        } else {
          stage("One page is ready", "The other page is still loading. Select Temporary Chat in each page.", "running");
        }
      }
    } else if (event.type === "session") {
      if (event.state === "cleared") {
        state.pagesOpen = false;
        setConnected(false);
        stage("Browser session cleared", "Import a session to open two pages.");
      } else if (event.state === "imported") {
        setConnected(true, event.count);
      }
    } else if (event.type === "error") {
      stage("Something needs attention", event.message || "Please try again.", "error");
      toast(event.message || "An error occurred.", true);
    }
  }

  function bindEvents() {
    ui.openSidebar.addEventListener("click", () => setSidebarCollapsed(!state.sidebarCollapsed));
    ui.closeSidebar.addEventListener("click", () => setSidebarCollapsed(true));
    ui.modeAuto.addEventListener("click", () => switchMode("auto"));
    ui.modeManual.addEventListener("click", () => switchMode("manual"));
    ui.autoProviderCodex.addEventListener("change", () => setAutoProvider("codex"));
    ui.autoProviderApi.addEventListener("change", () => setAutoProvider("api"));
    ui.toggleAutoKey.addEventListener("click", () => {
      const showing = ui.autoApiKey.type === "password";
      ui.autoApiKey.type = showing ? "text" : "password";
      ui.toggleAutoKey.textContent = showing ? "Hide" : "Show";
    });
    ui.saveAutoKey.addEventListener("click", saveAutoKey);
    ui.clearAutoKey.addEventListener("click", clearAutoKey);
    ui.autoAttach.addEventListener("click", chooseAutoAttachments);
    ui.autoClearAttachments.addEventListener("click", clearAutoAttachments);
    ui.autoStart.addEventListener("click", startAutoRun);
    ui.autoStop.addEventListener("click", stopAutoRun);
    ui.autoRoundMinus.addEventListener("click", () => { ui.autoMaxRounds.value = String(clampRounds(Number(ui.autoMaxRounds.value) - 1)); saveAutoSettings(); });
    ui.autoRoundPlus.addEventListener("click", () => { ui.autoMaxRounds.value = String(clampRounds(Number(ui.autoMaxRounds.value) + 1)); saveAutoSettings(); });
    for (const field of [ui.autoLeftModel, ui.autoLeftEffort, ui.autoRightModel, ui.autoRightEffort, ui.autoMaxRounds, ui.autoPrompt]) field.addEventListener("change", saveAutoSettings);
    ui.autoOpenResult.addEventListener("click", openAutoResult);
    ui.autoCloseResult.addEventListener("click", () => closeAutoResult());
    ui.autoResultScrim.addEventListener("click", () => closeAutoResult());
    ui.autoCopyAnswer.addEventListener("click", copyAutoAnswer);
    ui.autoExportAnswer.addEventListener("click", exportAutoAnswer);
    ui.focusMode.addEventListener("click", () => setFocusMode(!state.focusMode));
    ui.toggleCookie.addEventListener("click", () => {
      const showing = ui.cookieInput.classList.toggle("is-visible");
      ui.toggleCookie.textContent = showing ? "Hide" : "Show";
      ui.toggleCookie.setAttribute("aria-label", showing ? "Hide cookie text" : "Show cookie text");
    });
    ui.importCookies.addEventListener("click", importCookies);
    ui.clearSession.addEventListener("click", clearSession);
    ui.openPages.addEventListener("click", openPages);
    ui.newChats.addEventListener("click", newChats);
    ui.reloadLeft.addEventListener("click", () => reloadPage("left"));
    ui.reloadRight.addEventListener("click", () => reloadPage("right"));
    ui.pasteLeft.addEventListener("click", () => pasteTo("left"));
    ui.pasteRight.addEventListener("click", () => pasteTo("right"));
    ui.copyProtocol.addEventListener("click", () => copyText(ui.debatePrompt.value, "Write a starter protocol first.", "Starter protocol copied. Paste it into both pages."));
    ui.copyQuestion.addEventListener("click", () => copyText(ui.questionInput.value, "Write a question first.", "Question copied. Paste it into both pages."));
    ui.exportNotes.addEventListener("click", exportNotes);
    ui.inspectClipboard.addEventListener("click", openClipboard);
    ui.closeClipboard.addEventListener("click", closeClipboard);
    ui.refreshClipboard.addEventListener("click", refreshClipboard);
    ui.clipboardModal.addEventListener("click", (event) => { if (event.target === ui.clipboardModal) closeClipboard(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.clipboardOpen) closeClipboard();
      else if (event.key === "Escape" && ui.autoResultDrawer.classList.contains("is-open")) closeAutoResult();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && document.activeElement === ui.autoQuestion) {
        event.preventDefault();
        startAutoRun();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && document.activeElement === ui.questionInput) {
        event.preventDefault();
        ui.copyQuestion.click();
      }
    });
    window.addEventListener("resize", scheduleBounds);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(scheduleBounds);
      observer.observe(ui.leftWebSlot);
      observer.observe(ui.rightWebSlot);
    }
    ui.debatePrompt.addEventListener("input", () => {
      try { localStorage.setItem("converge.starterProtocol", ui.debatePrompt.value); } catch { /* Storage may be unavailable. */ }
    });
  }

  async function initialize() {
    bindEvents();
    restoreAutoSettings();
    setSidebarCollapsed(state.sidebarCollapsed);
    try {
      ui.debatePrompt.value = localStorage.getItem("converge.starterProtocol") || STARTER_PROTOCOL;
    } catch {
      ui.debatePrompt.value = STARTER_PROTOCOL;
    }
    if (!getBridge()) {
      stage("Desktop bridge unavailable", "Open this workspace through the Converge desktop app.", "error");
      ui.importCookies.disabled = true;
      return;
    }
    if (getAutoBridge() && typeof getAutoBridge().onEvent === "function") getAutoBridge().onEvent(handleAutoEvent);
    await switchMode("auto");
    await refreshAutoAuth();
    ui.inspectClipboard.hidden = typeof getBridge().getClipboard !== "function";
    try {
      const bootstrap = await getBridge().getBootstrap();
      ui.versionLabel.textContent = bootstrap && bootstrap.version ? `v${bootstrap.version}` : "v—";
      setConnected(Boolean(bootstrap && bootstrap.hasSession));
      if (state.hasSession) stage("Browser session is ready", "Open two pages, then select Temporary Chat in each page.");
      else stage("Connect your browser session", "Import your session cookies, then open both pages.");
      if (typeof getBridge().onEvent === "function") getBridge().onEvent(handleEvent);
    } catch (error) {
      stage("Could not load the workspace", errorText(error), "error");
      toast(errorText(error), true);
    }
  }

  initialize();
})();
