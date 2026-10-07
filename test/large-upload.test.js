'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('production native/sidebar upload delivers an exact 100 MB source once to all three pages', { timeout: 180_000 }, async () => {
  const root = path.join(__dirname, '..');
  const reportPath = path.join(root, '.live-test', 'large-upload', 'test-result.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.rmSync(reportPath, { force: true });
  const env = { ...process.env, CONVERGE_LARGE_UPLOAD_REPORT: reportPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(root, 'scripts', 'qa-large-upload.js')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const capture = value => { output = (output + value).slice(-128 * 1024); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timer = setTimeout(() => { child.kill(); reject(new Error(`100 MB production upload exceeded its bounded deadline.\n${output}`)); }, 170_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  assert.equal(result.code, 0, result.output);
  assert.ok(fs.existsSync(reportPath), `The upload helper exited before writing its verification report.\n${result.output}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.passed, true); assert.equal(report.localFixturesOnly, true);
  assert.equal(report.source.bytes, 100 * 1024 * 1024); assert.equal(report.nativePickerInvocations, 1);
  assert.deepEqual(Object.keys(report.receipts).sort(), ['boss', 'left', 'right']);
  assert.ok(report.tests.length >= 6); assert.equal(report.sidebar.ready, true);
  for (const side of ['left', 'right', 'boss']) {
    assert.equal(report.receipts[side].receipts[0].sha256, report.source.sha256);
    assert.equal(report.wire[side].commits, 1); assert.ok(report.wire[side].chunks > 100);
    assert.ok(report.wire[side].maxWireBytes <= 1024 * 1024 + 2048);
  }
});
