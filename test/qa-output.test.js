'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createQaOutput } = require('../scripts/qa-output');

function pipe() {
  const stream = new EventEmitter();
  stream.writes = []; stream.write = value => { stream.writes.push(value); return true; };
  return stream;
}
test('a detached QA output pipe does not produce an uncaught error or interrupt remaining assertions', () => {
  for (const code of ['EPIPE', 'ERR_STREAM_DESTROYED']) {
    const stdout = pipe(), stderr = pipe(), unexpected = [];
    const output = createQaOutput({ stdout, stderr, onError: error => unexpected.push(error) });
    assert.equal(output.out('before'), true);
    stdout.emit('error', Object.assign(new Error('pipe detached'), { code }));
    assert.equal(output.out('after'), false);
    assert.deepEqual(stdout.writes, ['before']);
    assert.equal(output.error('still report a real failure'), true);
    assert.deepEqual(unexpected, []);
  }
});
test('unexpected stream failures are reported and synchronous broken writes are bounded', () => {
  const stdout = pipe(), stderr = pipe(), unexpected = [];
  const output = createQaOutput({ stdout, stderr, onError: error => unexpected.push(error.code) });
  stdout.write = () => { throw Object.assign(new Error('closed'), { code: 'EPIPE' }); };
  assert.equal(output.out('test'), false); assert.equal(output.out('retry'), false);
  stderr.emit('error', Object.assign(new Error('unexpected'), { code: 'EIO' }));
  assert.deepEqual(unexpected, ['EIO']);
});
