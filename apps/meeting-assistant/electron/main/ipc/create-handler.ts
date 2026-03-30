import { ipcMain, IpcMainInvokeEvent, IpcMainEvent } from "electron";
import { z, ZodSchema, ZodTypeAny } from "zod";

// ── Error formatting ─────────────────────────────────────────────────────────

export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

// ── createHandler ────────────────────────────────────────────────────────────

interface CreateHandlerOptions<TInput, TOutput> {
  channel: string;
  schema: ZodSchema<TInput>;
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput> | TOutput;
}

/**
 * Wraps ipcMain.handle with Zod safeParse validation.
 * On validation failure, throws a descriptive error back to the renderer.
 * On success, calls the handler with the parsed (typed) data.
 */
export function createHandler<TInput, TOutput>({
  channel,
  schema,
  handler,
}: CreateHandlerOptions<TInput, TOutput>): void {
  ipcMain.handle(channel, async (event, rawInput?: unknown) => {
    // z.void() schemas expect undefined
    const inputToValidate = rawInput === undefined ? undefined : rawInput;
    const result = (schema as ZodTypeAny).safeParse(inputToValidate);

    if (!result.success) {
      throw new Error(
        `[IPC] Invalid input for channel "${channel}": ${formatZodError(result.error)}`,
      );
    }

    return handler(result.data as TInput, event);
  });
}

// ── createListener ───────────────────────────────────────────────────────────

interface CreateListenerOptions<TInput> {
  channel: string;
  schema: ZodSchema<TInput>;
  handler: (input: TInput, event: IpcMainEvent) => void;
}

/**
 * Wraps ipcMain.on with Zod safeParse validation.
 * Drops messages that fail validation silently (fire-and-forget).
 */
export function createListener<TInput>({
  channel,
  schema,
  handler,
}: CreateListenerOptions<TInput>): void {
  ipcMain.on(channel, (event, rawInput?: unknown) => {
    const inputToValidate = rawInput === undefined ? undefined : rawInput;
    const result = (schema as ZodTypeAny).safeParse(inputToValidate);

    if (!result.success) {
      console.warn(
        `[IPC] Dropped invalid message on channel "${channel}": ${formatZodError(result.error)}`,
      );
      return;
    }

    handler(result.data as TInput, event);
  });
}
