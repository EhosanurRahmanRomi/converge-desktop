'use strict';

const assert = require('node:assert/strict');

// The Mach-O header distinguishes a process executable from code loaded by
// dyld. Classify parsed headers, never filename extensions. Apple definitions:
// https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h
const RUNTIME_TYPES = Object.freeze({
  0x2: Object.freeze({ fileTypeName: 'MH_EXECUTE', runtimeRole: 'executable', executePermissionRequired: true }),
  0x6: Object.freeze({ fileTypeName: 'MH_DYLIB', runtimeRole: 'shared-library', executePermissionRequired: false }),
  0x8: Object.freeze({ fileTypeName: 'MH_BUNDLE', runtimeRole: 'loadable-bundle', executePermissionRequired: false }),
});

function validateMachORuntime(info, mode, { label = 'application', file = 'native binary', requiresExecutable = false } = {}) {
  const context = `${label}: ${file}`;
  assert.ok(info && Array.isArray(info.slices) && info.slices.length > 0, `${context}: parsed Mach-O slices are required.`);
  assert.deepEqual(info.architectures, ['arm64'], `${context}: non-ARM64 binary.`);
  assert.ok(Number.isSafeInteger(mode) && mode >= 0 && mode <= 0xffffffff, `${context}: invalid file permissions.`);
  const fileType = info.slices[0].fileType, classification = RUNTIME_TYPES[fileType];
  assert.ok(classification, `${context}: unsupported Mach-O runtime file type ${fileType}.`);
  for (const slice of info.slices) {
    assert.equal(slice.architecture, 'arm64', `${context}: non-ARM64 slice.`);
    assert.equal(slice.fileType, fileType, `${context}: inconsistent Mach-O slice file types.`);
    assert.equal(slice.codeSignaturePresent, true, `${context}: embedded ARM64 signature is absent.`);
  }
  // A readable 0644 MH_BUNDLE (.node) or MH_DYLIB is loaded, not launched via
  // execve. A process executable still requires its execute permission bits.
  // Actual file reads and deep/strict codesign verification remain separate.
  assert.ok((mode & 0o444) !== 0, `${context}: readable permissions missing.`);
  if (requiresExecutable) assert.equal(fileType, 0x2, `${context}: a Contents/MacOS program must be MH_EXECUTE.`);
  if (classification.executePermissionRequired) assert.ok((mode & 0o111) !== 0, `${context}: executable permissions missing.`);
  return { fileType, ...classification };
}

module.exports = { validateMachORuntime };
