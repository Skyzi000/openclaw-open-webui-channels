import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingSession, type StreamingDeps } from "./streaming.js";

function createMockDeps(): StreamingDeps & {
  postMessage: ReturnType<typeof vi.fn>;
  updateMessage: ReturnType<typeof vi.fn>;
} {
  return {
    postMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), error: vi.fn() },
  };
}

type DeliverKind = "block" | "final" | "tool" | "unknown";

type DeliverPayload = {
  text: string;
  kind: DeliverKind;
  hasMedia: boolean;
};

async function simulateDeliver(
  payload: DeliverPayload,
  streaming: StreamingSession,
  postNewMessage: (text: string) => void,
  postOptions: Record<string, unknown>,
): Promise<void> {
  const { text, kind, hasMedia } = payload;
  const hasText = text.trim().length > 0;

  if (!hasText && !hasMedia) {
    // Whitespace-only block chunks must still be accumulated (newlines, etc.)
    if (kind === "block" && text.length > 0) {
      // fall through to append
    } else {
      return;
    }
  }

  if (kind === "block" && !hasMedia) {
    await streaming.appendBlock(text, postOptions);
    return;
  }

  if (kind === "block" && hasMedia) {
    if (streaming.isStreaming) {
      await streaming.closeStream(postOptions);
    }
    postNewMessage(text);
    return;
  }

  if (kind === "final") {
    if (hasMedia) {
      let finalMediaText = text;
      if (streaming.isStreaming) {
        const streamedText = streaming.currentText;
        await streaming.closeStream(postOptions);
        if (finalMediaText && streamedText && finalMediaText.startsWith(streamedText)) {
          finalMediaText = finalMediaText.slice(streamedText.length);
        }
      }
      postNewMessage(finalMediaText);
      return;
    }
    await streaming.finalize(text, postOptions, async () => {
      postNewMessage(text);
    });
    return;
  }

  if (kind === "tool") {
    if (streaming.isStreaming) {
      await streaming.closeStream(postOptions);
    }
    postNewMessage(text);
    return;
  }

  postNewMessage(text);
}

describe("deliver branching logic", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let streaming: StreamingSession;
  let postNewMessage: (text: string) => void;
  const postOptions = { replyToId: "reply-1" };

  beforeEach(() => {
    deps = createMockDeps();
    streaming = new StreamingSession(deps);
    postNewMessage = vi.fn<(text: string) => void>();
  });

  describe("block without media", () => {
    it("should append to streaming session", async () => {
      await simulateDeliver(
        { text: "chunk1", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.postMessage).toHaveBeenCalledOnce();
      expect(streaming.isStreaming).toBe(true);
      expect(streaming.currentText).toBe("chunk1");
      expect(postNewMessage).not.toHaveBeenCalled();
    });

    it("should accumulate multiple blocks via update", async () => {
      await simulateDeliver(
        { text: "A", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      await simulateDeliver(
        { text: "B", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.postMessage).toHaveBeenCalledOnce();
      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "AB");
      expect(streaming.currentText).toBe("AB");
    });
  });

  describe("block with media", () => {
    it("should break streaming and post new message when streaming is active", async () => {
      await simulateDeliver(
        { text: "partial", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      expect(streaming.isStreaming).toBe(true);

      await simulateDeliver(
        { text: "media text", kind: "block", hasMedia: true },
        streaming, postNewMessage, postOptions,
      );

      expect(streaming.isStreaming).toBe(false);
      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "partial", postOptions);
      expect(postNewMessage).toHaveBeenCalledWith("media text");
    });

    it("should post new message directly when no active streaming", async () => {
      await simulateDeliver(
        { text: "media text", kind: "block", hasMedia: true },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.updateMessage).not.toHaveBeenCalled();
      expect(postNewMessage).toHaveBeenCalledWith("media text");
    });
  });

  describe("final without media", () => {
    it("should finalize streaming with accumulated + final text", async () => {
      await simulateDeliver(
        { text: "Hello ", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      await simulateDeliver(
        { text: "world!", kind: "final", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "Hello world!", postOptions);
      expect(streaming.isStreaming).toBe(false);
      expect(postNewMessage).not.toHaveBeenCalled();
    });

    it("should use final payload directly when it already includes streamed text", async () => {
      await simulateDeliver(
        { text: "Hello ", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      await simulateDeliver(
        { text: "Hello world!", kind: "final", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "Hello world!", postOptions);
      expect(streaming.isStreaming).toBe(false);
      expect(postNewMessage).not.toHaveBeenCalled();
    });

    it("should post new message when no active streaming", async () => {
      await simulateDeliver(
        { text: "final only", kind: "final", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(postNewMessage).toHaveBeenCalledWith("final only");
      expect(deps.updateMessage).not.toHaveBeenCalled();
    });
  });

  describe("final with media", () => {
    it("should break streaming and post media as new message", async () => {
      await simulateDeliver(
        { text: "streaming text", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      await simulateDeliver(
        { text: "final media", kind: "final", hasMedia: true },
        streaming, postNewMessage, postOptions,
      );

      expect(streaming.isStreaming).toBe(false);
      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "streaming text", postOptions);
      expect(postNewMessage).toHaveBeenCalledWith("final media");
    });

    it("should deduplicate streamed prefix when final media payload already includes full text", async () => {
      await simulateDeliver(
        { text: "Hello ", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      await simulateDeliver(
        { text: "Hello world!", kind: "final", hasMedia: true },
        streaming, postNewMessage, postOptions,
      );

      expect(streaming.isStreaming).toBe(false);
      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "Hello ", postOptions);
      expect(postNewMessage).toHaveBeenCalledWith("world!");
    });

    it("should post media as new message when no active streaming", async () => {
      await simulateDeliver(
        { text: "final media", kind: "final", hasMedia: true },
        streaming, postNewMessage, postOptions,
      );

      expect(postNewMessage).toHaveBeenCalledWith("final media");
      expect(streaming.isStreaming).toBe(false);
    });
  });

  describe("tool kind", () => {
    it("should break streaming and post tool text as a new message", async () => {
      await simulateDeliver(
        { text: "block", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      await simulateDeliver(
        { text: " result", kind: "tool", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "block", postOptions);
      expect(postNewMessage).toHaveBeenCalledWith(" result");
      expect(streaming.isStreaming).toBe(false);
    });

    it("should post tool output directly when no active streaming", async () => {
      await simulateDeliver(
        { text: "tool only", kind: "tool", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.updateMessage).not.toHaveBeenCalled();
      expect(postNewMessage).toHaveBeenCalledWith("tool only");
      expect(streaming.isStreaming).toBe(false);
    });

    it("should break streaming and post tool media as new message", async () => {
      await simulateDeliver(
        { text: "block", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      await simulateDeliver(
        { text: "tool media", kind: "tool", hasMedia: true },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "block", postOptions);
      expect(postNewMessage).toHaveBeenCalledWith("tool media");
    });
  });

  describe("empty payload", () => {
    it("should skip delivery when text is empty and no media", async () => {
      await simulateDeliver(
        { text: "", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.postMessage).not.toHaveBeenCalled();
      expect(postNewMessage).not.toHaveBeenCalled();
    });

    it("should skip delivery when text is whitespace-only and no media", async () => {
      await simulateDeliver(
        { text: "   \n  ", kind: "final", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(deps.postMessage).not.toHaveBeenCalled();
      expect(postNewMessage).not.toHaveBeenCalled();
    });

    it("should accumulate whitespace-only block chunks (newlines)", async () => {
      await simulateDeliver(
        { text: "hello", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      await simulateDeliver(
        { text: "\n\n", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      await simulateDeliver(
        { text: "world", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(streaming.currentText).toBe("hello\n\nworld");
    });
  });

  describe("text preservation", () => {
    it("should preserve whitespace in accumulated text", async () => {
      await simulateDeliver(
        { text: "  hello  \n", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );
      await simulateDeliver(
        { text: "  world  \n", kind: "block", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(streaming.currentText).toBe("  hello  \n  world  \n");
      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "  hello  \n  world  \n");
    });
  });

  describe("fallback for unknown kinds", () => {
    it("should post as new message for unrecognized kinds", async () => {
      await simulateDeliver(
        { text: "unknown", kind: "unknown", hasMedia: false },
        streaming, postNewMessage, postOptions,
      );

      expect(postNewMessage).toHaveBeenCalledWith("unknown");
    });
  });
});
