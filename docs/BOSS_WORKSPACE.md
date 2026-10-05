# Boss workspace

Converge 1.8.1 on Windows and Apple Silicon Mac uses three conversations: a boss and two workers. You give the boss a task; it chooses separate instructions for the workers, reads their results, and directs the next round of work. See the [Mac guide](MACOS_GUIDE.md) for installation and Command shortcuts.

## Connect and start

1. Open Converge and import a current ChatGPT cookie JSON file in **Connect your session**.
2. Choose **Normal**, **Temporary**, or **Work mode** and open the workspace. Work requires your account to expose that chat mode.
3. Select the model you want in each of the three ChatGPT pages. Click the middle boss character to reveal its page. The app does not upgrade or change the model you select.
4. Attach any source documents, images or code using the controls drawer. Source files are provided to all three conversations.
5. Enter your task in the boss instruction box or the controls drawer, then start. Watch the two workers and the progress bar.

Use the app's **boss instruction box** to control the team. Typing directly into a native ChatGPT composer is outside the tracked exchange and can interrupt it. Model menus remain available in those pages.

## Add ideas while it works

Open the boss panel by clicking the middle character. Send your additional instruction through its instruction box. While a model is busy, the app queues your instruction and gives it to the boss before further assignments or completion. The queue status shows whether the instruction is waiting.

After a task finishes, another boss instruction uses the same conversations. **Stop** cancels the current exchange. **Reset** opens the chat-type choice again and clears the three conversations while retaining the imported session.

## How the boss directs the workers

The boss chooses the substantive worker prompts. The application adds a small message protocol so it can route assignments, identify results and verify completion. Worker tasks can differ: for example, one worker can develop a solution while the other checks evidence or edge cases.

The boss receives the workers' answers and supported generated files. A final candidate must be checked by both workers using the same candidate identity. File hashes bind those checks to the actual output bytes; an older file or a different revision cannot silently replace the checked file.

Improvement tasks retain a minimum review requirement and a maximum round limit. Simple immutable arithmetic can use a shorter verification path. A run can stop because of missing evidence, rejected checks, a model limit or a transport error. Read the final status before treating an output as complete.

Agreement improves the review process but is not proof of factual correctness, profitability or error-free code. Tasks requiring backtests, measurements or source data still need that evidence.

## Appearance

**Chat background** controls the actual embedded pages and their empty placeholders:

- **Night sky**: a still galaxy with stars.
- **Black horror**: deep black with muted crimson light.
- **Alien**: a green and violet atmosphere with a distant glowing moon.
- **Cyberpunk**: a dark futuristic skyline, cyan and magenta light, and a geometric horizon.
- **Anime**: a painted dusk sky with a warm moon and a soft blossom silhouette.

**Character style** changes the team's animated figures. The existing atmosphere selection changes the top and bottom decoration. Turn animations off in settings or with the header effects button. The chat backgrounds remain still; hidden or minimized windows suspend decorative animation. System reduced-motion preferences are respected.

## Files and troubleshooting

- Source selection accepts up to five files, 12 MB per file and 24 MB combined. Unsupported formats must be converted before uploading.
- Generated files are transferred as actual bytes when the page exposes a supported downloadable file or image. The app cannot transfer a file that the model only describes.
- Combined source and worker results support up to 15 distinct attachments, staged in batches of five files and 24 MB. Every expected attachment must appear before the prompt is sent; provider limits or a missing receipt stop the transfer visibly. A provider may impose a lower cumulative limit.
- Save the current reviewed files using the output drawer. Sources and generated outputs have separate identities.
- An expired session or a changed ChatGPT page can prevent readiness. Import a current export and check the pages. Reset does not log out Chrome.
- If you manually edit a page during an automatic exchange, stop the run before continuing through the boss instruction box.

The imported session lives in this app's separate temporary browser session. Source file bytes and the active task remain in process memory. Do not upload cookie exports to GitHub or include them in screenshots.
