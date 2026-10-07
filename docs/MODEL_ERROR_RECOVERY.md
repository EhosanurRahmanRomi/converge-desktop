# Model errors and workflow recovery

Converge cannot make a model error impossible. It must identify the response that failed, preserve actual completed work, and recover without interrupting a healthy teammate.

## What the app observes

| Observed condition | App response | What it does not establish |
| --- | --- | --- |
| Connection interrupted; waiting for the complete answer | Keep the same owned request, show reconnecting, inspect every 30 seconds | The response is finished or a network root cause is known |
| Fresh owned response-generation error or unavailable response stream | Preserve the terminal error receipt; wait for native generation to become idle; request a bounded boss repair | The partial text is a complete answer |
| Owned timeout, message-delivery or server error | Immediately verify the current request and ask the boss to continue only the failed idle worker | The provider's underlying failure cause is proven |
| A completed answer has an unsupported file or failed download | Keep the healthy peer and its actual files; ask the boss for a supported re-export from completed work | The missing file was delivered |
| The provider rejects a submitted message as too long | Keep the submitted turn; wait for idle and ask for a smaller focused continuation preserving its scope | Resending the same oversized prompt will work |
| Navigation, a lost acknowledgement or an expired observation timer | Reconnect observation to the exact original tracked user turn; do not Send again | Another conversation or later human turn belongs to this request |
| A file has incorrect metadata or a hash mismatch | Fail closed and retain the diagnostic | Its bytes can be trusted |

Recovery is bound to the exact submitted request. Historical errors, quoted text and unrelated human turns are excluded. A native busy control remains authoritative: the supervisor does not click Stop or Retry. Three unsuccessful interruption repairs block with retained evidence instead of looping indefinitely.

## Scoped supervision in 1.9.7

The host checks all owned pending chats every five minutes. A failure published by an owned page triggers an immediate proof check. Interrupted generation that still has an active native Stop control and nonterminal reconnection are checked every 30 seconds; neither permits a new worker submission until the original request is confirmed idle.

The boss receives a recovery job for the failed worker immediately, even while its teammate is still generating. Its recovery control reply must name that one side. The host rejects a plan that replaces both workers, finishes early or switches to a different candidate. If both workers fail, the boss handles their recovery plans in sequence. A failed boss recovery plan is itself observed and retried within a bound. Successful peer results and exact downloaded bytes remain in the current pair. A pair counts as completed only after both actual worker results arrive.

The two-hour allowance is an observation budget. Its expiry now checks and extends observation within the 24-hour workflow cap instead of globally cancelling healthy generation. Explicit Stop remains immediate. If exact ownership cannot be confirmed, the app preserves healthy work and reports what needs attention; it does not duplicate a possibly delivered message. Corrupt output identity still fails closed. Files never actually exposed by the provider are not assumed recoverable.

The bottom monitoring drawer records the observed failure, reconnection, focused repair and retained work. Those recovery events are saved as historical evidence, without persisting active request authority.

## Source transfer and saved evidence in 1.9.6

The live 1.9.5 CED test exposed a rejected `.tex` download. Version 1.9.6 transfers LaTeX source as validated inert UTF-8 text, using a byte-identical `.tex.txt` upload alias where the provider needs one. Capture and export retain the canonical `.tex` name. MIME/extension matching, exact lengths, Unicode decoding and SHA-256 remain mandatory. This is file transport; it does not compile or execute transferred source.

Complete historical final-review evidence is now included in project persistence. Loading a project preserves this history but clears pending requests, old acceptance and current verification authority; final checks must be performed again for the resumed candidate.

## Prompt size and useful production

Long worker answers are preserved in project history and relayed as complete UTF-8 text attachments with exact upload names, lengths and SHA-256 values. A compact reference replaces duplicate inline text. Large structured reviews use one complete JSON-as-text attachment; precise pointers retain all review entries and criterion statuses, while host validation continues using full records. These host-created context files are evidence, not worker deliverables. Required PDF production remains due when a worker has returned only an audit table or Markdown report.

For large tasks, the boss assigns bounded sections, preserves their real files, then combines and checks them. The requested scope and derivation steps belong in the deliverable; chat control replies can remain concise. Observation continues for a healthy owned request within a 24-hour workflow bound.

## What the official guidance supports

OpenAI's [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6) recommends leaner prompts, removing redundant instructions while preserving hard requirements, and reevaluating changes. Its [reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning-best-practices) recommends clear goals and direct instructions.

The [API error guide](https://developers.openai.com/api/docs/guides/error-codes) separates connection, timeout, server and rate-limit failures. Those categories are useful diagnostic context, but they do not identify the cause of a particular ChatGPT web interruption. Converge records the observed web state and its recovery; it does not label an unverified network or server cause as proven.

## Answer quality and final files

A finish requires actual requested files, an exact selected candidate, both independent final reviews, and enabled verification gates. Local identity and format checks are executed evidence. Content assessments remain model evidence. Agreement, extra time and file hashes do not guarantee correctness or confer a higher model's capability. A lecture PDF also needs source coverage and rendered visual checks.

## Common questions

**Why did a long task stop?** In the observed CED run, an unsupported TSV output triggered global cancellation. A nonterminal connection warning was also shown as active generation. Those are confirmed app defects addressed by the transport and reconnect repairs. The provider's underlying reason for a connection or generation failure is not established by its visible error alone.

**Why did the models return text instead of the PDF?** Audit files were incorrectly sufficient to clear the PDF production checkpoint. The checkpoint now requires the requested output type. A partial section PDF remains a draft; full coverage and final acceptance are separate requirements. A model still needs working file-generation tools to produce the deliverable.

**Can the boss recover every interruption?** It can replan after a confirmed owned failure and retain completed peer responses and captured file bytes. Files that were created only inside an interrupted model's tool environment and never exposed as a completed downloadable response are not guaranteed recoverable. Bounded downloadable checkpoints reduce that loss.

**Does repeated review make every answer 100% correct?** No. It can uncover omissions and errors. The final report must show source coverage, actual tests, model assessments and unresolved limits. Longer review does not change the underlying model or establish equivalence to another model or reasoning setting.
