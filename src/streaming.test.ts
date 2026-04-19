import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingSession, type StreamingDeps } from "./streaming.js";

function createMockDeps(): StreamingDeps & {
  postMessage: ReturnType<typeof vi.fn>;
  updateMessage: ReturnType<typeof vi.fn>;
} {
  return {
    postMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe("StreamingSession", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let session: StreamingSession;

  beforeEach(() => {
    deps = createMockDeps();
    session = new StreamingSession(deps);
  });

  describe("initial state", () => {
    it("should not be streaming initially", () => {
      expect(session.isStreaming).toBe(false);
      expect(session.currentMessageId).toBeNull();
      expect(session.currentText).toBe("");
    });
  });

  describe("appendBlock", () => {
    it("should post a new message on first block", async () => {
      await session.appendBlock("Hello ", { replyToId: "reply-1" });

      expect(deps.postMessage).toHaveBeenCalledOnce();
      expect(deps.postMessage).toHaveBeenCalledWith("Hello ", { replyToId: "reply-1" });
      expect(session.isStreaming).toBe(true);
      expect(session.currentMessageId).toBe("msg-1");
      expect(session.currentText).toBe("Hello ");
    });

    it("should update the existing message on subsequent blocks", async () => {
      await session.appendBlock("Hello ", {});

      await session.appendBlock("world", {});

      expect(deps.postMessage).toHaveBeenCalledOnce();
      expect(deps.updateMessage).toHaveBeenCalledOnce();
      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "Hello world");
      expect(session.currentText).toBe("Hello world");
    });

    it("should accumulate text across multiple blocks", async () => {
      await session.appendBlock("A", {});
      await session.appendBlock("B", {});
      await session.appendBlock("C", {});

      expect(deps.postMessage).toHaveBeenCalledOnce();
      expect(deps.updateMessage).toHaveBeenCalledTimes(2);
      expect(deps.updateMessage).toHaveBeenNthCalledWith(1, "msg-1", "AB");
      expect(deps.updateMessage).toHaveBeenNthCalledWith(2, "msg-1", "ABC");
      expect(session.currentText).toBe("ABC");
    });

    it("should throw when postMessage returns no id on first block", async () => {
      deps.postMessage.mockResolvedValue({});

      await expect(session.appendBlock("text", {})).rejects.toThrow(
        "Failed to post initial streaming message: no id returned"
      );
    });

    it("should keep trying updates after a transient failure", async () => {
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("network error"));

      await session.appendBlock("world", {});
      await session.appendBlock("!", {});

      // All three updates attempted — first fails, second succeeds with full text
      expect(deps.updateMessage).toHaveBeenCalledTimes(2);
      expect(deps.updateMessage).toHaveBeenNthCalledWith(1, "msg-1", "Hello world");
      expect(deps.updateMessage).toHaveBeenNthCalledWith(2, "msg-1", "Hello world!");
      expect(session.currentText).toBe("Hello world!");
    });
  });

  describe("finalize", () => {
    it("should call postNew with the text when not streaming", async () => {
      const postNew = vi.fn();

      await session.finalize("final text", {}, postNew);

      expect(postNew).toHaveBeenCalledOnce();
      expect(postNew).toHaveBeenCalledWith("final text");
      expect(deps.updateMessage).not.toHaveBeenCalled();
    });

    it("should update the streaming message with accumulated + final text", async () => {
      await session.appendBlock("Hello ", {});

      await session.finalize("world!", { data: { files: [] } }, vi.fn());

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "Hello world!", { data: { files: [] } });
      expect(session.isStreaming).toBe(false);
      expect(session.currentText).toBe("");
    });

    it("should use final payload directly when it already includes accumulated text", async () => {
      await session.appendBlock("Hello ", {});

      await session.finalize("Hello world!", {}, vi.fn());

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "Hello world!", {});
      expect(session.isStreaming).toBe(false);
      expect(session.currentText).toBe("");
    });

    it("should use only accumulated text when final text is empty", async () => {
      await session.appendBlock("accumulated", {});

      await session.finalize("", {}, vi.fn());

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "accumulated", {});
    });

    it("should finalize with complete text after updates were stopped", async () => {
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("network error"));
      await session.appendBlock("world", {});
      // updates stopped, but accumulation continued

      await session.finalize("!", {}, vi.fn());

      // finalize updates the same message with the full accumulated text + delta
      expect(deps.updateMessage).toHaveBeenLastCalledWith("msg-1", "Hello world!", {});
    });

    it("should finalize with complete response after updates were stopped", async () => {
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("network error"));
      await session.appendBlock("world", {});

      await session.finalize("Hello world! Done.", {}, vi.fn());

      expect(deps.updateMessage).toHaveBeenLastCalledWith("msg-1", "Hello world! Done.", {});
    });

    it("should post only the unseen delta when updateMessage fails on finalize", async () => {
      // Original streamed message "Hello " stays at last successful edit.
      // Posting the full "Hello world!" would duplicate "Hello " for the user.
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("server error"));
      const postNew = vi.fn();

      await session.finalize("world!", {}, postNew);

      expect(postNew).toHaveBeenCalledOnce();
      expect(postNew).toHaveBeenCalledWith("world!");
      expect(session.isStreaming).toBe(false);
    });

    it("should post only the delta when final payload already includes accumulated prefix", async () => {
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("server error"));
      const postNew = vi.fn();

      await session.finalize("Hello world!", {}, postNew);

      expect(postNew).toHaveBeenCalledOnce();
      expect(postNew).toHaveBeenCalledWith("world!");
      expect(session.isStreaming).toBe(false);
    });

    it("should preserve chunks missed by prior failed edits when finalize also fails", async () => {
      // Initial post "Hello " succeeds → server shows "Hello ".
      // Edit to "Hello world" fails → server still shows "Hello ".
      // Finalize to "Hello world!" also fails → delta must be "world!" (based
      // on what is rendered), not "!" (based on in-memory accumulation).
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("edit failed"));
      await session.appendBlock("world", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("finalize failed"));
      const postNew = vi.fn();

      await session.finalize("!", {}, postNew);

      expect(postNew).toHaveBeenCalledOnce();
      expect(postNew).toHaveBeenCalledWith("world!");
      expect(session.isStreaming).toBe(false);
    });

    it("should skip postNew when delta is empty on finalize failure", async () => {
      await session.appendBlock("complete", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("server error"));
      const postNew = vi.fn();

      await session.finalize("complete", {}, postNew);

      expect(postNew).not.toHaveBeenCalled();
      expect(session.isStreaming).toBe(false);
    });

    it("should reset state after successful finalize", async () => {
      await session.appendBlock("data", {});
      expect(session.isStreaming).toBe(true);

      await session.finalize("", {}, vi.fn());

      expect(session.isStreaming).toBe(false);
      expect(session.currentMessageId).toBeNull();
      expect(session.currentText).toBe("");
    });
  });

  describe("closeStream", () => {
    it("should be a no-op when not streaming", async () => {
      await session.closeStream({});

      expect(deps.updateMessage).not.toHaveBeenCalled();
      expect(deps.postMessage).not.toHaveBeenCalled();
    });

    it("should finalize the accumulated text when streaming", async () => {
      await session.appendBlock("partial text", {});

      await session.closeStream({ data: {} });

      expect(deps.updateMessage).toHaveBeenCalledWith("msg-1", "partial text", { data: {} });
      expect(session.isStreaming).toBe(false);
    });

    it("should preserve chunks missed by prior failed edits when closeStream also fails", async () => {
      await session.appendBlock("Hello ", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("edit failed"));
      await session.appendBlock("world", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("close failed"));

      await session.closeStream({});

      // Initial post + follow-up delta post; delta is the missed "world" chunk.
      expect(deps.postMessage).toHaveBeenCalledTimes(2);
      expect(deps.postMessage).toHaveBeenLastCalledWith("world", {});
      expect(session.isStreaming).toBe(false);
    });

    it("should not duplicate the message when updateMessage fails on close", async () => {
      // On close, finalText == accumulatedText, so the delta is empty and we
      // must not post a follow-up (the original streamed message still carries
      // the last successful edit — duplicating it would confuse the reader).
      await session.appendBlock("partial", {});
      deps.updateMessage.mockRejectedValueOnce(new Error("fail"));

      await session.closeStream({ data: {} });

      expect(deps.postMessage).toHaveBeenCalledTimes(1);
      expect(session.isStreaming).toBe(false);
    });
  });
});
