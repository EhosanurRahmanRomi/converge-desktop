'use strict';

const { validatePublicStudio } = require('./workflow');

// Snapshot import uses an explicit allowlist. It cannot restore authentication,
// page ownership, cancellation state, pending requests or a prior acceptance.
function validateProject(snapshot, { validateFiles, candidateDigest, reviewPolicy, requestedArtifacts, requiredTaskWork }) {
  if (!snapshot || snapshot.schema !== 'converge-studio-project' || snapshot.version !== 1 ||
      !snapshot.state || typeof snapshot.state !== 'object' || Array.isArray(snapshot.state) ||
      !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.revisions) || snapshot.revisions.length > 48) {
    throw new Error('Choose a supported Converge studio project.');
  }
  const bounded = (value, label, maximum, empty = false) => {
    if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error(`${label} is invalid.`);
    return value;
  };
  const validateBytes = files => {
    if (!files.length) return [];
    const clean = validateFiles(files);
    clean.forEach((file, index) => {
      if (files[index].contentSha256 !== file.contentSha256 || files[index].byteLength !== file.byteLength) throw new Error('Saved file identity does not match its bytes.');
    });
    return clean;
  };
  const sources = validateBytes(snapshot.sources);
  const saved = snapshot.state;
  const statuses = new Set(['idle', 'running', 'agreed', 'blocked', 'stopped', 'error', 'limit_reached']);
  const completionContext = saved.status === undefined && !saved.completionContext ? null : {
    status: statuses.has(saved.status) ? saved.status : statuses.has(saved.completionContext?.status) ? saved.completionContext.status : 'idle',
    stage: bounded(saved.status !== 'running' && saved.completionContext?.status === saved.status ?
      saved.completionContext.stage : saved.stage ?? saved.completionContext?.stage ?? '', 'Saved workflow stage', 8_000, true),
    finishedAt: saved.status === 'running' ? null : Number.isFinite(saved.finishedAt) ? saved.finishedAt : Number.isFinite(saved.completionContext?.finishedAt) ? saved.completionContext.finishedAt : null,
    finalSummary: bounded(saved.boss?.finalSummary || '', 'Saved completion summary', 100_000, true),
    error: bounded(saved.error || saved.completionContext?.error || '', 'Saved workflow error', 8_000, true),
    diagnostics: [],
  };
  if (completionContext && saved.completionContext?.diagnostics !== undefined) {
    const diagnostics = saved.completionContext.diagnostics;
    if (!Array.isArray(diagnostics) || diagnostics.length > 16) throw new Error('Saved workflow diagnostics are too large.');
    completionContext.diagnostics = diagnostics.map(record => {
      if (!record || !['left', 'right', 'boss'].includes(record.side)) throw new Error('Saved workflow diagnostic side is invalid.');
      return { side: record.side, category: bounded(record.category || '', 'Saved diagnostic category', 100, true),
        detail: bounded(record.detail || '', 'Saved diagnostic detail', 4_000, true) };
    });
  }
  const question = bounded(saved.question || '', 'Saved brief', 20_000, true);
  const protocol = bounded(saved.protocol || '', 'Saved preferences', 10_000, true);
  if (!['normal', 'temporary', 'work'].includes(saved.chatMode)) throw new Error('Saved chat mode is invalid.');
  const studio = validatePublicStudio(saved.studio);
  const revisions = [];
  const ids = new Set(), candidateIds = new Set();
  for (const record of snapshot.revisions) {
    if (!record || !/^R[1-9]\d{0,4}$/.test(record.id) || ids.has(record.id) || !record.candidate ||
        !/^C[1-9]\d{0,4}$/.test(record.candidate.id) || candidateIds.has(record.candidate.id) ||
        !['left', 'right', 'user'].includes(record.candidate.author) || !Array.isArray(record.files)) throw new Error('A saved revision is invalid.');
    ids.add(record.id); candidateIds.add(record.candidate.id);
    const answer = bounded(record.candidate.answer, 'Saved candidate text', 100_000);
    const files = validateBytes(record.files);
    if (candidateDigest(answer, { files }) !== record.candidate.sha256) throw new Error('Saved candidate identity does not match its text and files.');
    revisions.push({ id: record.id, createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
      round: Number.isInteger(record.round) && record.round >= 0 && record.round <= 12 ? record.round : 0,
      candidate: { id: record.candidate.id, answer, text: answer, sha256: record.candidate.sha256,
        author: record.candidate.author, userRevision: Number.isInteger(record.candidate.userRevision) ? Math.max(0, record.candidate.userRevision) : 0 }, files });
  }
  const checkpoints = snapshot.completedResults || [];
  if (!Array.isArray(checkpoints) || checkpoints.length > 48) throw new Error('Saved completed outputs exceed the checkpoint limit.');
  const resultIds = new Set();
  const completedResults = checkpoints.map(result => {
    if (!result || !/^W[1-9]\d{0,5}$/.test(result.id) || resultIds.has(result.id) ||
        !['left', 'right'].includes(result.side) || result.kind !== 'work' || !Array.isArray(result.files) || !result.files.length) {
      throw new Error('A saved completed output is invalid.');
    }
    resultIds.add(result.id);
    const text = bounded(result.text, 'Saved completed output text', 100_000);
    const files = validateBytes(result.files);
    if (candidateDigest(text, { files }) !== result.sha256) throw new Error('Saved completed output identity does not match its text and files.');
    return { id: result.id, side: result.side, kind: 'work', text, sha256: result.sha256,
      round: Number.isInteger(result.round) && result.round >= 0 && result.round <= 12 ? result.round : 0,
      userRevision: Number.isInteger(result.userRevision) ? Math.max(0, result.userRevision) : 0, files };
  });
  const preferredRevisionId = saved.studio.preferredRevisionId;
  if (preferredRevisionId !== null && !ids.has(preferredRevisionId)) throw new Error('The saved preferred revision is unavailable.');
  const instructions = saved.boss?.instructions || [];
  if (!Array.isArray(instructions) || instructions.length > 100) throw new Error('Saved instructions are invalid.');
  const safeInstructions = instructions.map(item => ({ revision: Number.isInteger(item.revision) && item.revision >= 0 ? item.revision : 0,
    text: bounded(item.text, 'Saved instruction', 20_000) }));
  if (safeInstructions.reduce((sum, item) => sum + item.text.length, 0) > 60_000) throw new Error('Saved instructions are too large.');
  const fullTask = [question, ...safeInstructions.map(item => item.text)].join('\n\n');
  const outputs = requestedArtifacts(fullTask, sources);
  const reviewPreference = ['auto', 'improve', 'verify'].includes(saved.reviewPreference) ? saved.reviewPreference : 'auto';
  const policy = reviewPolicy(fullTask, reviewPreference, sources.length > 0);
  const round = Number.isInteger(saved.round) && saved.round >= 0 && saved.round <= 12 ? saved.round : 0;
  const maxRounds = Math.max(policy.minReviewRounds, Number.isInteger(saved.maxRounds) && saved.maxRounds >= 1 && saved.maxRounds <= 12 ? saved.maxRounds : 6);
  const transcript = saved.transcript || [];
  if (!Array.isArray(transcript) || transcript.length > 300) throw new Error('Saved transcript is too large.');
  const safeTranscript = transcript.map(item => {
    if (!['left', 'right', 'boss'].includes(item.side)) throw new Error('Saved transcript side is invalid.');
    return { side: item.side, role: bounded(item.role, 'Saved transcript role', 100), text: bounded(item.text, 'Saved transcript entry', 100_000, true),
      round: Number.isInteger(item.round) && item.round >= 0 && item.round <= 12 ? item.round : 0 };
  });
  const list = value => {
    if (!Array.isArray(value) || value.length > 40) throw new Error('Saved summary list is invalid.');
    return value.map(item => bounded(item, 'Saved summary', 4_000));
  };
  const requireFiles = saved.requireFiles === true || outputs.files;
  const state = { question, protocol, chatMode: saved.chatMode, reviewPreference, ...policy, round, completedWorkCycles: round,
    maxRounds, relayMedia: saved.relayMedia === true, requireFiles, requireImages: outputs.images || saved.requireImages === true,
    requirePdf: outputs.pdf || (!outputs.nonPdf && (saved.requirePdf === true || (requireFiles && outputs.pdfFallback))),
    ...outputs.profile, requiredWork: requiredTaskWork(fullTask, outputs.profile),
    transcript: safeTranscript, sourceNames: sources.map(file => file.name), studio, completionContext,
    answer: bounded(saved.answer || '', 'Saved answer', 100_000, true) };
  state.boss = { instructions: safeInstructions, revision: Math.max(0, ...safeInstructions.map(item => item.revision)),
    appliedRevision: Math.max(0, ...safeInstructions.map(item => item.revision)), queue: [], lastMessage: '', lastPlan: '',
    finalSummary: bounded(saved.boss?.finalSummary || '', 'Saved boss summary', 100_000, true),
    finalChecks: list(saved.boss?.finalChecks || []), limitations: list(saved.boss?.limitations || []) };
  return { state, sources, revisions, completedResults, preferredRevisionId };
}

module.exports = { validateProject };
