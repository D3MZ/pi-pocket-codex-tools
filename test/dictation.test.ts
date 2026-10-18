import assert from "node:assert/strict";
import { test } from "node:test";
import { createDictation, DICTATION_UPDATE } from "../codex-tools.ts";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import createTools from "../codex-tools.ts";
import type { Host, Web, WebHandler } from "../codex-tools/types.d.ts";

class FakeSocket extends EventTarget {
    sent: Record<string, unknown>[] = [];
    closed = false;

    constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }

    send(raw: string) {
        const event = JSON.parse(raw);

        this.sent.push(event);

        if (event.type === "session.update") {
            queueMicrotask(() => this.message({ type: "session.updated" }));
        }

        if (event.type === "input_audio_buffer.commit") {
            queueMicrotask(() =>
                this.message({
                    type: "conversation.item.input_audio_transcription.completed",
                    transcript: "Hello Pocket",
                }),
            );
        }
    }

    message(data: unknown) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
    }

    close() {
        if (!this.closed) {
            this.closed = true;
            this.dispatchEvent(new Event("close"));
        }
    }
}

test("dictation keeps recordings private, bounds audio, commits and closes", async () => {
    const sockets: FakeSocket[] = [];
    const dictation = createDictation((headers) => {
        assert.equal(headers.authorization, "Bearer test");
        const socket = new FakeSocket();

        sockets.push(socket);

        return socket as unknown as WebSocket;
    });
    const signal = new AbortController().signal;

    try {
        const id = await dictation.start("owner", { authorization: "Bearer test" }, signal);

        assert.deepEqual(sockets[0]!.sent[0], DICTATION_UPDATE);
        await assert.rejects(dictation.start("owner", {}, signal), /already active/);
        assert.throws(() => dictation.append(id, "stranger", "AAAA"), /No active/);
        dictation.cancel(id, "stranger");
        assert.equal(sockets[0]!.closed, false);
        assert.throws(() => dictation.append(id, "owner", "!?"), /Invalid/);
        dictation.append(id, "owner", Buffer.alloc(4800).toString("base64"));
        assert.equal(await dictation.finish(id, "owner", signal), "Hello Pocket");
        assert.equal(sockets[0]!.closed, true);
        assert.throws(() => dictation.append(id, "owner", "AAAA"), /No active/);

        const short = await dictation.start("owner", { authorization: "Bearer test" }, signal);

        await assert.rejects(dictation.finish(short, "owner", signal), /too short/);
        assert.equal(sockets[1]!.closed, true);
        const third = await dictation.start("owner", { authorization: "Bearer test" }, signal);

        dictation.cancel(third, "owner");
        assert.equal(sockets[2]!.closed, true);
    } finally {
        dictation.dispose();
    }
});

test("dictation cancellation and upstream errors release connections", async () => {
    let socket: FakeSocket;
    const dictation = createDictation(() => {
        socket = new FakeSocket();

        // Do not acknowledge session.update so startup stays pending.
        socket.send = () => {};

        return socket as unknown as WebSocket;
    });
    const stop = new AbortController();
    const started = dictation.start("owner", {}, stop.signal);

    stop.abort();
    await assert.rejects(started, /stopped|abort/i);
    assert.equal(socket!.closed, true);
    dictation.dispose();
});

test("streaming dictation returns partial words, orders segments, and waits for completion", async () => {
    const socket = new FakeSocket();
    const originalSend = socket.send.bind(socket);

    socket.send = (raw) => {
        if (JSON.parse(raw).type === "input_audio_buffer.commit") {
            socket.message({ type: "error", error: { code: "input_audio_buffer_commit_empty" } });
        } else {
            originalSend(raw);
        }
    };

    const pushed: { text?: string; revision?: number; error?: string }[] = [];
    const dictation = createDictation(
        () => socket as unknown as WebSocket,
        (_id, owner, data) => {
            assert.equal(owner, "owner");
            pushed.push(data);
        },
    );
    const signal = new AbortController().signal;
    const audio = Buffer.alloc(4800).toString("base64");

    try {
        const id = await dictation.start("owner", {}, signal);

        socket.message({ type: "input_audio_buffer.committed", item_id: "one" });
        socket.message({
            type: "conversation.item.input_audio_transcription.delta",
            item_id: "one",
            delta: "Hello",
        });
        assert.equal(dictation.append(id, "owner", audio).text, "Hello");
        socket.message({
            type: "input_audio_buffer.committed",
            item_id: "two",
            previous_item_id: "one",
        });
        socket.message({
            type: "conversation.item.input_audio_transcription.delta",
            item_id: "two",
            delta: "Pocket",
        });
        assert.equal(dictation.append(id, "owner", audio).text, "Hello Pocket");
        await new Promise((resolve) => setTimeout(resolve, 80));
        assert.equal(
            pushed.at(-1)?.text,
            "Hello Pocket",
            "partial text is pushed without another upload",
        );
        assert.ok((pushed.at(-1)?.revision ?? 0) > 0);
        socket.message({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: "two",
            transcript: "Pocket!",
        });
        const final = dictation.finish(id, "owner", signal);
        let done = false;

        void final.then(() => {
            done = true;
        });
        await Promise.resolve();
        assert.equal(done, false, "Stop waits for earlier pending speech too");
        socket.message({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: "one",
            transcript: "Hello,",
        });
        assert.equal(await final, "Hello, Pocket!");
        assert.equal(socket.closed, true);
        assert.equal(
            pushed.some((data) => data.error),
            false,
            "normal socket close is not reported as a disconnect",
        );
    } finally {
        dictation.dispose();
    }
});

test("unexpected disconnects report a close code and release the recording", async () => {
    const socket = new FakeSocket();
    const reports: { error?: string }[] = [];
    const dictation = createDictation(
        () => socket as unknown as WebSocket,
        (_id, _owner, data) => reports.push(data),
    );

    try {
        const id = await dictation.start("owner", {}, new AbortController().signal);
        const event = new Event("close");

        Object.defineProperty(event, "code", { value: 1006 });
        socket.dispatchEvent(event);
        assert.match(reports[0]?.error ?? "", /code 1006/);
        assert.doesNotMatch(reports[0]?.error ?? "", /login/i);
        assert.throws(() => dictation.append(id, "owner", "AAAA"), /No active/);
        assert.equal(socket.closed, true);
    } finally {
        dictation.dispose();
    }
});

test("PCM conversion uses signed little-endian mono at 24 kHz", async () => {
    const module = await import(new URL("../codex-tools/index.js", import.meta.url).href);
    const output = module.pcm24k(new Float32Array([-1, 0, 1, 0]), 48000) as Uint8Array;
    const samples = new DataView(output.buffer);

    assert.equal(output.length, 4);
    assert.equal(samples.getInt16(0, true), -32768);
    assert.equal(samples.getInt16(2, true), 32767);
});

test("dictation accepts resolved auth before the OAuth status snapshot initializes", async (t) => {
    const claims = Buffer.from(
        JSON.stringify({
            "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
        }),
    ).toString("base64url");
    const token = `header.${claims}.signature`;

    t.mock.method(
        ModelRuntime,
        "create",
        async () =>
            ({
                getAuth: async () => ({ auth: { apiKey: token } }),
                isUsingOAuth: () => false,
            }) as never,
    );
    const originalSocket = globalThis.WebSocket;

    let attempts = 0;

    class FlakySocket extends FakeSocket {
        constructor() {
            super();
            attempts++;

            if (attempts === 1) {
                this.send = () => {
                    this.dispatchEvent(new Event("error"));
                };
            }
        }
    }

    globalThis.WebSocket = FlakySocket as unknown as typeof WebSocket;
    const routes = new Map<string, WebHandler>();

    let dispose = () => {};

    createTools(
        { agentDir: "/unused" } as Host,
        {
            client() {},
            send() {},
            onDispose(fn: () => void) {
                dispose = fn;
            },
            route(method: string, path: string, handle: WebHandler) {
                routes.set(`${method} ${path}`, handle);
            },
            error(_status: number, message: string) {
                return new Error(message);
            },
        } as unknown as Web,
    );

    try {
        const result = (await routes.get("POST start")!({
            user: { id: "owner", name: "Owner", role: "owner" },
            signal: new AbortController().signal,
        } as never)) as { id: string };

        assert.match(result.id, /^[a-f0-9-]{36}$/);
        assert.equal(attempts, 2, "a transient setup disconnect is retried once before audio");
    } finally {
        dispose();
        globalThis.WebSocket = originalSocket;
    }
});
