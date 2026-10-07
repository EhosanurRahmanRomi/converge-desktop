'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readMachO } = require('../scripts/macos-package-lib');
const { validateMachORuntime } = require('../scripts/macos-macho-runtime');

// Minimal parsed-header fixtures test release policy, not real cryptographic
// signing. The native release verifier still invokes deep/strict codesign.
function binary(fileType, { architecture = 0x0100000c, signed = true } = {}) {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(architecture, 4); bytes.writeUInt32LE(fileType, 12);
  bytes.writeUInt32LE(signed ? 1 : 0, 16); bytes.writeUInt32LE(signed ? 16 : 0, 20);
  if (signed) {
    bytes.writeUInt32LE(0x1d, 32); bytes.writeUInt32LE(16, 36);
    bytes.writeUInt32LE(48, 40); bytes.writeUInt32LE(16, 44);
  }
  return readMachO(bytes);
}

test('a signed ARM64 process executable requires executable permissions', () => {
  const info = binary(0x2);
  assert.equal(validateMachORuntime(info, 0o100755).runtimeRole, 'executable');
  assert.throws(() => validateMachORuntime(info, 0o100644), /executable permissions missing/);
});

test('readable signed ARM64 loadable bundles and shared libraries may have no execute bits', () => {
  assert.deepEqual(validateMachORuntime(binary(0x8), 0o100644), {
    fileType: 0x8, fileTypeName: 'MH_BUNDLE', runtimeRole: 'loadable-bundle', executePermissionRequired: false,
  });
  assert.equal(validateMachORuntime(binary(0x6), 0o100444).runtimeRole, 'shared-library');
  for (const fileType of [0x6, 0x8]) assert.throws(() => validateMachORuntime(binary(fileType), 0o100111), /readable permissions missing/);
});

test('filename extensions cannot bypass executable or signature checks', () => {
  assert.throws(() => validateMachORuntime(binary(0x2), 0o100644, { file: 'renamed.node' }), /executable permissions missing/);
  assert.throws(() => validateMachORuntime(binary(0x8, { signed: false }), 0o100644, { file: 'native.node' }), /embedded ARM64 signature is absent/);
});

test('loadable libraries cannot replace a main program or helper executable', () => {
  for (const fileType of [0x6, 0x8]) {
    assert.throws(() => validateMachORuntime(binary(fileType), 0o100755, { requiresExecutable: true }), /must be MH_EXECUTE/);
  }
  assert.equal(validateMachORuntime(binary(0x2), 0o100755, { requiresExecutable: true }).fileTypeName, 'MH_EXECUTE');
});

test('unsupported Mach-O artifacts and Intel native dependencies remain rejected', () => {
  for (const fileType of [0, 0x1, 0x4, 0x7, 0x9, 0xa, 0xb]) {
    assert.throws(() => validateMachORuntime(binary(fileType), 0o100755), /unsupported Mach-O runtime file type/);
  }
  assert.throws(() => validateMachORuntime(binary(0x8, { architecture: 0x01000007 }), 0o100644), /non-ARM64 binary/);
});

test('runtime classification rejects malformed metadata and inconsistent slices', () => {
  const info = binary(0x8);
  assert.throws(() => validateMachORuntime({ ...info, slices: [] }, 0o100644), /slices are required/);
  assert.throws(() => validateMachORuntime(info, NaN), /invalid file permissions/);
  assert.throws(() => validateMachORuntime({ ...info, slices: [...info.slices, { ...info.slices[0], fileType: 0x6 }] }, 0o100644), /inconsistent Mach-O slice/);
});
