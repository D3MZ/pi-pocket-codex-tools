# Pi Pocket Codex Tools

Codex web search and streaming dictation for [Pi Pocket](https://github.com/TannerMidd/pi-pocket). No voice replies or provider replacement.

Dictation is ported from **[pi-codex-conversion](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion)** by Igor Warzocha. The search adapter follows [ayagmar/pi-codex-web-search](https://github.com/ayagmar/pi-codex-web-search). MIT licensed. This is not an official OpenAI extension.

## Install

Paste this into your clanker:

```text
Install Pi Pocket Codex Tools from this repository. Ask me for its URL if necessary.
On the Pocket server, locate the active Pocket data directory and read the extension source.
Copy codex-tools/index.js and codex-tools/types.d.ts into <data>/extensions/codex-tools/.
Then copy codex-tools.ts into <data>/extensions/ last.
Use Pocket's existing dependencies. Do not change settings, credentials, or enable the extension yourself.
Check Node 24+, Pocket 0.14+, Codex CLI, and HTTPS microphone access.
Tell me to enable codex-tools in Menu → Extensions. An enabled installation reloads without a restart.
```

Search uses `codex login`; dictation uses Pi's `openai-codex` sign-in. Tap the mic beside Send to dictate. Tap it again to stop, or tap Send to finalize and send.

Audio goes to OpenAI and stays off disk. Dictation defaults to English. Set `PI_CODEX_DICTATION_LANGUAGE` before server startup to use another language.
