import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const data = resolve(process.argv[2] || process.env.PI_POCKET_DIR || join(homedir(), ".pi-pocket"));
const extensions = join(data, "extensions");
const client = join(extensions, "codex-tools");
const temporary = join(extensions, `codex-tools.${process.pid}.tmp`);

await mkdir(client, { recursive: true });

try {
    // Publish the server entry last. It contains all server code, so updates do
    // not leave cached helper modules behind and do not require a restart.
    await copyFile(join(source, "codex-tools", "types.d.ts"), join(client, "types.d.ts"));
    await copyFile(join(source, "codex-tools", "index.js"), join(client, "index.js"));
    await copyFile(join(source, "codex-tools.ts"), temporary);
    await rename(temporary, join(extensions, "codex-tools.ts"));
} finally {
    await rm(temporary, { force: true });
}

console.log(`Installed codex-tools in ${extensions}`);
console.log(
    "Read the source, then enable codex-tools in Menu → Extensions. Existing enabled installs reload automatically.",
);
