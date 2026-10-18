// Structural subset of Pi Pocket extension API v1. No runtime dependency on Pocket's source tree.
export interface Host {
    readonly agentDir: string;
    readonly text: { defang(text: string): string };
}
export interface WebRequest {
    readonly user: { id: string };
    readonly signal: AbortSignal;
    readonly params: Readonly<Record<string, string>>;
    readonly body: Readonly<Record<string, unknown>>;
}
export type WebHandler = (request: WebRequest) => unknown;
export interface Web {
    client(entry: string): void;
    onDispose(dispose: () => void): void;
    route(method: "GET" | "POST" | "DELETE", path: string, handle: WebHandler): void;
    send(event: string, data: unknown, options: { to: string }): void;
    error(status: number, message: string): Error;
}
