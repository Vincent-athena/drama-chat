/** Browser fetch helper. The one place that turns a 401 into a redirect to the login page. */
import type { ApiErrorBody, ErrorCode } from "@/lib/api-types";
import type { SaveStore } from "@/lib/save/types";
import { TICKET_HEADER } from "@/lib/ticket-http";

export class ApiError extends Error {
  status: number;
  code: ErrorCode | string;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Request failed (${status})`);
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : "";
    this.body = body;
  }
}

export async function apiFetch(
  path: string,
  opts: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    json?: unknown;
    ticket?: { store: SaveStore; storyId: string };
    redirectOn401?: boolean;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ticket) {
    const t = await opts.ticket.store.getTicket(opts.ticket.storyId);
    if (t) headers[TICKET_HEADER] = t;
  }
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
    credentials: "same-origin",
  });
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody> & Record<string, unknown>;
  if (res.status === 401 && opts.redirectOn401 !== false && typeof window !== "undefined") {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  throw new ApiError(res.status, body);
}

/** Reads an NDJSON stream, calling `onEvent` for each line. */
/** Events are handled one at a time, in order: each handler is awaited before the next line is read. */
export async function readNdjson<T>(res: Response, onEvent: (evt: T) => void | Promise<void>): Promise<void> {
  if (!res.body) throw new Error("Empty response");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) await onEvent(JSON.parse(line));
    }
  }
}

/** "You've used today's messages. More at 7:00 AM." for a daily_cap error; the plain message otherwise. */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError && err.code === "daily_cap" && typeof err.body.resetsAt === "number") {
    return `${err.message} More at ${new Date(err.body.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
