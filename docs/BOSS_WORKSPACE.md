# Boss workspace

Converge uses three conversations: a boss and two workers. You give the boss a task; it chooses separate instructions for the workers, reads their results, and directs the next round of work.

This guide describes the **1.9.9 Windows portable**. See its [verification record](WINDOWS_1_9_9_VERIFICATION.md) for the exact build and completed checks, [document design guide](DOCUMENT_QUALITY.md) for presentation requirements, and [model error recovery](MODEL_ERROR_RECOVERY.md) for current reconnect, response-error and prompt-capacity behavior. Its installer and Mac build are deferred until the user verifies the Windows update. The published Apple Silicon Mac app is still **1.8.1**; see its [Mac guide](MACOS_GUIDE.md) for installation and Command shortcuts. Earlier verification records retain their own version's scope.

## Connect and start

1. Open Converge. In **Session**, choose **Import JSON file** and select a current ChatGPT cookie export.
2. Choose **Normal**, **Temporary**, or **Work mode** and open the workspace. Work requires your account to expose that chat mode.
3. Select the model you want in each of the three ChatGPT pages. Click the middle boss character to reveal its page. The app does not upgrade or change the model you select.
4. Attach any source documents, images or code using the controls drawer or the boss attachment button. Wait for **Attached to the team**: source files must be confirmed on all three conversations before the task can start.
5. Enter your task in the boss instruction box or the controls drawer, then start. Watch the two workers and the progress bar.

Use the app's **boss instruction box** to control the team. Typing directly into a native ChatGPT composer is outside the tracked exchange and can interrupt it. Model menus remain available in those pages.

## Add ideas while it works

Open the boss panel by clicking the middle character. Send your additional instruction through its instruction box. While a model is busy, the app queues your instruction and gives it to the boss before further assignments or completion. The queue status shows whether the instruction is waiting.

After a task finishes, another boss instruction uses the same conversations. **Stop** cancels the current exchange. **Reset** opens the chat-type choice again and clears the three conversations while retaining the imported session.

## Long responses, monitoring and Continue

Each model request has a **two-hour observation allowance**. Expiry checks and extends observation of healthy owned work within the **24-hour workflow limit**, instead of stopping all three chats. The selected work-cycle limit also applies. File processing uses separate allowances while the workflow clock continues to run. A model thinking for 40–60 minutes is within the default allowance.

While worker requests are pending, the app checks them every **five minutes**. A model that is still generating is left running. A quiet page, a delayed probe or a temporary page-layout change is not enough to trigger a retry. The monitoring history appears in the bottom drawer's **Full exchange** section.

When the page reports that an app-owned worker response was interrupted, the app immediately verifies that request. Once it is confirmed idle with no newer human message, the boss receives a focused repair job for that one worker while its teammate continues. Three unsuccessful focused repairs report a specific attention need with retained results. Busy generation is left running. A reload or lost acknowledgement reconnects observation to the exact original turn without another Send or Stop. An unfinished response never counts as a completed cycle or accepted result.

If the boss needs missing information, or a time/cycle limit is reached, read the current result and issues, open the boss panel, enter the information or instruction needed to proceed, then press **Continue task**. This keeps the same task, conversations and completed outputs, renews the workflow time allowance, and asks the boss to replan. Final acceptance must be checked again. Unfinished requests cancelled at a time limit are not replayed automatically. If the selected cycle limit is exhausted, increase it before continuing; the maximum is **12**.

**Continue task** applies to blocked or limited work. After **Stop** or a completed task, a new instruction starts a new task in the same chats. Stop remains available during file processing and model work. Session expiry, provider limits or unavailable required evidence still need to be resolved; monitoring cannot make those prerequisites disappear.

## How the boss directs the workers

The boss chooses the substantive worker prompts. The application adds a small message protocol so it can route assignments, identify results and verify completion. Worker tasks can differ: for example, one worker can develop a solution while the other checks evidence or edge cases.

The boss receives the workers' answers and supported generated files. A final candidate must be checked by both workers using the same candidate identity. File hashes bind those checks to the actual output bytes; an older file or a different revision cannot silently replace the checked file.

Improvement tasks retain a minimum review requirement and a maximum round limit. Simple immutable arithmetic can use a shorter verification path. A run can stop because of missing evidence, rejected checks, a model limit or a transport error. Read the final status before treating an output as complete.

Agreement improves the review process but is not proof of factual correctness, profitability or error-free code. Tasks requiring backtests, measurements or source data still need that evidence.

## Read the bottom results drawer

Click the lower progress band to open these sections:

- **Current answer** shows the candidate, its revision trail and files, plus the boss's final summary, reported checks and remaining limitations when available. A result marked **review in progress** or **review unfinished** is not the final checked answer.
- **Full exchange** shows the complete work/review history and **Team monitoring**, including the last worker check and interruption/recovery events.
- **Remaining issues** combines unresolved findings and missing work with the current workflow error, findings from the current final checkers and the boss's stated limitations. An empty issue list by itself does not prove that tests ran or that all claims are correct.

Use **Copy**, **Export .md** or **Save current files / Save final files** as appropriate. Markdown export includes the workflow status, candidate history, monitoring events and the same remaining issues/limitations, so an unfinished result retains that context outside the app. A saved partial candidate remains partial. The app's byte hashes establish which files were reviewed; model-reported test claims need independent evidence for tasks that require it.

## Appearance

**Chat background** controls the actual embedded pages and their empty placeholders:

- **Night sky**: a still galaxy with stars.
- **Black horror**: deep black with muted crimson light.
- **Alien**: a green and violet atmosphere with a distant glowing moon.
- **Cyberpunk**: a dark futuristic skyline, cyan and magenta light, and a geometric horizon.
- **Anime**: a painted dusk sky with a warm moon and a soft blossom silhouette.

**Character style** changes the team's animated figures. The existing atmosphere selection changes the top and bottom decoration. Turn animations off in settings or with the header effects button. The chat backgrounds remain still; hidden or minimized windows suspend decorative animation. System reduced-motion preferences are respected.

## Files and troubleshooting

- Source selection accepts up to **five files**, **512 MiB per file** and **1 GiB combined**. MiB means 1,048,576 bytes. Unsupported formats must be converted before uploading.
- Generated files are transferred as actual bytes when the page exposes a supported downloadable file or image. The app cannot transfer a file that the model only describes.
- Combined source and worker results support up to **15 distinct attachments**, staged in batches of **five files / 1 GiB**, with the same **512 MiB per-file** cap. The boss can additionally receive up to three complete host-created text context files for long replies and structured reviews. Every expected attachment must be confirmed before the prompt is sent. Large files use bounded reads and transfer messages inside the app.
- ChatGPT applies lower limits to images (**20 MB**), CSV/spreadsheets (**about 50 MB**) and text/documents (**2 million tokens per file**). Account quotas also apply. The app cap does not guarantee provider acceptance. Do not assume an upload succeeded because a filename first appeared. [OpenAI file-upload FAQ](https://help.openai.com/en/articles/8555545-file-uploads-faq).
- Upload progress reports actual bytes during local reading and transfer. While the chat service processes the attachment, the indicator has no percentage. Use **Cancel upload** in the sidebar or **Stop** in the top bar to stop a pending transfer.
- If source attachment status is incomplete, press **Check pending uploads**. The app checks the existing upload receipts on all three pages without selecting or uploading the same files again. A late completion can become usable; a genuinely missing or rejected attachment remains incomplete. Resolve the rejection or Reset to a fresh workspace before selecting the files again.
- Upload previews have up to **30 minutes** to finish. Native generated-file downloads have up to **30 minutes per file**; a five-file export has a bounded three-hour allowance including page acknowledgement. These are separate from model response budgets. Exceeding a file-operation allowance produces a visible error; it does not count as a successful transfer. You can stop a pending operation manually.
- Save the current reviewed files using the output drawer. Sources and generated outputs have separate identities.
- An expired session or a changed ChatGPT page can prevent readiness. Import a current export and check the pages. Reset does not log out Chrome.
- If you manually edit a page during an automatic exchange, stop the run before continuing through the boss instruction box.

The imported session lives in this app's separate isolated browser session. Large source bytes use a private local file cache, and saved projects retain verified copies. Closing the app clears the isolated session and invalidates its private file capabilities; cached documents and saved project files can remain on local disk. Closing the app does not establish deletion of those bytes. Do not upload cookie exports to GitHub or include them in screenshots.
