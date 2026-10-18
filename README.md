# Pi Pocket Codex Tools

Codex web search and streaming dictation for [Pi Pocket](https://github.com/TannerMidd/pi-pocket). No voice replies or provider replacement.

Dictation is ported from **[pi-codex-conversion](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion)** by Igor Warzocha. The search adapter follows [ayagmar/pi-codex-web-search](https://github.com/ayagmar/pi-codex-web-search). MIT licensed. This is not an official OpenAI extension.

## Install

Requires Node 24+, Pi Pocket 0.14+, and Codex CLI on the server.

Clone this repository, then run:

```sh
node install.mjs
# Custom Pocket data directory: node install.mjs /path/to/data
```

Enable **codex-tools** in **Menu → Extensions**. No server restart is necessary.

- Search uses `codex login`; dictation uses Pi’s `openai-codex` sign-in.
- Microphone access requires HTTPS or localhost.
- Tap the mic beside Send. Tap it again to stop, or tap Send to finalize and send.
- Audio goes to OpenAI and stays off disk. The extension runs with the server owner’s rights.
- Dictation defaults to English. Set `PI_CODEX_DICTATION_LANGUAGE` to another ISO language code before server startup.

Development: `npm ci && npm run check && npm test`. Optional real-Pocket mobile tests: `PI_POCKET_SOURCE=/path/to/pi-pocket npm run test:pocket`.
