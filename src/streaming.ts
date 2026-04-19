export interface StreamingDeps {
  postMessage: (text: string, options: Record<string, unknown>) => Promise<{ id: string }>;
  updateMessage: (messageId: string, text: string, options?: Record<string, unknown>) => Promise<void>;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
}

// Live-edit streaming for Open WebUI.
// Unlike Mattermost/Discord's coalesce-then-post block streaming, Open WebUI has
// no per-message character limit and supports message editing, so we stream by
// creating one message and editing it in place as blocks arrive. Splitting by
// textChunkLimit is intentionally NOT applied here — the incremental edits must
// target a single messageId, and splitting mid-stream would fragment the live
// rendering that Open WebUI clients perform.
export class StreamingSession {
  private messageId: string | null = null;
  private accumulatedText = "";
  // What the server-side message actually renders — i.e. the text at the last
  // successful post/update. Falls behind accumulatedText when an edit fails, and
  // is the correct basis for any follow-up delta posted on finalize failure.
  private lastRenderedText = "";
  private readonly deps: StreamingDeps;

  constructor(deps: StreamingDeps) {
    this.deps = deps;
  }

  get isStreaming(): boolean {
    return this.messageId !== null;
  }

  get currentMessageId(): string | null {
    return this.messageId;
  }

  get currentText(): string {
    return this.accumulatedText;
  }

  private reset(): void {
    this.messageId = null;
    this.accumulatedText = "";
    this.lastRenderedText = "";
  }

  private resolveFinalText(text: string): string {
    if (!text) {
      return this.accumulatedText;
    }
    if (!this.accumulatedText) {
      return text;
    }
    // Some fallback paths emit a complete final reply after block chunks.
    // Avoid duplicating prefixes when final text already contains streamed content.
    if (text.startsWith(this.accumulatedText)) {
      return text;
    }
    return this.accumulatedText + text;
  }

  async appendBlock(text: string, postOptions: Record<string, unknown>): Promise<void> {
    this.accumulatedText += text;

    if (!this.messageId) {
      this.deps.log?.info(`live-edit stream start (${this.accumulatedText.length} chars)`);
      const posted = await this.deps.postMessage(this.accumulatedText, postOptions);
      if (!posted?.id) {
        throw new Error("Failed to post initial streaming message: no id returned");
      }
      this.messageId = posted.id;
      this.lastRenderedText = this.accumulatedText;
      this.deps.log?.info(`live-edit stream message created as ${this.messageId}`);
      return;
    }

    this.deps.log?.info(`live-edit stream update ${this.messageId} (${this.accumulatedText.length} chars)`);
    try {
      await this.deps.updateMessage(this.messageId, this.accumulatedText);
      this.lastRenderedText = this.accumulatedText;
    } catch (updateErr) {
      this.deps.log?.error(`updateMessage failed: ${String(updateErr)}`);
    }
  }

  async finalize(
    text: string,
    updateOptions: Record<string, unknown>,
    postNew: (fullText: string) => Promise<void>,
  ): Promise<void> {
    if (!this.messageId) {
      await postNew(text);
      return;
    }

    const finalText = this.resolveFinalText(text);
    const msgId = this.messageId;
    const renderedText = this.lastRenderedText;

    this.deps.log?.info(`finalizing live-edit stream message ${msgId} (${finalText.length} chars)`);
    try {
      try {
        await this.deps.updateMessage(msgId, finalText, updateOptions);
      } catch (updateErr) {
        // Delta is computed from what the server actually shows (lastRenderedText),
        // not from the in-memory accumulation. If earlier edits failed, the
        // rendered message lags behind and basing the delta on accumulatedText
        // would strip out chunks the user never saw.
        const delta = finalText.startsWith(renderedText)
          ? finalText.slice(renderedText.length)
          : finalText;
        this.deps.log?.error(
          `updateMessage failed on finalize, posting ${delta.length}-char delta as follow-up: ${String(updateErr)}`,
        );
        if (delta) {
          await postNew(delta);
        }
      }
    } finally {
      this.reset();
    }
  }

  // Close the current live-edit stream so a subsequent deliver (tool output,
  // media, etc.) can start a fresh message. The accumulated text is flushed
  // via finalize("", ...) which commits the last in-memory edit.
  async closeStream(postOptions: Record<string, unknown>): Promise<void> {
    if (!this.messageId) return;
    await this.finalize("", postOptions, async (fullText) => {
      await this.deps.postMessage(fullText, postOptions);
    });
  }
}
