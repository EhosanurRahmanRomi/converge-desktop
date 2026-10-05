'use strict';

// A test runner can detach its pipes before an Electron child finishes. Keep
// assertions and durable evidence running; an output-pipe failure is not an
// uncaught application exception. Unexpected stream errors still fail the run.
function createQaOutput({ stdout = process.stdout, stderr = process.stderr, onError } = {}) {
  const attach = stream => {
    let available = true;
    const failed = error => {
      available = false;
      if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error?.code)) {
        if (typeof onError === 'function') onError(error);
        else process.exitCode = 1;
      }
    };
    stream.on('error', failed);
    return value => {
      if (!available || stream.destroyed) return false;
      try { return stream.write(value); } catch (error) { failed(error); return false; }
    };
  };
  return { out: attach(stdout), error: attach(stderr) };
}

module.exports = { createQaOutput };
