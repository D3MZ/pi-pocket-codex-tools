import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSearch as create } from "../codex-tools.ts";

test("Codex adapter uses an isolated directory and returns sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-adapter-test-"));
    const previous = process.env.PI_CODEX_WEB_SEARCH_CODEX_PATH;
    const binary = join(dir, "codex");
    const record = join(dir, "record.json");

    try {
        await writeFile(
            binary,
            `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({args, cwd: process.cwd()}));
let prompt = '';
process.stdin.on('data', c => prompt += c);
process.stdin.on('end', () => {
if (!prompt.includes('test query')) process.exit(2);
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({summary:'Found it', sources:[{title:'Example',url:'https://example.com',snippet:'Evidence'}]}));
});\n`,
            { mode: 0o700 },
        );
        process.env.PI_CODEX_WEB_SEARCH_CODEX_PATH = binary;
        const tool = create().tools![0]!;
        const result = await tool.execute(
            { query: "test query", freshness: "cached", maxSources: 1 },
            {} as never,
            {} as never,
        );
        const recorded = JSON.parse(await readFile(record, "utf8"));

        assert.match(JSON.stringify(result), /https:\/\/example.com/);
        assert.ok(recorded.args.includes('web_search="cached"'));
        assert.ok(recorded.args.includes("read-only"));
        assert.notEqual(recorded.cwd, process.cwd());
        await assert.rejects(readFile(join(recorded.cwd, "result.json")), /ENOENT/);
        await assert.rejects(tool.execute({ query: " " }, {} as never, {} as never), /non-empty/);
    } finally {
        if (previous === undefined) {
            delete process.env.PI_CODEX_WEB_SEARCH_CODEX_PATH;
        } else {
            process.env.PI_CODEX_WEB_SEARCH_CODEX_PATH = previous;
        }

        await rm(dir, { recursive: true, force: true });
    }
});
