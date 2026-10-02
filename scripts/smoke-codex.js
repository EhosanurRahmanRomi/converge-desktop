'use strict';

const { getCodexStatus, createCodexClient } = require('../src/core/codex-cli');

async function main() {
  const status = await getCodexStatus();
  if (!status.available || !status.loggedIn) throw new Error('Codex CLI is unavailable or not signed in.');
  const response = await createCodexClient(process.env.CONVERGE_CLI_PATH || status.cliPath).requestStructured({
    model: 'gpt-5.6-sol',
    effort: 'max',
    instructions: 'Answer the tiny arithmetic question. Do not use tools.',
    inputText: 'What is 2 + 2?',
    attachments: [],
    schema: {
      type: 'object', additionalProperties: false,
      properties: { answer: { type: 'string' } }, required: ['answer']
    }
  });
  if (String(response.data.answer).trim() !== '4') throw new Error(`Unexpected answer: ${response.data.answer}`);
  process.stdout.write('Codex CLI structured request passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
