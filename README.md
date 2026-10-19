# Pi Pocket Codex Tools

Codex web search and microphone dictation for [Pi Pocket](https://github.com/TannerMidd/pi-pocket). No voice replies or provider replacement.

Dictation is ported from **[pi-codex-conversion](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion)** by Igor Warzocha. The search adapter follows [ayagmar/pi-codex-web-search](https://github.com/ayagmar/pi-codex-web-search). MIT licensed. This is not an official OpenAI extension.

## Install

Paste this into your clanker:

```text
Install Pi Pocket Codex Tools from https://github.com/SlightlyOffSync/pi-pocket-codex-tools.
On the Pocket server, locate the active Pocket data directory and read the extension source.
Copy codex-tools/index.js and codex-tools/types.d.ts into <data>/extensions/codex-tools/.
Then copy codex-tools.ts into <data>/extensions/ last.
Use Pocket's existing dependencies. Do not change settings, credentials, or enable the extension yourself.
Check Node 24+, Pocket 0.14+, Codex CLI, and HTTPS microphone access.
Tell me to enable codex-tools in Menu → Extensions. An enabled installation reloads without a restart.
```

Search uses `codex login`; dictation uses Pi's `openai-codex` sign-in. Tap the mic beside Send to dictate. A scrolling microphone-level history covers the message box while recording; the existing draft stays intact underneath. Tap the left stop icon or the display to stop, or tap Send to finalize and send.

Dictation uses `gpt-transcribe` and defaults to English. Set `PI_CODEX_DICTATION_LANGUAGE` before server startup to use another language. This model requires explicit audio commits, so server-side turn detection is disabled.

## Local development

The sibling checkout at `~/Work/pi-pocket-codex-tools/` is the canonical source. It tracks `SlightlyOffSync/pi-pocket-codex-tools` on GitHub.

The active Pocket data folder holds a deployed copy of `codex-tools.ts` and `codex-tools/`, with no Git metadata or history. After a change, commit and push from the canonical checkout, then copy those files from that commit into Pocket. Copy the browser/type files first and the server entry last. Do not edit the deployed copy independently.

## Data and permissions

- **Search:** Pi calls `codex_web_search` with a query. The server starts local `codex exec`, outside the workspace, with an ephemeral session and a read-only sandbox. The query goes to the service in your Codex configuration, normally OpenAI at `chatgpt.com`. Codex controls its own network connections, credential refresh, and configuration; custom providers can contact other hosts. The extension does not implement login.
- **Search files:** The extension writes a schema and result in a temporary directory, then removes it. Codex reads its existing credentials and configuration, normally under `~/.codex/` or `CODEX_HOME`, and can update its own caches. It inherits the server environment. `PI_CODEX_WEB_SEARCH_CODEX_PATH` selects the executable. The read-only sandbox is not a separate credential vault.
- **Dictation:** Only the owner can load the browser module and call its four routes. A mic tap requests browser microphone permission and starts audio capture. The browser sends PCM audio through this extension's routes to the Pocket server. The server sends it to `wss://api.openai.com/v1/realtime?intent=transcription` with your Codex access token and account ID. A recording accepts at most 3 minutes of audio. At the limit, the browser stops the microphone and shows a small inline “Stopped · 3-minute limit” label while transcription finishes, without a popup.
- **Pi credentials:** On dictation start, Pi's `ModelRuntime` reads `auth.json` and `models.json` in `host.agentDir`, normally `~/.pi/agent/`. It resolves the `openai-codex` credential and can refresh it through `auth.openai.com` and update stored credentials. The extension checks that the resolved provider URL is the standard `https://chatgpt.com/backend-api/codex`; the audio connection itself goes to `api.openai.com`. Tokens stay on the server and go only to OpenAI's authentication/transcription services.
- **Results:** Audio stays in browser/server memory; this extension does not write audio files. OpenAI receives the audio; its retention policies apply. Transcripts return only to the requesting owner, then appear in the message draft. Sending the draft stores it as a normal Pocket message and sends it to that session's model provider. Search results appear in tool output, visible to the session and its model provider. Search output is fenced as untrusted data.
- **No background telemetry:** This extension starts no audio connection until a mic tap and starts no search until a tool call. It installs one search tool, four dictation routes, a browser module, and a tool-call label. It adds no hooks, commands, prompt sections, or tool wraps.

## Gallery status

The files already use the gallery layout: `codex-tools.ts` and `codex-tools/`. They need no install script, package installation, or build on the Pocket server. The module declares Pocket API 1 and targets Pi Pocket 0.14+ with its pinned Earendil 1.1.0 packages.

Load-checked against the gallery's `release/0.14.0` reference at `80f94025a6fb3b6bc46a890a99ea5c6eddfc3c16`, using installed Earendil 1.1.0 dependencies. The isolated check confirmed one search tool, four owner-only routes, and an owner-only browser module. TypeScript, browser syntax, and search-result fencing checks passed. These checks do not constitute gallery approval.

**The current dictation UI is not gallery-ready.** It reads and changes Pocket's composer DOM, hides the built-in microphone, intercepts Send/Enter, and clicks Pocket's Send button. These are internal interfaces, not public extension APIs. The gallery rules prohibit this ([S2.1](https://tannermidd.github.io/pi-pocket/docs/extensions/policies/security-model/) and [G18](https://tannermidd.github.io/pi-pocket/docs/extensions/policies/gallery-review/)). A successful module load does not remove this review blocker.

Before submission, request a public composer/dictation extension point upstream, then port the browser module to it. Alternatively, redesign dictation as a separate extension page with manual transcript transfer. This repository keeps the current UI behavior; it does not claim gallery approval.

Once compliant, use **Menu → Extensions → codex-tools → Share…** to generate file sizes, hashes, and declarations. Pin a full commit from this public repository and submit only `entries/codex-tools.json` to [TannerMidd/pi-pocket-extensions](https://github.com/TannerMidd/pi-pocket-extensions). Keep this repository's `LICENSE` at the pinned commit. The gallery installs files off; the owner enables them. Updates require a new reviewed entry and owner approval.
