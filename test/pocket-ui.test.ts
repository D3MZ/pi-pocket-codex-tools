import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { test } from "node:test";
const pocketSource = resolve(
    process.env.PI_POCKET_SOURCE || join(import.meta.dirname, "../../pi-pocket"),
);
const loadPocket = (path: string) => import(pathToFileURL(join(pocketSource, path)).href);
// Pocket's helpers set up isolated data before the server modules load.
const { cleanUp, newSession, openApp, owner, root, scriptedModel, until } =
    await loadPocket("test/helpers.ts");
const { Browsers } = await loadPocket("src/server/browser.ts");
const { findBrowser } = await loadPocket("src/server/browser/discovery.ts");
const { createHandler } = await loadPocket("src/server/http.ts");

const chromium = findBrowser();

test(
    "Codex dictation buttons record, stop, and insert on mobile",
    {
        skip: chromium === undefined ? "No Chromium browser" : false,
    },
    async () => {
        const dropIns = join(root, "data", "extensions");

        mkdirSync(dropIns, { recursive: true });

        copyFileSync(
            join(import.meta.dirname, "../codex-tools.ts"),
            join(dropIns, "codex-tools.ts"),
        );
        cpSync(join(import.meta.dirname, "../codex-tools"), join(dropIns, "codex-tools"), {
            recursive: true,
        });

        const app = await openApp(scriptedModel());
        const server = createServer(
            createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
        );
        const browsers = new Browsers({
            dataDir: mkdtempSync(join(root, "codex-ui-")),
            load: async () => undefined,
            save: () => {},
        });

        try {
            await app.setExtensionEnabled(owner(app), "codex-tools.ts", true);
            const session = await newSession(app);

            await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
            const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
            const page = await browsers.open(1);
            const evaluate = async <T>(body: string): Promise<T> =>
                JSON.parse(await page.evaluate(body));

            const click = async (label: string) => {
                await page.evaluate(
                    `const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!button) throw new Error('No button: ' + ${JSON.stringify(label)}); button.click(); return 'null';`,
                );
            };

            const has = (label: string) =>
                evaluate<boolean>(
                    `return JSON.stringify([...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}));`,
                );

            await page.setViewport({ width: 390, height: 844, scale: 1, mobile: true });
            await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
            await page.navigate(`${base}/s/${session}`);
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(!!document.querySelector('[aria-label="Menu"]'));`,
                    ),
                "mobile menu",
            );
            // Stub only microphone hardware and provider responses. The real extension UI and PCM conversion run.
            await page.evaluate(`
            const realFetch = window.fetch;
            window.audioRequests = 0;
            window.earlyFrames = 0;
            window.startResolved = false;
            window.submits = [];
            window.fetch = async (input, options) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url.endsWith('/submit')) window.submits.push(JSON.parse(options.body).text);
                if (url.includes('/api/x/codex-tools/')) {
                    if (url.endsWith('/start')) { window.startResolved = false; await new Promise(r => setTimeout(r, 600)); window.startResolved = true; }
                    if (url.includes('/audio/')) window.audioRequests++;
                    return new Response(JSON.stringify(url.endsWith('/start') ? {id:'test'} : url.includes('/finish/') ? {text:'Mobile dictation test.'} : url.includes('/audio/') ? {text:'Mobile dictation'} : {}), {status:200, headers:{'Content-Type':'application/json'}});
                }
                return realFetch(input, options);
            };
            window.AudioContext = class {
                sampleRate = 24000;
                destination = {};
                resume() { return Promise.resolve(); }
                close() { return Promise.resolve(); }
                createMediaStreamSource() { return {connect(){}, disconnect(){}}; }
                createGain() { return {gain:{value:0}, connect(){}, disconnect(){}}; }
                createScriptProcessor() {
                    const processor = { connect(){}, disconnect(){clearInterval(timer);} };
                    const timer = setInterval(() => { if (!window.startResolved) window.earlyFrames++; processor.onaudioprocess?.({inputBuffer:{getChannelData:() => new Float32Array(4096)}}); }, 50);
                    return processor;
                }
            };
            navigator.mediaDevices.getUserMedia = async () => ({getTracks:() => [{stop(){}}]});
            return 'null';
        `);
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(!!document.querySelector('[data-codex-dictation]'));`,
                    ),
                "composer dictation button",
            );
            assert.ok(
                await evaluate<boolean>(
                    `const mic = document.querySelector('[data-codex-dictation]'); const send = document.querySelector('[data-part~="send-button"]'); const a = mic.getBoundingClientRect(); const b = send.getBoundingClientRect(); return JSON.stringify(mic.nextElementSibling === send && a.width >= 44 && a.height >= 44 && Math.abs(a.top - b.top) < 12 && a.right <= b.left + 1 && b.right <= innerWidth);`,
                ),
            );
            assert.equal(
                await evaluate<number>(
                    `return JSON.stringify(document.querySelectorAll('.rail-ext[title="Codex dictation"]').length);`,
                ),
                0,
            );
            await click("Codex dictation");
            assert.ok(
                await evaluate<boolean>(
                    `return JSON.stringify(document.querySelector('[data-codex-dictation]')?.getAttribute('aria-pressed') === 'true' && !window.startResolved);`,
                ),
                "mic responds before connection completes",
            );
            await until(() => has("Stop dictation"), "recording directly from composer");
            assert.equal(
                await evaluate<number>(
                    `return JSON.stringify(document.querySelectorAll('[role="dialog"]').length);`,
                ),
                0,
            );
            assert.equal(
                await evaluate<boolean>(
                    `return JSON.stringify(document.documentElement.scrollWidth <= innerWidth);`,
                ),
                true,
            );
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(document.querySelector('[data-part~="composer"] textarea')?.value === 'Mobile dictation');`,
                    ),
                "partial words appear before Stop",
            );
            assert.ok(await has("Stop dictation"));
            await click("Stop dictation");
            assert.equal(
                await evaluate<number>(
                    `return JSON.stringify(document.querySelectorAll('[role="dialog"]').length);`,
                ),
                0,
            );
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(document.querySelector('[data-part~="composer"] textarea')?.value === 'Mobile dictation test.');`,
                    ),
                "transcript in composer",
            );
            assert.ok((await evaluate<number>(`return JSON.stringify(window.audioRequests);`)) > 0);
            assert.ok(
                (await evaluate<number>(`return JSON.stringify(window.earlyFrames);`)) > 0,
                "captures speech before connection completes",
            );
            // Dictation inserts directly and never submits or opens a dialog.
            assert.equal(
                await evaluate<number>(
                    `return JSON.stringify(document.querySelectorAll('.user-message').length);`,
                ),
                0,
            );
            assert.ok(
                await evaluate<boolean>(
                    `return JSON.stringify(document.querySelector('[data-codex-dictation]')?.nextElementSibling?.matches('[data-part~="send-button"]'));`,
                ),
            );
            // Edits during capture must survive the returned transcript.
            await click("Codex dictation");
            await page.evaluate(
                `const box = document.querySelector('[data-part~="composer"] textarea'); box.value = 'Edited draft'; box.dispatchEvent(new Event('input', {bubbles:true})); return 'null';`,
            );
            await until(() => has("Stop dictation"), "second recording");
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(document.querySelector('[data-part~="composer"] textarea')?.value === 'Edited draft Mobile dictation');`,
                    ),
                "partial words preserve draft edits",
            );
            await page.evaluate(
                `const box = document.querySelector('[data-part~="composer"] textarea'); box.value = box.value.replace('Edited draft', 'Revised draft'); box.dispatchEvent(new Event('input', {bubbles:true})); return 'null';`,
            );
            await click("Stop dictation");
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(document.querySelector('[data-part~="composer"] textarea')?.value === 'Revised draft Mobile dictation test.');`,
                    ),
                "draft edits preserved",
            );
            assert.equal(
                await evaluate<number>(
                    `return JSON.stringify(document.querySelectorAll('[role="dialog"]').length);`,
                ),
                0,
            );
            // Send during connection setup must wait for the final text and submit exactly once.
            await page.evaluate(
                `const box = document.querySelector('[data-part~="composer"] textarea'); box.value = ''; box.dispatchEvent(new Event('input', {bubbles:true})); return 'null';`,
            );
            await click("Codex dictation");
            await new Promise((resolve) => setTimeout(resolve, 150));
            assert.equal(
                await evaluate<number>(`return JSON.stringify(window.submits.length);`),
                0,
            );
            await click("Send");
            await click("Send");
            assert.equal(
                await evaluate<number>(`return JSON.stringify(window.submits.length);`),
                0,
                "does not send before connection/finalization",
            );
            await until(
                () => evaluate<boolean>(`return JSON.stringify(window.submits.length === 1);`),
                "Send finalizes and submits",
            );
            assert.deepEqual(await evaluate<string[]>(`return JSON.stringify(window.submits);`), [
                "Mobile dictation test.",
            ]);
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(document.querySelector('[data-part~="composer"] textarea')?.value === '');`,
                    ),
                "draft clears after normal submit",
            );
            await page.evaluate(
                `navigator.mediaDevices.getUserMedia = async () => { throw new Error('Microphone permission denied'); }; return 'null';`,
            );
            await click("Codex dictation");
            await until(() => has("Codex dictation"), "mic resets after permission error");
            assert.equal(
                await evaluate<number>(
                    `return JSON.stringify(document.querySelectorAll('[role="dialog"]').length);`,
                ),
                0,
            );
            await app.setExtensionEnabled(owner(app), "codex-tools.ts", false);
            await until(
                () =>
                    evaluate<boolean>(
                        `return JSON.stringify(!document.querySelector('[data-codex-dictation]'));`,
                    ),
                "composer mic removed on disable",
            );
            assert.ok(
                await evaluate<boolean>(
                    `return JSON.stringify([...document.querySelectorAll('.composer-mic')].every(button => button.style.display !== 'none'));`,
                ),
            );
        } finally {
            await browsers.closeAll({ final: true });
            server.closeAllConnections();
            server.close();
            await app.close();
            cleanUp();
        }
    },
);
