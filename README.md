# Pi Pocket Codex Tools

Codex web search and voice dictation for [Pi Pocket](https://github.com/TannerMidd/pi-pocket).

- Web search through the Codex CLI and its existing login.
- Dictation with `gpt-transcribe`, using Pi's OpenAI Codex sign-in.
- Scrolling microphone levels, append-to-draft behavior, and recordings up to 3 minutes.

## Install

Requires Node.js 24+, Pi Pocket 0.14+, and HTTPS or localhost for microphone access. Web search also requires the Codex CLI.

Paste this into your clanker:

```text
Install Pi Pocket Codex Tools from https://github.com/SlightlyOffSync/pi-pocket-codex-tools.
Read the extension source.
Locate the active Pi Pocket data directory.
Copy codex-tools/index.js and codex-tools/types.d.ts into <data>/extensions/codex-tools/.
Copy codex-tools.ts into <data>/extensions/ last.
Use Pi Pocket's existing dependencies. Do not change credentials or enable the extension yourself.
Tell me to enable codex-tools in Menu → Extensions.
```

## Use

Ask Pi to search the web. Tap the mic beside Send to dictate.

The microphone display covers the text box without changing your existing draft. Tap its stop icon to finish dictation. Tap Send to finalize the transcript and send the message.

Dictation defaults to English. Set `PI_CODEX_DICTATION_LANGUAGE` before server startup to use another language. Audio goes to OpenAI for transcription. The extension does not save audio files.

## Credits

Dictation is adapted from [pi-codex-conversion](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion) by Igor Warzocha. Web search is adapted from [ayagmar/pi-codex-web-search](https://github.com/ayagmar/pi-codex-web-search).

[MIT licensed](LICENSE). Not affiliated with OpenAI.
