/** Incremental framing for server-sent events and newline-delimited JSON. */
export async function readStreamFrames(
  body: ReadableStream<Uint8Array>,
  format: "sse" | "ndjson",
  onFrame: (data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let eventData: string[] = [];
  let eventSize = 0;
  const line = (value: string): void => {
    if (format === "ndjson") {
      if (value.trim()) onFrame(value);
    } else if (!value) {
      if (eventData.length) onFrame(eventData.join("\n"));
      eventData = [];
      eventSize = 0;
    } else if (value.startsWith("data:")) {
      const part = value.slice(5).replace(/^ /, "");
      eventSize += part.length;
      if (eventSize > 2_000_000) throw new Error("Stream event exceeds the size limit.");
      eventData.push(part);
    }
  };
  try {
    while (true) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      if (pending.length > 2_000_000) throw new Error("Stream frame exceeds the size limit.");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, end).replace(/\r$/, ""));
        pending = pending.slice(end + 1);
      }
      if (next.done) break;
    }
    if (pending) line(pending.replace(/\r$/, ""));
    if (format === "sse" && eventData.length) line("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
