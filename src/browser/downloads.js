'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MIME, MAX_FILE_BYTES, safeFilename, validateTextSource } = require('./files');

const SIDES = new Set(['left', 'right', 'boss']);
const TYPES = new Set(Object.values(MIME));
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const ZIP_NATIVE_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);

/**
 * Captures the download caused by one authorized, visible file click in an
 * embedded ChatGPT page. It never opens a URL or reads a Chrome profile.
 * Temporary paths are generated here; page-provided paths are never used.
 */
function createDownloadBroker({ browserSession, sideForContents, authorize, tempRoot } = {}) {
  if (!browserSession?.on || !browserSession?.removeListener || typeof sideForContents !== 'function' || typeof authorize !== 'function') {
    throw new TypeError('The native download broker requires a session and authorization callbacks.');
  }
  const baseDirectory = path.resolve(tempRoot || os.tmpdir());
  const jobs = new Map();
  const cleanupTasks = new Set();
  let disposed = false;
  let directoryPromise;

  const errorResult = (error) => ({ ok: false, error: error?.message || String(error || 'The file could not be downloaded.') });
  function directory() {
    directoryPromise ||= fs.mkdtemp(path.join(baseDirectory, 'converge-download-'));
    return directoryPromise;
  }
  function trackCleanup(promise) {
    cleanupTasks.add(promise);
    promise.finally(() => cleanupTasks.delete(promise)).catch(() => {});
    return promise;
  }
  async function removeFile(job) {
    if (!job.filename) return;
    const ownedDirectory = await directoryPromise;
    const filename = path.resolve(job.filename);
    if (path.dirname(filename) !== ownedDirectory) throw new Error('The temporary download path is outside its owned directory.');
    // Windows may briefly retain the handle after cancellation.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await fs.rm(filename, { force: true }); return; }
      catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
  function detach(job) {
    if (!job.item) return;
    if (job.updated) job.item.removeListener('updated', job.updated);
    if (job.done) job.item.removeListener('done', job.done);
  }
  function settle(job, result) {
    if (job.settled) return;
    job.settled = true;
    job.phase = 'settled';
    clearTimeout(job.timer);
    detach(job);
    trackCleanup(removeFile(job).catch(() => {})).then(() => job.resolve(result));
  }
  function fail(job, message) {
    if (job.settled) return;
    const item = job.item;
    settle(job, errorResult(message));
    // Cancel only the item captured for this authorized job.
    try { item?.cancel(); } catch (_) { }
  }
  function validPayload(payload) {
    const valid = payload && ['runId', 'requestId', 'id', 'name', 'mimeType'].every((key) => typeof payload[key] === 'string' && payload[key]) &&
      payload.runId.length <= 1000 && payload.requestId.length <= 2000 && payload.id.length <= 200 &&
      /^[^\\/\x00-\x1f]{1,180}$/.test(payload.name) && TYPES.has(payload.mimeType);
    if (!valid) return false;
    try { validateTextSource(payload.name, payload.mimeType); return true; }
    catch (_) { return false; }
  }

  async function completed(job, state) {
    if (job.settled) return;
    if (state !== 'completed') return fail(job, 'The visible file download was canceled or interrupted.');
    try {
      const stat = await fs.stat(job.filename);
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FILE_BYTES) throw new Error('The downloaded file is empty or exceeds the 12 MB limit.');
      const bytes = await fs.readFile(job.filename);
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('The downloaded file is empty or exceeds the 12 MB limit.');
      validateTextSource(job.payload.name, job.payload.mimeType, bytes);
      if (job.settled) return;
      settle(job, { ok: true, mimeType: job.payload.mimeType, base64: bytes.toString('base64') });
    } catch (error) { fail(job, error); }
  }

  function willDownload(_event, item, contents) {
    let side;
    try { side = sideForContents(contents); } catch (_) { return; }
    const job = jobs.get(side);
    if (!job || job.phase !== 'waiting' || disposed) return;
    job.phase = 'downloading';
    job.item = item;
    try {
      const type = String(item.getMimeType() || '').split(';')[0].trim().toLowerCase();
      // ChatGPT's native downloader can label a .py artifact text/x-python.
      // Keep our inert source representation canonical and bind this alias to
      // the selected Python filename; filename and Unicode checks still apply.
      const pythonSourceType = type === 'text/x-python' && job.payload.mimeType === 'text/plain' && /\.py$/i.test(job.payload.name);
      if (type === 'text/html' || type === 'application/xhtml+xml' || (type !== job.payload.mimeType && !GENERIC_TYPES.has(type) &&
          !pythonSourceType &&
          !(job.payload.mimeType === 'application/zip' && ZIP_NATIVE_TYPES.has(type)) &&
          !(type === 'application/zip' && job.payload.mimeType.includes('openxmlformats')))) {
        throw new Error('The visible download returned an unexpected file type.');
      }
      const nativeName = item.getFilename?.();
      if (nativeName && safeFilename(nativeName, job.payload.mimeType).toLowerCase() !== safeFilename(job.payload.name, job.payload.mimeType).toLowerCase()) {
        throw new Error('The downloaded filename does not match the selected candidate file.');
      }
      if (Number(item.getTotalBytes()) > MAX_FILE_BYTES) throw new Error('The download exceeds the 12 MB file limit.');
      job.updated = () => {
        if (Number(item.getReceivedBytes()) > MAX_FILE_BYTES || Number(item.getTotalBytes()) > MAX_FILE_BYTES) {
          fail(job, 'The download exceeds the 12 MB file limit.');
        }
      };
      job.done = (_doneEvent, state) => { void completed(job, state); };
      item.on('updated', job.updated);
      item.once('done', job.done);
      item.setSavePath(job.filename);
    } catch (error) { fail(job, error); }
  }
  browserSession.on('will-download', willDownload);

  return {
    async begin(side, payload) {
      if (disposed) return errorResult('The download workspace has closed.');
      if (!SIDES.has(side) || !validPayload(payload)) return errorResult('Invalid candidate download metadata.');
      if (jobs.has(side) && !jobs.get(side).settled) return errorResult('A candidate download is already waiting for this chat.');
      const token = randomUUID();
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      const job = { side, token, payload: { runId: payload.runId, requestId: payload.requestId, id: payload.id, name: payload.name, mimeType: payload.mimeType },
        phase: 'authorizing', settled: false, promise, resolve, filename: null, timer: null, item: null };
      jobs.set(side, job);
      try {
        if (await authorize(side, { ...job.payload }) !== true) throw new Error('The candidate download is not authorized.');
        if (disposed || job.settled) throw new Error('The candidate download was canceled.');
        const ownedDirectory = await directory();
        if (disposed || job.settled || jobs.get(side) !== job) throw new Error('The candidate download was canceled.');
        const extension = Object.keys(MIME).find((key) => MIME[key] === job.payload.mimeType);
        job.filename = path.join(ownedDirectory, `${token}.${extension}`);
        job.phase = 'waiting';
        // This includes the site's asynchronous blob preparation after the
        // verified click, not just the eventual file transfer.
        job.timer = setTimeout(() => fail(job, 'The visible file download did not finish within 45 seconds.'), 45_000);
        job.timer.unref?.();
        return { ok: true, token };
      } catch (error) {
        fail(job, error);
        if (jobs.get(side) === job) jobs.delete(side);
        return errorResult(error);
      }
    },
    async read(side, token) {
      const job = jobs.get(side);
      if (!job || job.token !== token || !SIDES.has(side)) return errorResult('The candidate download token is not valid for this chat.');
      const result = await job.promise;
      if (jobs.get(side) === job) jobs.delete(side);
      return result;
    },
    cancel(side, token) {
      const job = jobs.get(side);
      if (!job || job.token !== token || !SIDES.has(side)) return errorResult('The candidate download token is not valid for this chat.');
      fail(job, 'The candidate download was canceled.');
      return { ok: true, canceled: true };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      browserSession.removeListener('will-download', willDownload);
      for (const job of jobs.values()) fail(job, 'The download workspace has closed.');
      await Promise.all([...jobs.values()].map((job) => job.promise));
      jobs.clear();
      await Promise.all([...cleanupTasks]);
      if (directoryPromise) {
        try { await fs.rmdir(await directoryPromise); } catch (_) { /* Never delete a broader directory recursively. */ }
      }
    },
  };
}

module.exports = { createDownloadBroker };
