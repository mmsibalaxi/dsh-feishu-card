/** Record one event. `data` must be JSON-serializable (strings/numbers/bools). */
export declare function trace(event: string, data?: Record<string, unknown>): void;
/** The trace file path, so a doctor command can print it. */
export declare function tracePath(): string;
/** Truncate the trace (used by tests and by /doctor). */
export declare function resetTrace(): void;
