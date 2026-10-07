'use strict';

// Local project operations are owned by the desktop shell. Browser pages never
// receive disk paths, project archives, account data or execution permissions.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createProjectStore, runVerificationLab, prepareDeliveryPackage, writeDeliveryPackage, sanitizeSnapshot } = require('../studio-services');
const { atomicWrite } = require('../studio-services/project-store');
const { isStoredFile, readFileHead, copyStoredFile } = require('../browser/file-store');
const { MAX_ARCHIVE_BYTES, sha256, decodeFile } = require('../studio-services/identity');
const { declaredImageSize } = require('../studio-services/verification-lab');
const { validateSavedProject } = require('../browser/boss-coordinator');

function createStudioDesktop({ directory, dialogs, shell, nativeImage, nodeExecutable = process.execPath,
  pythonExecutable = process.platform === 'win32' ? 'python' : 'python3', onChange = () => {}, verificationRunner = runVerificationLab }) {
  const store = createProjectStore({ directory });
  let coordinator;
  let info = { id: null, name: '', status: 'unsaved', savedAt: null, error: '' };
  let latestSnapshot = null;
  let saveWorker = null;
  let lastTaskKey = '';
  let projectEpoch = 0;
  let closed = false;
  let operationBusy = false;
  const previewDirectories = new Set();
  const verificationJobs = new Map();
  const fileJobs = new Map();
  async function fileOperation(operation) {
    active(); const controller = new AbortController(), pending = Promise.resolve().then(() => operation(controller.signal)); fileJobs.set(pending, controller);
    try { return await pending; } finally { fileJobs.delete(pending); }
  }
  const title = value => String(value || 'Untitled project').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100) || 'Untitled project';
  const taskKey = snapshot => `${snapshot.state?.studio?.contract?.createdAt || ''}\u0000${snapshot.state?.question || ''}`;
  const snapshotKey = snapshot => {
    const { savedAt: _savedAt, ...content } = sanitizeSnapshot(snapshot);
    return sha256(JSON.stringify(content));
  };
  const active = () => { if (closed) throw new Error('This project workspace is closed.'); };
  const changed = () => { try { Promise.resolve(onChange({ ...info })).catch(() => {}); } catch (_) {} };

  async function saveSnapshot(snapshot, name, epoch = projectEpoch, { saveAs = false } = {}) {
    const destination = { id: saveAs ? undefined : info.id || undefined, name: title(name || info.name || snapshot.state?.question) };
    const saved = await store.save({ ...destination, snapshot });
    if (epoch === projectEpoch) {
      info = { id: saved.id, name: saved.name, status: 'saved', savedAt: saved.savedAt || saved.updatedAt || new Date().toISOString(), error: '' };
      changed();
    }
    return saved;
  }
  function checkpoint(snapshot) {
    if (closed) return;
    if (!snapshot?.state?.question) {
      if (lastTaskKey) {
        projectEpoch += 1; lastTaskKey = ''; latestSnapshot = null;
        info = { id: null, name: '', status: 'unsaved', savedAt: null, error: '' }; changed();
      }
      return;
    }
    const nextTaskKey = taskKey(snapshot);
    if (lastTaskKey && lastTaskKey !== nextTaskKey) { projectEpoch += 1; info = { id: null, name: '', status: 'unsaved', savedAt: null, error: '' }; }
    lastTaskKey = nextTaskKey;
    latestSnapshot = { snapshot, epoch: projectEpoch };
    if (saveWorker) return;
    info.status = 'saving'; changed();
    saveWorker = (async () => {
      while (latestSnapshot) {
        const next = latestSnapshot; latestSnapshot = null;
        if (next.epoch !== projectEpoch) continue;
        try { await saveSnapshot(next.snapshot, undefined, next.epoch); }
        catch (error) { if (next.epoch === projectEpoch) { info.status = 'error'; info.error = String(error?.message || error).slice(0, 500); changed(); } }
      }
    })().finally(() => { saveWorker = null; });
  }
  async function flush() { while (saveWorker) await saveWorker; }
  const state = async () => ({ ...(await coordinator.getState()), projectInfo: { ...info } });
  const result = async value => ({ ok: true, ...value, state: await state() });
  async function mutation(operation) {
    const response = await operation();
    if (response?.ok === false) throw new Error(response.error || 'This project action could not be completed.');
    return result();
  }
  const checkIdle = async () => {
    if ((await coordinator.getState()).status === 'running') throw new Error('Stop the current task before changing its saved project or selected revision.');
  };
  async function saveProject(payload = {}) {
    await flush();
    active();
    const epoch = projectEpoch;
    const snapshot = await coordinator.exportProject();
    active();
    if (!snapshot?.state?.question) throw new Error('Start a task before saving its project.');
    info.status = 'saving'; changed();
    let saved;
    try { saved = await saveSnapshot(snapshot, payload.name, epoch, { saveAs: payload.saveAs === true }); }
    catch (error) {
      if (epoch === projectEpoch) { info.status = 'error'; info.error = String(error?.message || error).slice(0, 500); changed(); }
      throw error;
    }
    active();
    if (epoch !== projectEpoch) throw new Error('The task changed while saving. Save the current project again.');
    lastTaskKey = taskKey(snapshot);
    return result({ project: saved });
  }
  async function savedRevision(payload = {}) {
    const snapshot = await coordinator.exportProject();
    const revision = snapshot.revisions?.find(item => item.id === payload.revisionId);
    if (!revision) throw new Error('Select an available revision first.');
    const matches = item => item && (item.name === payload.fileId || item.contentSha256 === payload.fileId || item.id === payload.fileId);
    const file = Number.isInteger(payload.fileIndex) ? revision.files?.[payload.fileIndex] : revision.files?.find(matches);
    if (!matches(file)) throw new Error('The selected revision file is unavailable.');
    active();
    return file;
  }
  async function revisionPreview(payload) {
    const file = await savedRevision(payload);
    const metadata = { name: file.name, size: file.byteLength, sha256: file.contentSha256 };
    if (/\.pdf$/i.test(file.name)) return { ok: true, kind: 'pdf', ...metadata };
    if (/\.(?:png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      if (file.byteLength > 8 * 1024 * 1024) return { ok: true, kind: 'image', ...metadata, unavailable: 'This image is too large for an inline preview. Save the revision to inspect it.' };
      const bytes = isStoredFile(file) ? await readFileHead(file, 8 * 1024 * 1024) : Buffer.from(file.base64, 'base64');
      declaredImageSize(bytes, path.extname(file.name).toLowerCase());
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('The image could not be decoded for preview.');
      const dimensions = image.getSize();
      if (dimensions.width * dimensions.height > 50_000_000) throw new Error('This image exceeds the 50 megapixel preview limit. Save the revision to inspect it.');
      const small = image.resize({ width: Math.min(1600, image.getSize().width) });
      return { ok: true, kind: 'image', ...metadata, dataUrl: small.toDataURL() };
    }
    if (/\.(?:txt|md|csv|tsv|json|js|mjs|cjs|ts|py|mq5|mqh|html|css|xml|yaml|yml|log)$/i.test(file.name)) {
      const bytes = isStoredFile(file) ? await readFileHead(file, 500_000) : Buffer.from(file.base64, 'base64');
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      const text = /\.tsv$/i.test(file.name) ? new TextDecoder(encoding).decode(bytes.subarray(0, 500_000)) : bytes.subarray(0, 500_000).toString('utf8');
      return { ok: true, kind: 'text', ...metadata, text: text.slice(0, 200_000), truncated: file.byteLength > 200_000 };
    }
    return { ok: true, kind: 'file', ...metadata, unavailable: 'Save this revision to open it with its usual application.' };
  }
  async function revisionOpen(payload) {
    const file = await savedRevision(payload);
    if (!/\.pdf$/i.test(file.name)) throw new Error('Only PDF revision previews can be opened from this control. Save other files with the file controls.');
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'converge-pdf-preview-'));
    if (closed) { await fs.rm(folder, { recursive: true, force: true }); active(); }
    previewDirectories.add(folder);
    const filename = path.join(folder, 'revision.pdf');
    if (isStoredFile(file)) await fileOperation(signal => copyStoredFile(file, filename, { signal }));
    else await fs.writeFile(filename, Buffer.from(file.base64, 'base64'));
    if (closed) { await fs.rm(folder, { recursive: true, force: true }); previewDirectories.delete(folder); active(); }
    const error = await shell.openPath(filename);
    if (error) throw new Error(error);
    return { ok: true };
  }
  async function revisionSave(payload) {
    // Capture immutable owned bytes before the dialog. A running task may
    // produce its next revision while the user chooses a destination.
    const file = decodeFile(await savedRevision(payload));
    const chosen = await dialogs.showSaveDialog({ defaultPath: file.name });
    active();
    if (chosen.canceled) return { ok: true, canceled: true };
    await fileOperation(signal => isStoredFile(file) ? copyStoredFile(file, chosen.filePath, { signal }) :
      atomicWrite(chosen.filePath, file.bytes, { signal }));
    return { ok: true, saved: true, name: file.name, sha256: file.contentSha256, byteLength: file.byteLength };
  }
  async function projectDownload(payload) {
    const project = await store.load(payload?.id);
    active();
    const snapshot = project.snapshot, savedState = snapshot.state || snapshot;
    const revision = snapshot.revisions?.find(item => item.id === savedState.studio?.preferredRevisionId) || snapshot.revisions?.at(-1);
    const draft = snapshot.completedResults?.at(-1);
    const output = revision ? { ...revision.candidate, files: revision.files } : draft ?
      { id: draft.id, answer: draft.text || '', sha256: draft.sha256, files: draft.files } : snapshot.candidate ?
        { ...snapshot.candidate, files: project.files } : null;
    if (!output?.files?.length) throw new Error('This project has no retrieved output files yet. Its source files are preserved in the project archive.');
    const currentStatus = savedState.status || snapshot.savedStatus;
    // Historical completion describes the old run only. A continued or
    // restored project cannot inherit that run's final acceptance.
    const workflowStatus = currentStatus === 'idle' && savedState.completionContext?.status ? 'saved-review-required' :
      currentStatus || savedState.completionContext?.status || 'unknown';
    const localReport = savedState.studio?.verification;
    const matching = revision && localReport?.candidateId === output.id && localReport?.candidateSha256 === output.sha256;
    const packaged = prepareDeliveryPackage({ candidate: output, verification: matching ? localReport : undefined,
      project: { name: project.name, snapshot }, requirementStatuses: savedState.studio?.requirements || [],
      unresolvedIssues: savedState.studio?.issues || [], workflowStatus,
      bossSummary: savedState.boss?.finalSummary || '', limitations: savedState.boss?.limitations || [] });
    const chosen = await dialogs.showSaveDialog({ defaultPath: `Converge-${project.name.replace(/[^a-z0-9_. -]/gi, '_').slice(0, 60)}-files.zip`,
      filters: [{ name: 'Saved output files and report', extensions: ['zip'] }] });
    active();
    if (chosen.canceled) return { ok: true, canceled: true };
    // Export the captured saved checkpoint only. Opening a saved project or
    // replacing live chat work is deliberately unnecessary for downloads.
    await fileOperation(signal => writeDeliveryPackage(packaged, chosen.filePath, { signal }));
    return { ok: true, saved: true, name: path.basename(chosen.filePath), fileCount: output.files.length,
      outputStatus: currentStatus === 'agreed' ? 'reviewed' : 'draft', manifest: packaged.manifest };
  }
  function verification(candidate, context = {}) {
    active();
    const controller = new AbortController();
    const operation = Promise.resolve().then(() => controller.signal.aborted ? { status: 'unverified', candidateId: candidate?.id,
      candidateSha256: candidate?.sha256, checks: [], summary: 'Verification cancelled before the workspace closed.' } :
      verificationRunner({ candidate, nodeExecutable, pythonExecutable, nativeImage,
        testMode: context.verificationMode || 'static', dockerExecutable: 'docker', signal: controller.signal }));
    verificationJobs.set(operation, controller);
    return operation.finally(() => verificationJobs.delete(operation));
  }
  function register({ handle, getCoordinator, assertIdle, unloadPages }) {
    coordinator = getCoordinator();
    const registerHandle = handle;
    // IPC calls remain guarded even if a modal resolves after the window
    // closes, or a second control invokes an operation during the first one.
    handle = (channel, operation) => registerHandle(channel, async payload => {
      active();
      const exclusive = !['studio:project-list', 'studio:revision-preview', 'studio:revision-open'].includes(channel);
      if (exclusive && operationBusy) throw new Error('Wait for the current project operation to finish.');
      if (exclusive) operationBusy = true;
      try { return await operation(payload); }
      finally { if (exclusive) operationBusy = false; }
    });
    handle('studio:project-list', async () => ({ ok: true, projects: await store.list(), projectInfo: { ...info } }));
    handle('studio:project-download', projectDownload);
    handle('studio:project-save', saveProject);
    async function activate(project) {
      // Validate everything before resetting any live page or project state.
      // A structurally valid archive can still contain an invalid chat mode,
      // acceptance ledger or revision envelope.
      validateSavedProject(project.snapshot);
      await flush(); active(); await assertIdle(); await unloadPages();
      active();
      projectEpoch += 1;
      info = { id: project.id, name: project.name, status: 'saved', savedAt: project.savedAt || project.updatedAt, error: '' };
      lastTaskKey = taskKey(project.snapshot);
      const restored = await coordinator.restoreProject(project.snapshot);
      if (restored?.ok === false) throw new Error(restored.error || 'The saved project could not be restored.');
      changed();
      return result({ project: { id: project.id, name: project.name }, reconnectRequired: true });
    }
    handle('studio:project-load', async payload => { await assertIdle(); return activate(await store.load(payload?.id)); });
    handle('studio:project-import', async () => {
      await assertIdle();
      const chosen = await dialogs.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Converge project', extensions: ['zip'] }] });
      active();
      if (chosen.canceled || !chosen.filePaths?.length) return { ok: true, canceled: true };
      await assertIdle();
      const stats = await fs.stat(chosen.filePaths[0]);
      if (!stats.isFile() || stats.size > MAX_ARCHIVE_BYTES) throw new Error('Choose a Converge project archive with up to 3 GiB of file data.');
      const summary = await fileOperation(signal => store.importFrom(chosen.filePaths[0], { signal }));
      active(); await assertIdle();
      return activate(await store.load(summary.id));
    });
    handle('studio:project-export', async () => {
      const saved = await saveProject(), epoch = projectEpoch;
      active();
      const chosen = await dialogs.showSaveDialog({ defaultPath: 'Converge-project.zip', filters: [{ name: 'Converge project', extensions: ['zip'] }] });
      active();
      if (chosen.canceled) return { ok: true, canceled: true };
      if (epoch !== projectEpoch) throw new Error('The selected project changed while choosing its export location. Export the current project again.');
      await fileOperation(signal => store.exportTo(saved.project.id, chosen.filePath, { signal }));
      return { ok: true, saved: true, name: path.basename(chosen.filePath) };
    });
    handle('studio:settings', payload => mutation(() => coordinator.updateStudioSettings(payload)));
    handle('studio:requirement-review', payload => mutation(() => coordinator.setRequirementReview(payload)));
    handle('studio:issue-review', payload => mutation(() => coordinator.setIssueReview(payload)));
    handle('studio:restore-revision', async payload => { await checkIdle(); return mutation(() => coordinator.restoreRevision(payload?.id)); });
    handle('studio:verification-run', async () => { await checkIdle(); return mutation(() => coordinator.runVerification()); });
    handle('studio:revision-preview', revisionPreview);
    handle('studio:revision-open', revisionOpen);
    handle('studio:revision-save', revisionSave);
    handle('studio:delivery-export', async () => {
      await checkIdle();
      const candidate = await coordinator.getCurrentCandidate();
      if (!candidate) throw new Error('There is no candidate to package yet.');
      const current = await coordinator.getState();
      const project = await coordinator.exportProject();
      const epoch = projectEpoch, exportedKey = snapshotKey(project);
      const localReport = current.studio?.verification;
      const packaged = prepareDeliveryPackage({ candidate, verification: localReport?.status === 'idle' ? undefined : localReport,
        project: { name: info.name || title(current.question), snapshot: project },
        requirementStatuses: current.studio?.requirements || [], unresolvedIssues: current.studio?.issues || [],
        workflowStatus: current.status, bossSummary: current.boss?.finalSummary || '', limitations: current.boss?.limitations || [] });
      const chosen = await dialogs.showSaveDialog({ defaultPath: packaged.name || 'Converge-delivery.zip', filters: [{ name: 'Deliverable package', extensions: ['zip'] }] });
      active();
      if (chosen.canceled) return { ok: true, canceled: true };
      await checkIdle();
      if (epoch !== projectEpoch || exportedKey !== snapshotKey(await coordinator.exportProject())) throw new Error('The candidate or its review changed while choosing the export location. Export the current result again.');
      active();
      await fileOperation(signal => writeDeliveryPackage(packaged, chosen.filePath, { signal }));
      return { ok: true, saved: true, name: path.basename(chosen.filePath), manifest: packaged.manifest };
    });
  }
  async function dispose() {
    closed = true;
    for (const controller of fileJobs.values()) controller.abort(new Error('The project workspace closed during its file operation.'));
    await Promise.allSettled([...fileJobs.keys()]);
    for (const controller of verificationJobs.values()) controller.abort();
    await Promise.allSettled([...verificationJobs.keys()]);
    await flush();
    await store.close();
    // These are app-created preview copies only; a PDF viewer may still hold
    // one open on Windows, in which case leave it in the system temp folder.
    for (const folder of previewDirectories) {
      const relative = path.relative(os.tmpdir(), folder);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(folder).startsWith('converge-pdf-preview-')) {
        await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
  return { checkpoint, verification, register, flush, dispose, isBusy: () => operationBusy, getInfo: () => ({ ...info }) };
}

module.exports = { createStudioDesktop };
