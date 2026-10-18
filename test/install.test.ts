import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

test("installer creates a self-contained drop-in and leaves Pocket settings untouched", async () => {
    const data = await mkdtemp(join(tmpdir(), "codex-install-"));

    try {
        await run(process.execPath, [join(import.meta.dirname, "../install.mjs"), data]);
        const files = await readdir(join(data, "extensions"));
        const server = await readFile(join(data, "extensions/codex-tools.ts"), "utf8");

        assert.deepEqual(files.sort(), ["codex-tools", "codex-tools.ts"]);
        assert.deepEqual(await readdir(data), ["extensions"]);
        assert.ok(server.includes('web.client("codex-tools")'));
        assert.doesNotMatch(server, /docs\/examples|\.\.\/\.\.\/types|import .*dictation\.ts/);
        assert.deepEqual((await readdir(join(data, "extensions/codex-tools"))).sort(), [
            "index.js",
            "types.d.ts",
        ]);
        // Running it twice is safe and updates the same entry.
        await run(process.execPath, [join(import.meta.dirname, "../install.mjs"), data]);
        assert.equal(await readFile(join(data, "extensions/codex-tools.ts"), "utf8"), server);
    } finally {
        await rm(data, { recursive: true, force: true });
    }
});
