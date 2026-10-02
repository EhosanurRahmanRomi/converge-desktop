'use strict';

const { getCodexStatus, createCodexClient } = require('../src/core/codex-cli');
const { runDebate } = require('../src/core/engine');

async function main() {
  const status = await getCodexStatus();
  if (!status.available || !status.loggedIn) throw new Error('Codex CLI is unavailable or not signed in.');
  const result = await runDebate({
    client: createCodexClient(status.cliPath),
    question: 'What is 2 + 2? Give only the number.',
    settings: {
      left: { model: 'gpt-5.6-sol', effort: 'low' },
      right: { model: 'gpt-5.6-sol', effort: 'low' },
      maxRounds: 3
    },
    onEvent(event) {
      if (event.type === 'stage') process.stdout.write(`${event.text}\n`);
    }
  });
  if (result.status === 'error' || !/\b4\b/.test(result.answer)) {
    throw new Error(`Debate failed: ${result.status} ${result.error || ''}`);
  }
  const verdicts = result.transcript.filter((item) => item.role === 'verify').map((item) => `${item.side}:${(item.text.match(/^Final check: (\w+)/) || [,'?'])[1]}`);
  process.stdout.write(`Debate completed: ${result.status}; ${result.usage.calls} model calls; ${result.issues.filter((issue) => issue.status === 'open').length} open issues; checks ${verdicts.join(', ')}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
