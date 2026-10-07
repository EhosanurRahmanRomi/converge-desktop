> Historical project record. This preserves an earlier design or test scope; it is not the current installation guide. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Authentication options for the debate app

The desktop app needs a supported way to make two independent model requests. Automatic mode now supports a signed-in Codex CLI or an OpenAI API key. Neither uses Chrome cookies or accesses existing ChatGPT conversations.

## 1. Signed-in Codex CLI (implemented, default)

Converge bundles Codex CLI 0.154.0 and calls its supported noninteractive `codex exec` command. The user signs in to Codex with their ChatGPT account; this PC is already signed in. Each model turn is ephemeral, uses a read-only temporary workspace, and is asked for a structured JSON answer. Converge copies the resulting critique into the other analyst's next model input. The app keeps the debate transcript in memory and removes temporary source files after each turn. It does not use or inspect the user's Chrome cookies.

Model availability depends on the signed-in account and Codex CLI version. The tested default is `gpt-5.6-sol` at Max effort; `gpt-6-sol` was rejected by this CLI's ChatGPT-account route. Usage limits can interrupt a debate. See [Codex noninteractive mode](https://developers.openai.com/codex/noninteractive).

## 2. User supplied OpenAI API key

**Prerequisites:** The user creates an API key in the OpenAI Platform, has access to the selected API model, and has API billing or credits available. API usage is separate from ChatGPT subscription usage. The app must never ship with a developer key; store a user supplied key in the operating system's secure credential store or use it for the current session only.

**Current implementation:** `src/core/api.js` sends Responses requests with `store: false`, strict JSON Schema output, inline image/file inputs, cancellation, and bounded retries. Converge keeps the debate transcript in memory. `store: false` does not mean zero retention: ordinary API abuse monitoring logs may retain content. Attachments are sent inline, without using the Files upload API.

**Sources:** [API key guidance](https://developers.openai.com/api/docs/guides/production-best-practices), [API models](https://developers.openai.com/api/docs/models), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [data controls](https://developers.openai.com/api/docs/guides/your-data), [ChatGPT plan versus API key usage](https://learn.chatgpt.com/docs/pricing).

## 3. Direct Sign in with ChatGPT integration (not implemented)

**Prerequisites:** Publish the client as an open-source, locally hosted app; the user needs an eligible ChatGPT Plus or Pro account and must authorize the app's Responses scopes. Implement the official OAuth registration and PKCE sign-in flow, persist a stable host ID and issued client ID, validate tokens and scopes, refresh credentials, and store tokens securely. Paid or remotely hosted apps require OpenAI's partner interest process. This is account sign-in, not cookie import; it does not give the app the user's ChatGPT chats, memories, or API key.

**Inference requirements:** Fetch the signed-in account's model list and use its model slugs. Send its OAuth access token to the public Responses endpoint with `store: false` and `stream: true`; consume events through `response.completed`. Supply full context in `input` on each HTTP request. `previous_response_id` is unsupported over HTTP in this flow. Text, images, and inline files are supported when the model accepts them; the Files upload API, image generation, file search, Code Interpreter, and several other tools and request fields are unavailable. The current nonstreaming API key adapter cannot be reused without a streaming implementation.

**Sources:** [Sign in quickstart](https://developers.openai.com/siwc/quickstart), [open-source plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Browser cookie route

Electron can display two web pages and set cookies in its own browser session, but importing a Chrome session is not a documented OpenAI authentication method. OpenAI's current Terms of Use prohibit automatically or programmatically extracting ChatGPT Output, which an automatic browser-page relay would require. A user-controlled dual-page view with manual copying can be offered separately. ChatGPT's Temporary > Unpersonalized choice is made in its own UI before the first message; an API `store: false` request is not the same product mode.

**Sources:** [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/), [Temporary Chat](https://help.openai.com/en/articles/8914046-temporary-chat-in-chatgpt), [Electron sessions](https://www.electronjs.org/docs/latest/api/session), [Electron cookies](https://www.electronjs.org/docs/latest/api/cookies).
