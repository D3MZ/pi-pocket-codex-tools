export const pocketApi = 1;

// PCM16, mono, 24 kHz: the wire format used by Codex dictation.
export function pcm24k(samples, rate) {
    const output = new Uint8Array(Math.floor((samples.length * 24000) / rate) * 2);
    const view = new DataView(output.buffer);

    for (let index = 0; index < output.length / 2; index++) {
        const position = (index * rate) / 24000;
        const left = Math.floor(position);
        const fraction = position - left;
        const value = Math.max(
            -1,
            Math.min(
                1,
                samples[left] * (1 - fraction) +
                    samples[Math.min(left + 1, samples.length - 1)] * fraction,
            ),
        );

        view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }

    return output;
}

function base64(bytes) {
    let text = "";

    for (const byte of bytes) {
        text += String.fromCharCode(byte);
    }

    return btoa(text);
}

export default function setup(pocket) {
    let current = null;
    let disposed = false;
    const hidden = new Map();
    const mic = document.createElement("button");
    const icon =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';

    mic.type = "button";
    mic.className = "icon-button";
    mic.dataset.codexDictation = "true";
    mic.dataset.part = "composer-button";
    mic.style.cssText = "min-width:44px;min-height:44px;flex-shrink:0";

    function status(state) {
        const label =
            state === "recording"
                ? "Stop dictation"
                : state === "connecting"
                  ? "Stop dictation (connecting)"
                  : state === "transcribing"
                    ? "Transcribing dictation"
                    : "Codex dictation";

        mic.setAttribute("aria-label", label);
        mic.setAttribute("aria-pressed", String(state === "recording" || state === "connecting"));
        mic.title = label;
        mic.disabled = state === "transcribing";
        mic.style.color = state === "recording" || state === "connecting" ? "var(--err)" : "";
        mic.innerHTML =
            state === "recording" || state === "connecting"
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
                : icon;
    }

    function release(recording) {
        clearTimeout(recording.timer);
        clearInterval(recording.flushTimer);
        recording.processor?.disconnect();
        recording.source?.disconnect();
        recording.gain?.disconnect();
        recording.stream?.getTracks().forEach((track) => track.stop());
        void recording.context?.close().catch(() => {});
    }

    function cancel() {
        const recording = current;

        current = null;

        if (recording) {
            recording.abort.abort();
            recording.rejectConnection(new Error("Dictation cancelled."));
            release(recording);
            const send = recording.box
                .closest('[data-part~="composer"]')
                ?.querySelector('[data-part~="send-button"]');

            if (send) {
                send.disabled = send.dataset.state !== "ready";
            }

            if (recording.id) {
                void pocket
                    .api(`recording/${recording.id}`, undefined, { method: "DELETE" })
                    .catch(() => {});
            }
        }

        status("idle");
    }

    function sameBox(recording) {
        return (
            !disposed &&
            current === recording &&
            pocket.conversationId() === recording.conversationId &&
            recording.box.isConnected &&
            !recording.box.disabled &&
            document.querySelector('[data-part~="composer"] textarea') === recording.box
        );
    }

    function trackEdit(recording) {
        const before = recording.rendered;
        const after = recording.box.value;

        if (before === after) {
            return;
        }

        let start = 0;
        let end = before.length;
        let nextEnd = after.length;

        while (start < end && start < nextEnd && before[start] === after[start]) {
            start++;
        }

        while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) {
            end--;
            nextEnd--;
        }

        const shift = nextEnd - end;

        if (end <= recording.at) {
            recording.at += shift;
            recording.end += shift;
        } else if (start < recording.end || recording.at === recording.end) {
            // An edit inside dictated words belongs to the user. Keep that edit,
            // then append only new speech after the current draft.
            recording.editedPrefix = recording.raw;
            recording.at = after.length;
            recording.end = after.length;
        }

        recording.rendered = after;
    }

    function renderTranscript(recording, raw, revision) {
        if (typeof revision === "number" && revision < recording.revision) {
            return;
        }

        if (typeof revision === "number") {
            recording.revision = revision;
        }

        if (!sameBox(recording) || typeof raw !== "string" || !raw.trim()) {
            return;
        }

        trackEdit(recording);

        if (!raw.startsWith(recording.editedPrefix)) {
            return;
        }

        const text = raw.slice(recording.editedPrefix.length).trim();
        const box = recording.box;
        const prefix =
            recording.at && !/\s$/.test(box.value.slice(0, recording.at)) && text ? " " : "";
        const suffix =
            recording.end < box.value.length && !/^\s/.test(box.value.slice(recording.end)) && text
                ? " "
                : "";
        const insert = prefix + text + suffix;

        if (box.value.slice(recording.at, recording.end) !== insert) {
            box.setRangeText(insert, recording.at, recording.end, "preserve");
            recording.end = recording.at + insert.length;
            recording.rendered = box.value;
            box.dispatchEvent(new Event("input", { bubbles: true }));
        }

        recording.raw = raw;
    }

    function flush(recording) {
        if (
            !recording.id ||
            !recording.bufferedBytes ||
            recording.queuedBytes ||
            recording.abort.signal.aborted
        ) {
            return;
        }

        const bytes = new Uint8Array(recording.bufferedBytes);
        let offset = 0;

        for (const chunk of recording.chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }

        recording.chunks = [];
        recording.bufferedBytes = 0;
        recording.queuedBytes += bytes.length;

        if (recording.queuedBytes > 240000) {
            pocket.notify("error", "Dictation connection is too slow. Try again.");
            cancel();

            return;
        }

        // Serialize uploads to preserve PCM ordering and bound buffered audio.
        recording.upload = recording.upload
            .then(async () => {
                for (let at = 0; at < bytes.length; at += 48000) {
                    const result = await pocket.api(
                        `audio/${recording.id}`,
                        {
                            audio: base64(bytes.subarray(at, at + 48000)),
                        },
                        { signal: recording.abort.signal },
                    );

                    renderTranscript(recording, result.text, result.revision);
                }
            })
            .catch((failure) => {
                if (!disposed && !recording.abort.signal.aborted) {
                    pocket.notify("error", failure.message);
                }

                if (current === recording) {
                    cancel();
                }

                throw failure;
            })
            .finally(() => {
                recording.queuedBytes -= bytes.length;
            });
        void recording.upload.catch(() => {});
    }

    async function finish() {
        const recording = current;

        if (!recording || recording.finishing) {
            return;
        }

        recording.finishing = true;
        release(recording);
        status("transcribing");
        let succeeded = false;

        try {
            await recording.connection;
            flush(recording);
            await recording.upload;
            flush(recording);
            await recording.upload;
            recording.abort.signal.throwIfAborted();
            const result = await pocket.api(
                `finish/${recording.id}`,
                {},
                { signal: recording.abort.signal },
            );

            if (!result.text?.trim() && !recording.raw) {
                throw new Error("No speech recognized. Try again.");
            }

            renderTranscript(recording, result.text);
            succeeded = sameBox(recording);
        } catch (failure) {
            if (!disposed && !recording.abort.signal.aborted) {
                pocket.notify("error", failure.message);
            }
        } finally {
            if (current === recording) {
                cancel();
            }
        }

        if (succeeded && recording.sendRequested) {
            // Use Pocket's normal send path after it reconciles the final draft.
            await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );

            if (
                !disposed &&
                !current &&
                pocket.conversationId() === recording.conversationId &&
                recording.box.isConnected
            ) {
                recording.box
                    .closest('[data-part~="composer"]')
                    ?.querySelector('[data-part~="send-button"]')
                    ?.click();
            }
        }
    }

    async function start() {
        const box = document.querySelector('[data-part~="composer"] textarea');
        const conversationId = pocket.conversationId();

        if (!box || box.disabled || !conversationId || current || disposed) {
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
            pocket.notify(
                "error",
                "Microphone recording requires HTTPS (or localhost) and a supported browser.",
            );

            return;
        }

        const connection = Promise.withResolvers();

        void connection.promise.catch(() => {});
        const recording = {
            connection: connection.promise,
            rejectConnection: connection.reject,
            abort: new AbortController(),
            chunks: [],
            size: 0,
            box,
            conversationId,
            rendered: box.value,
            raw: "",
            revision: -1,
            editedPrefix: "",
            upload: Promise.resolve(),
            queuedBytes: 0,
            bufferedBytes: 0,
            at: box.selectionStart,
            end: box.selectionEnd,
        };

        current = recording;
        status("connecting");
        placeMic();

        try {
            // Create and resume during the tap, which iOS requires.
            recording.context = new AudioContext({ sampleRate: 24000 });
            await recording.context.resume();
            recording.stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
            });

            if (!sameBox(recording) || recording.abort.signal.aborted) {
                release(recording);

                return;
            }

            if (recording.finishing) {
                throw new Error("Recording stopped before the microphone was ready.");
            }

            recording.source = recording.context.createMediaStreamSource(recording.stream);
            recording.processor = recording.context.createScriptProcessor(4096, 1, 1);
            recording.gain = recording.context.createGain();
            recording.gain.gain.value = 0;

            recording.processor.onaudioprocess = (event) => {
                if (recording.finishing || recording.abort.signal.aborted) {
                    return;
                }

                const chunk = pcm24k(
                    event.inputBuffer.getChannelData(0),
                    recording.context.sampleRate,
                );
                const bounded = chunk.subarray(0, 24000 * 2 * 60 - recording.size);

                recording.chunks.push(bounded);
                recording.bufferedBytes += bounded.length;
                recording.size += bounded.length;

                if (recording.bufferedBytes + recording.queuedBytes > 240000) {
                    pocket.notify(
                        "error",
                        "Dictation connection is too slow. Your transcript is preserved.",
                    );
                    cancel();

                    return;
                }

                if (recording.size >= 24000 * 2 * 60) {
                    void finish();
                }
            };

            recording.source.connect(recording.processor);
            recording.processor.connect(recording.gain);
            recording.gain.connect(recording.context.destination);
            recording.timer = setTimeout(() => void finish(), 60000);
            // Capture before the network handshake so early speech is not lost.
            const result = await pocket.api("start", {}, { signal: recording.abort.signal });

            recording.id = result.id;

            if (!sameBox(recording) || recording.abort.signal.aborted) {
                void pocket
                    .api(`recording/${recording.id}`, undefined, { method: "DELETE" })
                    .catch(() => {});
                release(recording);
                return;
            }

            connection.resolve();

            if (!recording.finishing) {
                recording.flushTimer = setInterval(() => flush(recording), 200);
                flush(recording);
                status("recording");
            }
        } catch (failure) {
            if (!disposed && !recording.abort.signal.aborted) {
                pocket.notify("error", failure.message);
            }

            if (current === recording) {
                cancel();
            }
        }
    }

    mic.addEventListener("click", () => {
        if (!current) {
            void start();
        } else {
            void finish();
        }
    });

    function placeMic() {
        const composer = document.querySelector('[data-part~="composer"]');
        const send = composer?.querySelector('[data-part~="send-button"]');

        if (current && !sameBox(current)) {
            cancel();
        }

        for (const [button, display] of hidden) {
            if (!button.isConnected) {
                button.style.display = display;
                hidden.delete(button);
            }
        }

        if (!send || !composer.querySelector("textarea")) {
            mic.remove();

            return;
        }

        for (const button of composer.querySelectorAll(".composer-mic")) {
            if (!hidden.has(button)) {
                hidden.set(button, button.style.display);
                button.style.display = "none";
            }
        }

        if (current && send.disabled) {
            send.disabled = false;
        }

        if (mic.nextElementSibling !== send) {
            send.before(mic);
        }
    }

    const stopUpdates = pocket.on("dictation", (data) => {
        const recording = current;

        if (!recording || data.id !== recording.id) {
            return;
        }

        if (data.error) {
            pocket.notify("error", data.error);
            cancel();
        } else {
            renderTranscript(recording, data.text, data.revision);
        }
    });
    function sendRecording(event) {
        if (!current || !sameBox(current)) {
            return;
        }

        const isClick =
            event.type === "click" &&
            event.target.closest?.('[data-part~="send-button"]') ===
                current.box
                    .closest('[data-part~="composer"]')
                    ?.querySelector('[data-part~="send-button"]');
        const isEnter =
            event.type === "keydown" &&
            event.target === current.box &&
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.isComposing &&
            !window.matchMedia("(pointer: coarse)").matches;

        if (isClick || isEnter) {
            event.preventDefault();
            event.stopImmediatePropagation();
            current.sendRequested = true;
            void finish();
        }
    }

    document.addEventListener("click", sendRecording, true);
    document.addEventListener("keydown", sendRecording, true);
    const observer = new MutationObserver(placeMic);

    const onHidden = () => {
        if (document.hidden) {
            cancel();
        }
    };

    status("idle");
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
    });
    document.addEventListener("visibilitychange", onHidden);
    placeMic();
    pocket.onDispose(() => {
        disposed = true;
        observer.disconnect();
        stopUpdates();
        document.removeEventListener("click", sendRecording, true);
        document.removeEventListener("keydown", sendRecording, true);
        document.removeEventListener("visibilitychange", onHidden);
        cancel();
        mic.remove();

        for (const [button, display] of hidden) {
            button.style.display = display;
        }

        hidden.clear();
    });
    pocket.toolCall({
        tool: "codex_web_search",
        icon: "search",
        label: () => "Search the web",
        subject: (args) => args.query,
    });
}
