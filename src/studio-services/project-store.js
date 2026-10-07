'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizeFiles, normalizeCandidate, fileDescriptor, boundedJSON, sha256, MAX_METADATA_BYTES, MAX_PROJECT_BYTES } = require('./identity');
const { createZip, readZip } = require('./archive');
const { MAX_FILE_BYTES } = require('../browser/files');
const { createFileStore, isStoredFile, storedFile, copyStoredFile, getStoredFilePath } = require('../browser/file-store');
const INLINE_BYTES = 4 * 1024 * 1024;

const VERSION = 1;
const SNAPSHOT_KEYS = new Set(['task', 'question', 'answer', 'status', 'stage', 'round', 'minReviewRounds', 'maxRounds',
  'revisionCount', 'candidate', 'candidateHistory', 'improvementTrail', 'finalVerification', 'verificationEvidence', 'requiredWork', 'workEvidence',
  'completedWorkCycles', 'verificationRounds', 'boss', 'issues', 'uncertainties', 'decisions', 'verification', 'requirements',
  'logs', 'history', 'sourceFiles', 'resultMedia', 'userRequirements', 'quality', 'startedAt', 'finishedAt',
  'protocol', 'chatMode', 'reviewPreference', 'reviewMode', 'relayMedia', 'requireFiles', 'requirePdf', 'requireImages',
  'codeTask', 'requireCodeFile', 'codeOutputExtension', 'mql5Task', 'transcript', 'studio', 'completionContext']);
const OMIT_KEYS = /(?:cookie|token|password|credential|secret|authentication|authorization|authenticated)|^(?:api.?key|auth|bearer|headers|session|sessions|session_id|storageState|localStorage|sessionStorage|pages?|tabs?|tabIds?|windowIds?|webContentsId|partition|runtimeIds?|runId|requestId|request_id|pending|pendingRequests?|queue|activeRequests?|fingerprint|downloadUrl|url|urls|base64|bytes|blobId|filePath|sourcePath)$/i;

function cleanValue(value, depth = 0) {
  if (depth > 12) throw new Error('Project metadata is nested too deeply.');
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') {
    if (value.length > 200_000) throw new Error('Project text exceeds the field limit.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error('Project history exceeds the entry limit.');
    return value.map(item => cleanValue(item, depth + 1)).filter(item => item !== undefined);
  }
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 200) throw new Error('Project record has too many fields.');
  const result = Object.create(null);
  for (const [key, item] of entries) {
    if (key.length > 100 || OMIT_KEYS.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const cleaned = cleanValue(item, depth + 1);
    if (cleaned !== undefined) result[key] = cleaned;
  }
  return result;
}

function sanitizeSnapshot(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project snapshot must be an object.');
  if (value.schema === 'converge-studio-project') {
    if (value.version !== 1 || !value.state || typeof value.state !== 'object' || !Array.isArray(value.sources) || value.sources.length > 5 || !Array.isArray(value.revisions) || value.revisions.length > 80 ||
        value.completedResults !== undefined && (!Array.isArray(value.completedResults) || value.completedResults.length > 48)) throw new Error('Unsupported or invalid studio project snapshot.');
    const state = Object.create(null);
    for (const [key, item] of Object.entries(value.state)) if (SNAPSHOT_KEYS.has(key)) state[key] = cleanValue(item);
    // File descriptors are references to disk blobs until load hydrates them.
    const result = { schema: value.schema, version: 1, savedAt: typeof value.savedAt === 'string' ? value.savedAt.slice(0, 100) : new Date().toISOString(),
      state, sources: value.sources.map(fileDescriptor), revisions: value.revisions.map(revision => ({ ...cleanValue(revision), files: (revision.files || []).map(fileDescriptor) })),
      ...(value.completedResults ? { completedResults: value.completedResults.map(result => ({ ...cleanValue(result), files: (result.files || []).map(fileDescriptor) })) } : {}) };
    boundedJSON(result, 'Project snapshot'); return result;
  }
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (SNAPSHOT_KEYS.has(key)) result[key] = cleanValue(item);
  }
  // A restored project is a completed local record. Never revive an active
  // request, acceptance authority or browser runtime from serialized state.
  const priorStatus = result.status;
  result.status = 'saved';
  result.savedStatus = typeof priorStatus === 'string' ? priorStatus : 'unknown';
  result.restoreMode = 'completed-result';
  boundedJSON(result, 'Project snapshot');
  return result;
}

function validId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid project ID.');
  return id;
}

async function atomicWrite(filename, bytes, { signal } = {}) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    signal?.throwIfAborted();
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    signal?.throwIfAborted();
    await fs.rename(temp, filename);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
  }
}

function projectSummary(project) {
  const revision = project.snapshot?.revisions?.find(item => item.id === project.snapshot.state?.studio?.preferredRevisionId) || project.snapshot?.revisions?.at(-1);
  const draft = project.snapshot?.completedResults?.at(-1), output = revision || draft ||
    (project.snapshot?.candidate ? { files: project.files } : null);
  const currentStatus = project.snapshot?.state?.status || project.snapshot?.savedStatus;
  const workflowStatus = currentStatus && currentStatus !== 'idle' ? currentStatus : project.snapshot?.state?.completionContext?.status || currentStatus || 'unknown';
  return { id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt,
    candidateId: revision?.candidate?.id || project.snapshot?.candidate?.id || null, candidateSha256: revision?.candidate?.sha256 || project.snapshot?.candidate?.sha256 || null,
    fileCount: projectDescriptors(project).length, revisionCount: project.snapshot?.schema ? project.snapshot.revisions.length : project.revisions.length,
    savedStatus: workflowStatus, outputFileCount: output?.files?.length || 0, outputNames: (output?.files || []).map(file => file.name),
    completedResultCount: project.snapshot?.completedResults?.length || 0,
    outputStatus: currentStatus === 'agreed' ? 'reviewed' : output?.files?.length ? 'draft' : 'none' };
}

function projectDescriptors(project) {
  const descriptors = [...project.files];
  if (project.snapshot?.schema === 'converge-studio-project') descriptors.push(...project.snapshot.sources, ...project.snapshot.revisions.flatMap(revision => revision.files),
    ...(project.snapshot.completedResults || []).flatMap(result => result.files));
  const unique = new Map(); let total = 0;
  for (const file of descriptors) {
    if (!/^[a-f0-9]{64}$/.test(file.contentSha256 || '') || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0 || file.byteLength > MAX_FILE_BYTES) throw new Error('Project file identity is invalid.');
    if (unique.has(file.contentSha256)) {
      if (unique.get(file.contentSha256).byteLength !== file.byteLength) throw new Error('Conflicting project file identities.');
      continue;
    }
    unique.set(file.contentSha256, file); total += file.byteLength;
    if (total > MAX_PROJECT_BYTES || unique.size > 500) throw new Error('Project exceeds its distinct file storage limit.');
  }
  return [...unique.values()];
}

function createProjectStore({ directory } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('An absolute local project directory is required.');
  const root = path.resolve(directory), projects = path.join(root, 'projects'), blobs = path.join(root, 'blobs');
  const blobStore = createFileStore({ directory: root, makeDefault: false });
  const verifiedBlobs = new Map(), hydratedBlobs = new Map();
  const signature = stat => `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  let serial = Promise.resolve();
  const enqueue = fn => {
    const result = serial.then(fn); serial = result.catch(() => {}); return result;
  };
  async function init() { await fs.mkdir(projects, { recursive: true }); await fs.mkdir(blobs, { recursive: true }); }
  async function readProject(id) {
    validId(id); await init();
    const filename = path.join(projects, `${id}.json`), stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_BYTES) throw new Error('Project metadata is invalid or too large.');
    const project = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (project.version !== VERSION || project.id !== id || typeof project.name !== 'string' || !project.name || project.name.length > 180 ||
        typeof project.createdAt !== 'string' || typeof project.updatedAt !== 'string' || !Number.isFinite(Date.parse(project.createdAt)) || !Number.isFinite(Date.parse(project.updatedAt)) ||
        !Array.isArray(project.files) || project.files.length > 100 ||
        !Array.isArray(project.revisions) || !Array.isArray(project.decisionHistory)) throw new Error('Unsupported or damaged project metadata.');
    // Reapply bounds and sanitization on disk reads as files can be edited.
    project.snapshot = sanitizeSnapshot(project.snapshot.schema ? project.snapshot : { ...project.snapshot, status: project.snapshot.savedStatus });
    project.revisions = cleanValue(project.revisions); project.decisionHistory = cleanValue(project.decisionHistory);
    boundedJSON(project); projectDescriptors(project);
    return project;
  }
  async function hydrateDescriptors(descriptors) {
    const files = [];
    for (const descriptor of descriptors) {
      if (!/^[a-f0-9]{64}$/.test(descriptor.contentSha256 || '') || !Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0 || descriptor.byteLength > MAX_FILE_BYTES) throw new Error('Project file identity is invalid.');
      const filename = path.join(blobs, `${descriptor.contentSha256}.blob`), stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== descriptor.byteLength) throw new Error(`Project file ${descriptor.name} is missing or damaged.`);
      if (descriptor.byteLength > INLINE_BYTES) {
        const key = `${descriptor.contentSha256}:${descriptor.mimeType}`, cached = hydratedBlobs.get(key);
        if (cached && verifiedBlobs.get(descriptor.contentSha256) === signature(stat)) files.push(storedFile({ ...cached, name: descriptor.name }));
        else {
          const hydrated = await blobStore.ingest(filename, { ...descriptor, expectedSha256: descriptor.contentSha256, expectedByteLength: descriptor.byteLength });
          hydratedBlobs.set(key, hydrated); verifiedBlobs.set(descriptor.contentSha256, signature(await fs.lstat(filename))); files.push(hydrated);
        }
        continue;
      }
      const bytes = await fs.readFile(filename);
      if (sha256(bytes) !== descriptor.contentSha256) throw new Error(`Project file ${descriptor.name} failed its SHA-256 check.`);
      files.push({ ...descriptor, base64: bytes.toString('base64') });
    }
    return normalizeFiles(files).map(file => isStoredFile(file) ? file : ({ ...fileDescriptor(file), base64: file.bytes.toString('base64') }));
  }
  async function hydrateSnapshot(snapshot) {
    if (snapshot.schema !== 'converge-studio-project') return snapshot;
    const revisions = [];
    for (const revision of snapshot.revisions) {
      const files = await hydrateDescriptors(revision.files);
      normalizeCandidate({ ...revision.candidate, files });
      revisions.push({ ...revision, files });
    }
    const completedResults = [];
    for (const result of snapshot.completedResults || []) {
      const files = await hydrateDescriptors(result.files);
      normalizeCandidate({ id: result.id, answer: result.text, sha256: result.sha256, files });
      completedResults.push({ ...result, files });
    }
    return { ...snapshot, sources: await hydrateDescriptors(snapshot.sources), revisions,
      ...(snapshot.completedResults ? { completedResults } : {}) };
  }
  async function saveInternal(input) {
    if (!input || typeof input !== 'object') throw new Error('Project data is required.');
    await init();
    const id = input.id ? validId(input.id) : randomUUID();
    let prior;
    if (input.id) {
      try { prior = await readProject(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const name = String(input.name || prior?.name || 'Untitled project').trim();
    if (!name || name.length > 180 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Project name is invalid or too long.');
    if (!Array.isArray(input.revisions || input.snapshot?.candidateHistory || []) || !Array.isArray(input.decisionHistory || input.snapshot?.improvementTrail || [])) throw new Error('Project revisions and decisions must be arrays.');
    const batches = [], rawSnapshot = input.snapshot || {}, knownFiles = new Map(); let distinctBytes = 0;
    function registerBatch(inputFiles, maximum = 5) {
      const normalized = normalizeFiles(inputFiles, maximum).map(file => {
        if (knownFiles.has(file.contentSha256)) return { ...file, bytes: knownFiles.get(file.contentSha256).bytes };
        distinctBytes += file.byteLength;
        if (distinctBytes > MAX_PROJECT_BYTES || knownFiles.size >= 500) throw new Error('Project exceeds its distinct file storage limit.');
        knownFiles.set(file.contentSha256, file); return file;
      });
      batches.push(normalized); return normalized;
    }
    if (rawSnapshot.schema === 'converge-studio-project') {
      if (!Array.isArray(rawSnapshot.sources) || !Array.isArray(rawSnapshot.revisions) || rawSnapshot.revisions.length > 80 ||
          rawSnapshot.completedResults !== undefined && (!Array.isArray(rawSnapshot.completedResults) || rawSnapshot.completedResults.length > 48)) throw new Error('Studio sources or revisions are invalid.');
      registerBatch(rawSnapshot.sources);
      for (const revision of rawSnapshot.revisions) {
        const files = registerBatch(revision.files);
        normalizeCandidate({ ...revision.candidate, files });
      }
      for (const result of rawSnapshot.completedResults || []) {
        const files = registerBatch(result.files);
        normalizeCandidate({ id: result.id, answer: result.text, sha256: result.sha256, files });
      }
    }
    const files = normalizeFiles(input.files || (batches.length > 1 ? batches.at(-1) : batches[0]) || []);
    const normalizedSnapshot = rawSnapshot.schema === 'converge-studio-project' ? { ...rawSnapshot, sources: batches[0],
      revisions: rawSnapshot.revisions.map((revision, index) => ({ ...revision, files: batches[index + 1] })),
      ...(rawSnapshot.completedResults ? { completedResults: rawSnapshot.completedResults.map((result, index) => ({ ...result, files: batches[rawSnapshot.revisions.length + index + 1] })) } : {}) } : rawSnapshot;
    const project = { version: VERSION, id, name, createdAt: prior?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
      snapshot: sanitizeSnapshot(normalizedSnapshot), files: files.map(fileDescriptor),
      revisions: cleanValue(input.revisions || input.snapshot?.candidateHistory || []),
      decisionHistory: cleanValue(input.decisionHistory || input.snapshot?.improvementTrail || []) };
    const metadata = boundedJSON(project);
    projectDescriptors(project);
    const uniqueFiles = new Map([...batches.flat(), ...files].map(file => [file.contentSha256, file]));
    // Commit metadata only after every immutable blob is present and synced.
    for (const file of uniqueFiles.values()) {
      const filename = path.join(blobs, `${file.contentSha256}.blob`);
      let existing;
      try { existing = await fs.lstat(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== file.byteLength) throw new Error('Stored file blob is damaged.');
        if (verifiedBlobs.get(file.contentSha256) !== signature(existing)) {
          const checked = await blobStore.ingest(filename, { ...fileDescriptor(file), expectedSha256: file.contentSha256, expectedByteLength: file.byteLength });
          hydratedBlobs.set(`${file.contentSha256}:${file.mimeType}`, checked);
        }
      } else if (isStoredFile(file)) await copyStoredFile(file, filename);
      else await atomicWrite(filename, file.bytes);
      verifiedBlobs.set(file.contentSha256, signature(await fs.lstat(filename)));
    }
    await atomicWrite(path.join(projects, `${id}.json`), metadata);
    return projectSummary(project);
  }
  async function exportToInternal(id, destination, { signal } = {}) {
    const project = await readProject(id), descriptors = projectDescriptors(project);
    const entries = [{ name: 'project.json', bytes: Buffer.from(boundedJSON({ format: 'converge-project', version: VERSION, project })) }];
    for (const file of descriptors) {
      const filename = path.join(blobs, `${file.contentSha256}.blob`), stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.byteLength) throw new Error('Stored project blob is missing or damaged.');
      entries.push({ name: `blobs/${file.contentSha256}.blob`, filePath: filename, byteLength: file.byteLength, contentSha256: file.contentSha256 });
    }
    await require('./archive').writeZipFile(entries, destination, { signal });
    return { name: path.basename(destination), saved: true, project: projectSummary(project) };
  }
  async function importFromInternal(filename, { signal } = {}) {
    let project, expected, imported = new Map();
    await require('./archive').readZipFile(filename, { signal, async onEntry(entry) {
      if (!project) {
        if (entry.name !== 'project.json' || entry.byteLength > MAX_METADATA_BYTES) throw new Error('Project archive must begin with its bounded manifest.');
        const chunks = []; for await (const chunk of entry.stream) chunks.push(chunk);
        let archive; try { archive = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch (_) { throw new Error('Project archive metadata is invalid.'); }
        if (archive.format !== 'converge-project' || archive.version !== VERSION || archive.project?.version !== VERSION || !Array.isArray(archive.project.files) || archive.project.files.length > 100) throw new Error('Unsupported project archive version.');
        project = archive.project; expected = new Map(projectDescriptors(project).map(file => [`blobs/${file.contentSha256}.blob`, file]));
        return;
      }
      const descriptor = expected.get(entry.name);
      if (!descriptor || imported.has(entry.name) || descriptor.byteLength !== entry.byteLength) throw new Error('Project archive contains unexpected or inconsistent file data.');
      const file = await blobStore.ingestStream(entry.stream, { ...descriptor, expectedSha256: descriptor.contentSha256, expectedByteLength: descriptor.byteLength, signal });
      imported.set(entry.name, file);
    } });
    if (!project || imported.size !== expected.size) throw new Error('Project archive is missing verified file data.');
    const filesFor = async descriptors => {
      const results = [];
      for (const file of descriptors) {
        const importedFile = imported.get(`blobs/${file.contentSha256}.blob`);
        const owned = file.mimeType === importedFile.mimeType ? importedFile : await blobStore.ingest(getStoredFilePath(importedFile),
          { ...fileDescriptor(file), expectedSha256: file.contentSha256, expectedByteLength: file.byteLength, signal });
        results.push({ ...owned, ...fileDescriptor(file) });
      }
      return results;
    };
    let snapshot = project.snapshot;
    if (snapshot?.schema === 'converge-studio-project') {
      const revisions = []; for (const revision of snapshot.revisions) revisions.push({ ...revision, files: await filesFor(revision.files) });
      const completedResults = [];
      for (const result of snapshot.completedResults || []) completedResults.push({ ...result, files: await filesFor(result.files) });
      snapshot = { ...snapshot, sources: await filesFor(snapshot.sources), revisions,
        ...(snapshot.completedResults ? { completedResults } : {}) };
    }
    return saveInternal({ name: project.name, snapshot: snapshot?.schema ? snapshot : { ...snapshot, status: snapshot?.savedStatus }, files: await filesFor(project.files), revisions: project.revisions, decisionHistory: project.decisionHistory });
  }
  return {
    close: () => enqueue(() => blobStore.close()),
    save: input => enqueue(() => saveInternal(input)),
    list: () => enqueue(async () => {
      await init();
      const names = await fs.readdir(projects);
      if (names.length > 5_000) throw new Error('Project library exceeds the entry limit.');
      const results = [];
      for (const name of names) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        try { results.push(projectSummary(await readProject(name.slice(0, -5)))); }
        catch (_) { /* A damaged project never prevents access to other projects. */ }
      }
      return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }),
    load: id => enqueue(async () => { const project = await readProject(id); return { ...project, snapshot: await hydrateSnapshot(project.snapshot), files: await hydrateDescriptors(project.files) }; }),
    exportTo: (id, destination, options) => enqueue(() => exportToInternal(id, destination, options)),
    importFrom: (filename, options) => enqueue(() => importFromInternal(filename, options)),
    export: id => enqueue(async () => {
      const project = await readProject(id), files = projectDescriptors(project);
      if (files.reduce((sum, file) => sum + file.byteLength, 0) > 16 * 1024 * 1024) throw new Error('Use streaming project export for archives larger than 16 MB.');
      const entries = [{ name: 'project.json', bytes: Buffer.from(boundedJSON({ format: 'converge-project', version: VERSION, project })) }];
      const seen = new Set();
      for (const file of files) {
        if (seen.has(file.contentSha256)) continue; seen.add(file.contentSha256);
        const filename = path.join(blobs, `${file.contentSha256}.blob`), stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.byteLength) throw new Error('Stored project blob is missing or damaged.');
        const bytes = await fs.readFile(filename);
        if (bytes.length !== file.byteLength || sha256(bytes) !== file.contentSha256) throw new Error('Stored project blob failed its SHA-256 check.');
        entries.push({ name: `blobs/${file.contentSha256}.blob`, bytes });
      }
      return createZip(entries);
    }),
    import: bytes => enqueue(async () => {
      if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Use streaming project import for archives larger than 16 MB.');
      const entries = readZip(bytes), metadata = entries.get('project.json');
      if (!metadata) throw new Error('Archive has no Converge project manifest.');
      let archive;
      try { archive = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata)); } catch (_) { throw new Error('Project archive metadata is invalid.'); }
      if (archive.format !== 'converge-project' || archive.version !== VERSION || archive.project?.version !== VERSION || !Array.isArray(archive.project.files) || archive.project.files.length > 100) throw new Error('Unsupported project archive version.');
      const project = archive.project, used = new Set(['project.json']);
      projectDescriptors(project);
      function archiveFiles(descriptors) { return descriptors.map(file => {
        if (!/^[a-f0-9]{64}$/.test(file.contentSha256 || '')) throw new Error('Archive file identity is invalid.');
        const member = `blobs/${file.contentSha256}.blob`, content = entries.get(member); used.add(member);
        if (!content) throw new Error('Archive is missing a project file.');
        return { ...fileDescriptor(file), bytes: content };
      }); }
      const files = archiveFiles(project.files);
      let snapshot = project.snapshot;
      if (snapshot?.schema === 'converge-studio-project') snapshot = { ...snapshot, sources: archiveFiles(snapshot.sources), revisions: snapshot.revisions.map(revision => ({ ...revision, files: archiveFiles(revision.files) })),
        ...(snapshot.completedResults ? { completedResults: snapshot.completedResults.map(result => ({ ...result, files: archiveFiles(result.files) })) } : {}) };
      if ([...entries.keys()].some(name => !used.has(name))) throw new Error('Archive contains unexpected members.');
      return saveInternal({ name: project.name, snapshot: snapshot?.schema ? snapshot : { ...snapshot, status: snapshot?.savedStatus }, files,
        revisions: project.revisions, decisionHistory: project.decisionHistory });
    }),
  };
}

module.exports = { createProjectStore, sanitizeSnapshot, sanitizeRecord: cleanValue, atomicWrite };
