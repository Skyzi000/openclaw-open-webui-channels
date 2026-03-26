import type { ChannelPlugin, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getOpenWebUIRuntime } from "./runtime.js";
import {
  postMessage,
  updateMessage,
  getAuthToken,
  getMessageById,
  addReaction,
  removeReaction,
  uploadFile,
  downloadFileContent,
  getChannels,
  type OpenWebUIAccount,
  type OpenWebUIFile,
} from "./api.js";
import { connectSocket, disconnectSocket, type ChannelEvent, getConnection } from "./socket.js";

// Plugin metadata
const meta = {
  id: "open-webui",
  label: "Open WebUI",
  selectionLabel: "Open WebUI (Channels)",
  docsPath: "https://github.com/skyzi000/openclaw-open-webui-channels#readme",
  docsLabel: "GitHub README",
  blurb: "Open WebUI channels integration via REST API and Socket.IO.",
};

// Config schema for Open WebUI
export interface OpenWebUIChannelConfig {
  baseUrl: string;
  email: string;
  password: string;
  userId?: string;
  enabled?: boolean;
  channelIds?: string[];
  requireMention?: boolean;
  name?: string;
  textChunkLimit?: number;
}

export interface ResolvedOpenWebUIAccount {
  accountId: string;
  baseUrl: string;
  email: string;
  password: string;
  userId?: string;
  enabled: boolean;
  configured: boolean;
  channelIds: string[];
  requireMention: boolean;
  name?: string;
  config: OpenWebUIChannelConfig;
}

function resolveOpenWebUIAccount(cfg: OpenClawConfig, accountId?: string): ResolvedOpenWebUIAccount {
  const channelCfg = (cfg.channels as Record<string, unknown>)?.["open-webui"] as OpenWebUIChannelConfig | undefined;
  
  const baseUrl = channelCfg?.baseUrl ?? "";
  const email = channelCfg?.email ?? "";
  const password = channelCfg?.password ?? "";
  const userId = channelCfg?.userId;
  const enabled = channelCfg?.enabled ?? true;
  const channelIds = channelCfg?.channelIds ?? [];
  const requireMention = channelCfg?.requireMention ?? true;
  const name = channelCfg?.name;

  return {
    accountId: accountId ?? "default",
    baseUrl,
    email,
    password,
    userId,
    enabled,
    configured: Boolean(baseUrl && email && password),
    channelIds,
    requireMention,
    name,
    config: channelCfg ?? {} as OpenWebUIChannelConfig,
  };
}

function getAccountFromResolved(account: ResolvedOpenWebUIAccount): OpenWebUIAccount {
  return {
    baseUrl: account.baseUrl,
    email: account.email,
    password: account.password,
    userId: account.userId,
  };
}

// Track per-account state (bot user ID + channel name cache)
const accountBotUserId = new Map<string, string>();
const channelNameCache = new Map<string, string>(); // key: "accountId:channelId"

type InboundMediaItem = {
  id: string;
  path: string;
  filename?: string;
  mimeType?: string;
  size?: number;
};

type OutboundMediaSpec = {
  path: string;
  filename?: string;
  mimeType?: string;
};

function coerceOutboundMedia(payload: Record<string, unknown>): OutboundMediaSpec[] {
  const candidates = [
    payload.media,
    payload.mediaFiles,
    payload.attachments,
    payload.files,
  ].find((value) => Array.isArray(value) && value.length > 0) as unknown[] | undefined;

  if (!candidates) {
    return [];
  }

  const items: OutboundMediaSpec[] = [];
  for (const entry of candidates) {
    if (typeof entry === "string") {
      items.push({ path: entry });
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const path = (record.path ?? record.filePath ?? record.file_path) as string | undefined;
      if (!path) {
        continue;
      }
      items.push({
        path,
        filename: (record.filename ?? record.name) as string | undefined,
        mimeType: (record.mimeType ?? record.mime_type ?? record.type) as string | undefined,
      });
    }
  }
  return items;
}

function extractReactionPayload(payload: Record<string, unknown>): { emoji: string; messageId?: string; action?: string } | null {
  const reactionValue =
    (payload.reaction as string | undefined) ??
    (payload.reactionName as string | undefined) ??
    (payload.emoji as string | undefined);

  if (!reactionValue) {
    return null;
  }

  const typeValue = payload.type as string | undefined;
  const kindValue = payload.kind as string | undefined;
  const actionValue = payload.action as string | undefined;
  const isReaction =
    payload.reaction != null ||
    typeValue === "reaction" ||
    kindValue === "reaction" ||
    actionValue === "reaction" ||
    actionValue === "add" ||
    actionValue === "remove";

  if (!isReaction) {
    return null;
  }

  const messageId =
    (payload.messageId as string | undefined) ??
    (payload.replyToId as string | undefined) ??
    (payload.reply_to_id as string | undefined);

  const action =
    (payload.action as string | undefined) ??
    (payload.reactionAction as string | undefined);

  return { emoji: reactionValue, messageId, action };
}

/** Wrap a raw upload response into the format Open WebUI's frontend expects in data.files */
function wrapUploadedFile(uploaded: OpenWebUIFile): Record<string, unknown> {
  return {
    type: "file",
    file: uploaded,
    id: uploaded.id,
    url: uploaded.id,
    name: uploaded.filename ?? (uploaded as any).meta?.name ?? uploaded.name ?? "file",
    collection_name: (uploaded as any).meta?.collection_name ?? "",
    content_type: (uploaded as any).meta?.content_type ?? uploaded.type ?? uploaded.mime_type ?? "application/octet-stream",
    status: "uploaded",
    size: uploaded.size ?? 0,
  };
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\/\\]+/g, "_");
}

async function persistInboundMedia(
  core: PluginRuntime,
  file: { id: string; buffer: Buffer; filename?: string; mimeType?: string }
): Promise<string> {
  // Ensure buffer is a proper Node.js Buffer (undici fetch ArrayBuffer workaround)
  let safeBuffer: Buffer;
  if (Buffer.isBuffer(file.buffer)) {
    safeBuffer = file.buffer;
  } else if (file.buffer instanceof ArrayBuffer || (file.buffer as any)?.byteLength !== undefined) {
    safeBuffer = Buffer.from(new Uint8Array(file.buffer as any));
  } else {
    // Last resort: try converting whatever we got
    safeBuffer = Buffer.from(file.buffer as any);
  }
  const saveMediaBuffer = (core as any)?.channel?.media?.saveMediaBuffer;
  if (typeof saveMediaBuffer === "function") {
    // saveMediaBuffer signature: (buffer, contentType, subdir, maxBytes, originalFilename)
    // Pass undefined for maxBytes to use OpenClaw's default limit
    const saved = await saveMediaBuffer(
      safeBuffer,
      file.mimeType,
      "inbound",
      undefined,
      file.filename,
    );
    if (typeof saved === "string") {
      return saved;
    }
    if (saved && typeof saved === "object") {
      const maybePath = (saved as Record<string, unknown>).path;
      const maybeUrl = (saved as Record<string, unknown>).url;
      if (typeof maybePath === "string") {
        return maybePath;
      }
      if (typeof maybeUrl === "string") {
        return maybeUrl;
      }
    }
  }

  const shortId = sanitizeFilename(file.id).slice(0, 8);
  const dir = join(tmpdir(), "open-webui", shortId);
  await mkdir(dir, { recursive: true });
  const filename = sanitizeFilename(file.filename ?? `file-${file.id}`);
  const filePath = join(dir, filename);
  await writeFile(filePath, safeBuffer);
  return filePath;
}

async function resolveInboundMedia(
  account: OpenWebUIAccount,
  core: PluginRuntime,
  rawData: Record<string, unknown> | undefined,
  log?: MonitorOptions["log"]
): Promise<InboundMediaItem[]> {
  const files = (rawData?.files as OpenWebUIFile[] | undefined) ?? [];
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const tasks = files.map(async (file) => {
    const fileId = file?.id;
    if (!fileId) {
      return null;
    }
    try {
      const downloaded = await downloadFileContent(account, fileId);
      const path = await persistInboundMedia(core, {
        id: fileId,
        buffer: downloaded.buffer,
        filename: downloaded.filename ?? file.filename ?? file.name,
        mimeType: downloaded.mimeType ?? file.mime_type ?? file.type,
      });
      return {
        id: fileId,
        path,
        filename: downloaded.filename ?? file.filename ?? file.name,
        mimeType: downloaded.mimeType ?? file.mime_type ?? file.type,
        size: file.size,
      } as InboundMediaItem;
    } catch (err) {
      log?.warn(`[open-webui] Failed to download file ${fileId}: ${String(err)}\n${(err as Error)?.stack ?? ''}`);
      return null;
    }
  });

  const results = await Promise.all(tasks);
  return results.filter(Boolean) as InboundMediaItem[];
}

export const openWebUIPlugin: ChannelPlugin<ResolvedOpenWebUIAccount> = {
  id: "open-webui",
  meta,
  capabilities: {
    chatTypes: ["direct", "group", "channel"],
    media: true,
    reactions: true,
    threads: true,
    blockStreaming: true,
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 300, idleMs: 800 },
  },
  threading: {
    resolveReplyToMode: () => "first",
    buildToolContext: ({ context, hasRepliedRef }) => {
      const threadId = context.MessageThreadId ?? context.ReplyToId;
      return {
        currentChannelId: context.To?.trim() || undefined,
        currentThreadTs: threadId != null ? String(threadId) : undefined,
        hasRepliedRef,
      };
    },
  },
  actions: {
    supportsAction: ({ action }) => action === "send" || action === "react",
    handleAction: async (ctx) => {
      const params = ctx.params as Record<string, unknown>;
      const action = (params.action as string | undefined) ?? "send";

      // --- React action ---
      if (action === "react") {
        const emoji = (params.emoji as string | undefined) ?? "";
        const messageId = (params.messageId as string | undefined) ?? "";
        const remove = params.remove === true;

        const account = resolveOpenWebUIAccount(ctx.cfg);
        const apiAccount = getAccountFromResolved(account);

        // Resolve the Open WebUI channel UUID from channelId, target, or to.
        // The OpenClaw core resolves channelId via resolveActionTarget before
        // calling handleAction, stripping any "open-webui:" prefix.
        const channelId = ((params.channelId as string) ?? (params.target as string) ?? (params.to as string) ?? "").replace(/^open-webui:/i, "").trim();

        if (!emoji) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Emoji is required" }) }], details: { ok: false } } as any;
        }
        if (!messageId) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "messageId is required" }) }], details: { ok: false } } as any;
        }
        if (!channelId) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "channel/target is required" }) }], details: { ok: false } } as any;
        }

        try {
          if (remove) {
            const success = await removeReaction(apiAccount, channelId, messageId, emoji);
            if (!success) {
              return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to remove reaction (API returned non-ok)" }) }], details: { ok: false } } as any;
            }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, removed: emoji }) }], details: { ok: true, removed: emoji } } as any;
          } else {
            const success = await addReaction(apiAccount, channelId, messageId, emoji);
            if (!success) {
              return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to add reaction (API returned non-ok)" }) }], details: { ok: false } } as any;
            }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, added: emoji }) }], details: { ok: true, added: emoji } } as any;
          }
        } catch (err) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }], details: { ok: false, error: String(err) } } as any;
        }
      }

      // --- Send action ---
      const to = (params.target as string) ?? (params.to as string);
      const message = (params.message as string) ?? "";
      const mediaUrl = (params.filePath as string) ?? (params.mediaUrl as string) ?? (params.media as string);
      const replyTo = params.replyTo as string | undefined;

      if (!to) {
        return { content: [{ type: "text", text: "Missing target" }], details: {} } as any;
      }

      const account = resolveOpenWebUIAccount(ctx.cfg);
      const apiAccount = getAccountFromResolved(account);

      // Resolve target (strip open-webui: prefix)
      const normalized = to.replace(/^open-webui:/i, "").trim();

      try {
        const uploadedFiles: any[] = [];
        if (mediaUrl) {
          const uploaded = await uploadFile(apiAccount, mediaUrl);
          uploadedFiles.push(wrapUploadedFile(uploaded));
        }

        const content = message?.trim() || (uploadedFiles.length > 0 ? " " : "");
        if (!content && uploadedFiles.length === 0) {
          return { content: [{ type: "text", text: "Nothing to send" }], details: {} } as any;
        }

        const dataPayload: Record<string, unknown> = {};
        if (uploadedFiles.length > 0) {
          dataPayload.files = uploadedFiles;
        }

        // Never set parentId in handleAction — Open WebUI hides messages with
        // a parent_id that doesn't exist in the target channel, and there is
        // no safe way for the agent to know the correct parent_id for a
        // different channel. Use replyTo (reply_to_id) for replies instead.
        const posted = await postMessage(apiAccount, normalized, content || " ", {
          replyToId: replyTo,
          data: dataPayload,
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, messageId: posted.id }) }],
          details: { ok: true, messageId: posted.id },
        } as any;
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
          details: { ok: false, error: String(err) },
        } as any;
      }
    },
  },
  reload: { configPrefixes: ["channels.open-webui"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg, accountId) => resolveOpenWebUIAccount(cfg, accountId),
    defaultAccountId: () => "default",
    setAccountEnabled: ({ cfg, enabled }) => {
      const channels = (cfg.channels ?? {}) as Record<string, unknown>;
      const owui = (channels["open-webui"] ?? {}) as Record<string, unknown>;
      return {
        ...cfg,
        channels: {
          ...channels,
          "open-webui": { ...owui, enabled },
        },
      } as OpenClawConfig;
    },
    deleteAccount: ({ cfg }) => {
      const channels = (cfg.channels ?? {}) as Record<string, unknown>;
      const { ["open-webui"]: _, ...rest } = channels;
      return { ...cfg, channels: rest } as OpenClawConfig;
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name ?? "Open WebUI",
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.baseUrl,
    }),
    resolveAllowFrom: () => [],
    formatAllowFrom: ({ allowFrom }) => allowFrom,
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const config = ctx.cfg;

      if (!account.configured) {
        ctx.log?.warn("[open-webui] Not configured, skipping start");
        return;
      }

      if (!account.enabled) {
        ctx.log?.info("[open-webui] Account disabled, skipping start");
        return;
      }

      ctx.log?.info(`[${account.accountId}] starting provider`);

      // Run the monitoring function
      await monitorOpenWebUIProvider({
        account,
        config,
        // Use the plugin-global runtime set during register().
        // (ctx.runtime may be a narrower runtime subset for some plugin contexts.)
        runtime: getOpenWebUIRuntime(),
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: account.accountId, ...patch }),
        log: ctx.log,
      });
    },
  },
  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name ?? "Open WebUI",
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.baseUrl,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      if (!to) return { ok: false, error: new Error("No target specified") };
      const normalized = to.replace(/^open-webui:/i, "");
      if (!/^[a-f0-9-]{36}$/i.test(normalized)) {
        return { ok: false, error: new Error(`Invalid Open WebUI channel ID: ${normalized}`) };
      }
      return { ok: true, to: normalized };
    },
    sendText: async ({ to, text, replyToId, threadId, accountId, cfg }) => {
      const normalizedTo = to.replace(/^open-webui:/i, "");
      const account = resolveOpenWebUIAccount(cfg, accountId);
      const apiAccount = getAccountFromResolved(account);
      try {
        // Only use threadId as parentId if it looks like a bare UUID (same channel).
        // Composite keys like "channelId:parentId" or cross-channel threadIds must
        // not be sent — Open WebUI hides messages whose parent_id doesn't exist.
        const safeParentId = threadId && /^[a-f0-9-]{36}$/i.test(String(threadId))
          ? String(threadId) : undefined;
        const message = await postMessage(apiAccount, normalizedTo, text, {
          replyToId: replyToId ?? undefined,
          parentId: safeParentId,
        });
        return {
          channel: "open-webui",
          ok: true,
          messageId: message.id,
        };
      } catch (err) {
        return {
          channel: "open-webui",
          ok: false,
          error: String(err),
        };
      }
    },
    sendMedia: async ({ to, text, mediaUrl, replyToId, threadId, accountId, cfg }) => {
      const normalizedTo = to.replace(/^open-webui:/i, "");
      const account = resolveOpenWebUIAccount(cfg, accountId);
      const apiAccount = getAccountFromResolved(account);
      try {
        const uploadedFiles: OpenWebUIFile[] = [];
        if (mediaUrl) {
          const uploaded = await uploadFile(apiAccount, mediaUrl);
          uploadedFiles.push(uploaded);
        }

        const content = text?.trim() || " ";
        const dataPayload: Record<string, unknown> = {};
        if (uploadedFiles.length > 0) {
          dataPayload.files = uploadedFiles.map(wrapUploadedFile);
        }

        const safeParentId = threadId && /^[a-f0-9-]{36}$/i.test(String(threadId))
          ? String(threadId) : undefined;
        const message = await postMessage(apiAccount, normalizedTo, content, {
          replyToId: replyToId ?? undefined,
          parentId: safeParentId,
          data: dataPayload,
        });
        return {
          channel: "open-webui",
          ok: true,
          messageId: message.id,
        };
      } catch (err) {
        return {
          channel: "open-webui",
          ok: false,
          error: String(err),
        };
      }
    },
  },
  messaging: {
    normalizeTarget: (target) => target.replace(/^open-webui:/i, ""),
    targetResolver: {
      looksLikeId: (target: string, normalized?: string) => {
        const value = normalized ?? target;
        return /^[a-f0-9-]{36}$/i.test(value);
      },
      hint: "<channel_id>",
    },
  },
};

// Monitoring options
interface MonitorOptions {
  account: ResolvedOpenWebUIAccount;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  abortSignal: AbortSignal;
  statusSink?: (patch: { running?: boolean; lastInboundAt?: number; lastError?: string }) => void;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

async function monitorOpenWebUIProvider(options: MonitorOptions): Promise<void> {
  const { account, config, runtime, abortSignal, statusSink, log } = options;
  const apiAccount = getAccountFromResolved(account);
  const core = runtime;

  try {
    // Authenticate and get bot user ID
    const { userId, userName } = await getAuthToken(apiAccount);
    accountBotUserId.set(account.accountId, userId);
    log?.info(`[${account.accountId}] authenticated as ${userName || userId}${userName ? ` (${userId})` : ""}`);

    // Cache channel names for metadata headers (refresh on each provider start)
    // Clear only this account's entries (prefix-based)
    for (const key of channelNameCache.keys()) {
      if (key.startsWith(`${account.accountId}:`)) channelNameCache.delete(key);
    }
    try {
      const channels = await getChannels(apiAccount);
      for (const ch of channels) {
        if (ch.id && ch.name) channelNameCache.set(`${account.accountId}:${ch.id}`, ch.name);
      }
      log?.info(`[${account.accountId}] cached ${channelNameCache.size} channel names`);
    } catch (err) {
      log?.warn(`[${account.accountId}] failed to cache channel names: ${String(err)}`);
    }

    statusSink?.({ running: true });

    // Connect to Socket.IO and handle events
    await connectSocket(apiAccount, async (event) => {
      await handleChannelEvent(event, {
        account,
        config,
        core,
        statusSink,
        log,
      });
    }, log, {
      channelIds: account.channelIds,
      onTerminalDisconnect: () => {
        log?.error(`[${account.accountId}] socket permanently disconnected, stopping provider`);
        statusSink?.({ running: false, lastError: "Socket.IO reconnection failed" });
      },
    });

    log?.info(`[${account.accountId}] connected to Socket.IO, monitoring ${account.channelIds.length || "all"} channels`);

    // Wait for abort signal or terminal socket disconnect
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        log?.info(`[${account.accountId}] disconnecting`);
        disconnectSocket(apiAccount);
        statusSink?.({ running: false });
        resolve();
      };

      if (abortSignal.aborted) {
        cleanup();
        return;
      }

      // Listen for abort
      abortSignal.addEventListener("abort", cleanup, { once: true });

      // Listen for terminal socket disconnect (reconnection exhausted)
      const conn = getConnection(apiAccount);
      if (conn?.socket) {
        conn.socket.io.on("reconnect_failed", () => {
          abortSignal.removeEventListener("abort", cleanup);
          cleanup();
        });
      }
    });
  } catch (err) {
    const errorMsg = String(err);
    log?.error(`[${account.accountId}] provider error: ${errorMsg}`);
    statusSink?.({ running: false, lastError: errorMsg });
    throw err;
  }
}

interface HandleEventOptions {
  account: ResolvedOpenWebUIAccount;
  config: OpenClawConfig;
  core: PluginRuntime;
  statusSink?: (patch: { lastInboundAt?: number }) => void;
  log?: MonitorOptions["log"];
}

async function handleChannelEvent(
  event: ChannelEvent,
  options: HandleEventOptions
): Promise<void> {
  const { account, config, core, statusSink, log } = options;

  const eventType = event.data?.type;

  if (eventType === "message:reaction:add" || eventType === "message:reaction:remove") {
    const reactionPayload = event.data.data as Record<string, unknown> | undefined;
    const reactionName =
      (reactionPayload?.reaction as { name?: string } | undefined)?.name ??
      (reactionPayload?.name as string | undefined) ??
      (reactionPayload?.emoji as string | undefined);
    const reactionMessageId =
      (reactionPayload?.message_id as string | undefined) ??
      (event.message_id as string | undefined) ??
      (reactionPayload?.message as { id?: string } | undefined)?.id;
    const reactionUserId =
      (reactionPayload?.user_id as string | undefined) ??
      (event.user?.id as string | undefined);

    const reactionApi = (core as any)?.channel?.reactions;
    const handler =
      reactionApi?.dispatchReactionEvent ??
      reactionApi?.handleReactionEvent ??
      reactionApi?.onReaction;

    if (typeof handler === "function" && reactionName && reactionMessageId) {
      await handler({
        action: eventType === "message:reaction:add" ? "add" : "remove",
        channelId: event.channel_id,
        messageId: reactionMessageId,
        emoji: reactionName,
        userId: reactionUserId,
        provider: "open-webui",
      });
    } else {
      log?.debug?.(
        `[${account.accountId}] reaction event missing handler or data (messageId=${reactionMessageId}, emoji=${reactionName})`
      );
    }
    return;
  }

  // Only process message events
  if (eventType !== "message") {
    return;
  }

  const message = event.data.data;
  if (!message) {
    return;
  }

  // Ignore our own messages
  if (message.user_id === accountBotUserId.get(account.accountId)) {
    log?.debug?.(`[${account.accountId}] ignoring own message`);
    return;
  }

  // Determine channel type from event metadata
  const channelType = event.channel?.type ?? null; // "standard" | "group" | "dm" | null
  const isDm = channelType === "dm";

  // Check if we should monitor this channel (DMs bypass channelIds filter, like Discord)
  if (!isDm && account.channelIds.length > 0 && !account.channelIds.includes(event.channel_id)) {
    log?.debug?.(`[${account.accountId}] ignoring message from non-monitored channel ${event.channel_id}`);
    return;
  }

  const text = message.content?.trim() ?? "";
  const senderName = event.user?.name ?? message.user_id;
  const channelId = event.channel_id;
  const apiAccount = getAccountFromResolved(account);
  const replyToId = message.id;
  const parentId = message.parent_id ?? undefined;
  // Check for mention requirement
  // Open WebUI native mention format: <@U:USER_ID|Name> or <@U:USER_ID>
  const botUserId = accountBotUserId.get(account.accountId);
  let wasMentioned = false;
  if (botUserId) {
    const mentionPattern = `<@U:${botUserId}`;
    wasMentioned = text.includes(mentionPattern);
  }

  if (account.requireMention && !wasMentioned && !isDm) {
    log?.debug?.(`[${account.accountId}] ignoring message without mention`);
    return;
  }

  log?.info(`[${account.accountId}] processing message from ${senderName} in channel ${channelId}`);
  statusSink?.({ lastInboundAt: Date.now() });

  // Download inbound media AFTER mention check to avoid unnecessary work
  const inboundMedia = await resolveInboundMedia(
    apiAccount,
    core,
    message.data as Record<string, unknown> | undefined,
    log
  );

  // Resolve the route for this message
  // Use parentId to separate thread sessions from channel sessions,
  // similar to how Discord uses thread IDs for session isolation.
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "open-webui",
    accountId: account.accountId,
    peer: {
      kind: isDm ? "dm" : channelType === "standard" ? "channel" : "group",
      id: parentId ? `${channelId}:${parentId}` : channelId,
    },
  });

  // Fetch thread parent context so the agent knows what this thread is about
  let threadParentContext = "";
  if (parentId) {
    try {
      const parentMsg = await getMessageById(apiAccount, channelId, parentId);
      if (parentMsg) {
        const parentUser = parentMsg.user?.name ?? parentMsg.user_id;
        const parentContent = parentMsg.content?.trim() ?? "";
        if (parentContent) {
          threadParentContext = `[Thread started from this message by ${parentUser}]\n${parentContent}\n[End of thread parent message]\n\n`;
        }
      }
    } catch (err) {
      log?.warn(`[${account.accountId}] failed to fetch thread parent context: ${String(err)}`);
    }
  }

  // Fetch reply context if the incoming message is a reply
  let replyContext = "";
  const incomingReplyToId = message.reply_to_id;
  if (incomingReplyToId) {
    try {
      const repliedMsg = await getMessageById(apiAccount, channelId, incomingReplyToId);
      if (repliedMsg) {
        const repliedUser = repliedMsg.user?.name ?? repliedMsg.user_id;
        const repliedContent = repliedMsg.content?.trim() ?? "";
        if (repliedContent) {
          replyContext = `[Replied message by ${repliedUser}]\n${repliedContent}\n[End of replied message]\n\n`;
        }
      }
    } catch (err) {
      log?.warn(`[${account.accountId}] failed to fetch reply context: ${String(err)}`);
    }
  }

  // Build context payload
  const outboundTarget = channelId;
  const rawChannelName = channelNameCache.get(`${account.accountId}:${channelId}`) ?? channelId;
  // Sanitize channel name to prevent header injection (strip brackets, newlines)
  const channelName = rawChannelName.replace(/[\[\]\n\r]/g, "").slice(0, 100);
  const fromLabel = isDm
    ? `${senderName} user id:${message.user_id}`
    : `Open WebUI #${channelName} channel id:${channelId}`;
  const body = text;
  const contextPrefix = `${threadParentContext}${replyContext}`;
  const bodyForAgent = contextPrefix ? `${contextPrefix}${text}` : text;

  const ctxPayload = {
    Body: body,
    BodyForAgent: bodyForAgent,
    RawBody: body,
    CommandBody: body,
    BodyForCommands: body,
    From: `open-webui:${message.user_id}`,
    To: `open-webui:${outboundTarget}`,
    SessionKey: route.sessionKey,
    AccountId: account.accountId,
    ChatType: (isDm ? "direct" : channelType === "standard" ? "channel" : "group") as "direct" | "channel" | "group",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: message.user_id,
    Provider: "open-webui",
    Surface: "open-webui",
    MessageSid: message.id,
    Timestamp: message.created_at,
    OriginatingChannel: "open-webui",
    OriginatingTo: `open-webui:${outboundTarget}`,
    WasMentioned: wasMentioned,
    CommandAuthorized: true,
    ReplyToId: replyToId,
    ReplyToMessageSid: replyToId,
    ParentId: parentId,
    ThreadId: parentId,
    MessageThreadId: parentId,
  };

  if (inboundMedia.length > 0) {
    const mediaPaths = inboundMedia.map((item) => item.path);
    // Keep MediaTypes aligned with MediaPaths (use fallback instead of filtering)
    const mediaTypes = inboundMedia.map((item) => item.mimeType ?? "application/octet-stream");
    const first = inboundMedia[0];
    (ctxPayload as Record<string, unknown>).NumMedia = inboundMedia.length;
    (ctxPayload as Record<string, unknown>).Media = inboundMedia;
    (ctxPayload as Record<string, unknown>).MediaPath = first.path;
    (ctxPayload as Record<string, unknown>).MediaType = first.mimeType;
    (ctxPayload as Record<string, unknown>).MediaUrl = first.path;
    (ctxPayload as Record<string, unknown>).MediaPaths = mediaPaths;
    (ctxPayload as Record<string, unknown>).MediaUrls = mediaPaths;
    (ctxPayload as Record<string, unknown>).MediaTypes = mediaTypes;
    inboundMedia.forEach((item, index) => {
      (ctxPayload as Record<string, unknown>)[`MediaUrl${index}`] = item.path;
    });
  }
  const finalizedCtx = core.channel.reply.finalizeInboundContext(ctxPayload);

  // Dispatch to agent
  const textLimit = account.config.textChunkLimit ?? 4000;

  // Send typing indicator immediately and refresh every 4s (Open WebUI expires after 5s)
  // Open WebUI's frontend only shows "user is typing..." when message_id is null
  // (channel-level typing). Thread-level typing (message_id !== null) is ignored.
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  const emitTyping = (typing: boolean) => {
    const conn = getConnection(apiAccount);
    if (conn?.socket?.connected) {
      conn.socket.emit("events:channel", {
        channel_id: outboundTarget,
        message_id: null,
        data: { type: "typing", data: { typing } },
      });
    }
  };
  const startTyping = async () => {
    emitTyping(true);
    if (!typingInterval) {
      typingInterval = setInterval(() => emitTyping(true), 4000);
    }
  };
  const stopTyping = async () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
    emitTyping(false);
  };

  // --- Streaming state: post-then-edit approach ---
  const STREAM_UPDATE_INTERVAL_MS = 600;
  let streamingMessageId: string | null = null;
  let streamingLastUpdate = 0;
  let streamingLastText = "";
  let streamingUpdateInFlight = false;
  // Buffer the latest pending text so it's flushed after an in-flight request completes
  let streamingPendingText: string | null = null;
  let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushStreamingUpdate = async (text: string) => {
    streamingUpdateInFlight = true;
    try {
      if (!streamingMessageId) {
        const posted = await postMessage(apiAccount, outboundTarget, text, {
          replyToId: replyToId,
          parentId: parentId,
        });
        if (posted?.id) {
          streamingMessageId = posted.id;
          streamingLastUpdate = Date.now();
          await stopTyping();
          log?.debug?.(`[${account.accountId}] streaming: posted initial message ${posted.id}`);
        }
      } else {
        await updateMessage(apiAccount, outboundTarget, streamingMessageId, text);
        streamingLastUpdate = Date.now();
      }
    } catch (err) {
      log?.warn?.(`[${account.accountId}] streaming: update failed: ${String(err)}`);
    } finally {
      streamingUpdateInFlight = false;
      // After completing, check if there's newer text buffered while we were in-flight
      const pending = streamingPendingText;
      if (pending && pending !== streamingLastText) {
        streamingPendingText = null;
        streamingLastText = pending;
        void flushStreamingUpdate(pending);
      }
    }
  };

  const onPartialReply = async (payload: Record<string, unknown>) => {
    const text = (payload.text as string | undefined)?.trim();
    if (!text || text === streamingLastText) return;

    // If in-flight or throttled, buffer the latest text instead of dropping it
    if (streamingUpdateInFlight) {
      streamingPendingText = text;
      return;
    }
    const now = Date.now();
    const timeSinceLastUpdate = now - streamingLastUpdate;
    if (streamingMessageId && timeSinceLastUpdate < STREAM_UPDATE_INTERVAL_MS) {
      streamingPendingText = text;
      // Schedule a flush for when the throttle window expires
      if (!streamingFlushTimer) {
        const delay = STREAM_UPDATE_INTERVAL_MS - timeSinceLastUpdate;
        streamingFlushTimer = setTimeout(() => {
          streamingFlushTimer = null;
          const pending = streamingPendingText;
          if (pending && pending !== streamingLastText && !streamingUpdateInFlight) {
            streamingPendingText = null;
            streamingLastText = pending;
            void flushStreamingUpdate(pending);
          }
        }, delay);
      }
      return;
    }

    streamingPendingText = null;
    streamingLastText = text;
    void flushStreamingUpdate(text);
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload) => {
        try {
          const payloadRecord = payload as Record<string, unknown>;
          const reaction = extractReactionPayload(payloadRecord);
          if (reaction) {
            const targetMessageId = reaction.messageId ?? replyToId ?? message.id;
            if (targetMessageId) {
              if (reaction.action === "remove") {
                await removeReaction(apiAccount, outboundTarget, targetMessageId, reaction.emoji);
              } else {
                await addReaction(apiAccount, outboundTarget, targetMessageId, reaction.emoji);
              }
            }
            return;
          }

          const mediaSpecs = coerceOutboundMedia(payloadRecord);
          const uploadedFiles: OpenWebUIFile[] = [];
          for (const media of mediaSpecs) {
            try {
              const uploaded = await uploadFile(apiAccount, media.path, {
                filename: media.filename,
                mimeType: media.mimeType,
              });
              uploadedFiles.push(uploaded);
            } catch (uploadErr) {
              log?.error(`[${account.accountId}] deliver: failed to upload file ${media.path}: ${String(uploadErr)}`);
            }
          }

          const responseText = payloadRecord.text as string | undefined;
          const trimmed = responseText?.trim() ?? "";
          if (!trimmed && uploadedFiles.length === 0) {
            if (mediaSpecs.length > 0) {
              throw new Error(`All ${mediaSpecs.length} media upload(s) failed and no text content to deliver`);
            }
            log?.debug?.(`[${account.accountId}] deliver: skipping empty payload`);
            return;
          }

          const replyToOverride =
            (payloadRecord.replyToId as string | undefined) ??
            (payloadRecord.reply_to_id as string | undefined) ??
            replyToId;
          const parentOverride =
            (payloadRecord.parentId as string | undefined) ??
            (payloadRecord.threadId as string | undefined) ??
            parentId;
          const dataOverride = (payloadRecord.data as Record<string, unknown> | undefined) ?? {};
          const metaOverride = (payloadRecord.meta as Record<string, unknown> | undefined) ?? {};
          const dataPayloadWithFiles: Record<string, unknown> = { ...dataOverride };
          if (uploadedFiles.length > 0) {
            dataPayloadWithFiles.files = uploadedFiles.map(wrapUploadedFile);
          }

          // --- If we already have a streaming message, finalize it via edit ---
          if (streamingMessageId) {
            const chunks = trimmed
              ? core.channel.text.chunkMarkdownText(trimmed, textLimit)
              : [""];
            if (!chunks.length && trimmed) chunks.push(trimmed);

            if (chunks.length === 1) {
              // Single chunk: edit the streaming message with the final content + files
              const finalContent = chunks[0] === "" ? " " : chunks[0];
              try {
                await updateMessage(apiAccount, outboundTarget, streamingMessageId, finalContent, {
                  data: Object.keys(dataPayloadWithFiles).length > 0 ? dataPayloadWithFiles : undefined,
                  meta: Object.keys(metaOverride).length > 0 ? metaOverride : undefined,
                });
                log?.info(`[${account.accountId}] deliver: finalized streaming message ${streamingMessageId} (${finalContent.length}ch)`);
              } catch (editErr) {
                log?.error(`[${account.accountId}] deliver: failed to finalize streaming message, falling back to post: ${String(editErr)}`);
                await postMessage(apiAccount, outboundTarget, finalContent, {
                  replyToId: replyToOverride,
                  parentId: parentOverride,
                  data: dataPayloadWithFiles,
                  meta: metaOverride,
                });
              }
              streamingMessageId = null;
              return;
            }

            // Multiple chunks: edit streaming message with first chunk, post the rest
            const firstContent = chunks[0] === "" ? " " : chunks[0];
            try {
              await updateMessage(apiAccount, outboundTarget, streamingMessageId, firstContent, {
                data: Object.keys(dataPayloadWithFiles).length > 0 ? dataPayloadWithFiles : undefined,
                meta: Object.keys(metaOverride).length > 0 ? metaOverride : undefined,
              });
              log?.info(`[${account.accountId}] deliver: finalized streaming message ${streamingMessageId} as chunk 1/${chunks.length}`);
            } catch (editErr) {
              log?.error(`[${account.accountId}] deliver: failed to finalize streaming chunk 1, posting instead: ${String(editErr)}`);
              await postMessage(apiAccount, outboundTarget, firstContent, {
                replyToId: replyToOverride,
                parentId: parentOverride,
                data: dataPayloadWithFiles,
                meta: metaOverride,
              });
            }
            streamingMessageId = null;

            // Post remaining chunks
            for (let i = 1; i < chunks.length; i++) {
              const content = chunks[i] === "" ? " " : chunks[i];
              try {
                const posted = await postMessage(apiAccount, outboundTarget, content, {
                  replyToId: replyToOverride,
                  parentId: parentOverride,
                  data: dataOverride,
                  meta: metaOverride,
                });
                log?.info(`[${account.accountId}] deliver: posted chunk ${i + 1}/${chunks.length} as ${posted.id}`);
              } catch (postErr) {
                log?.error(`[${account.accountId}] deliver: failed to post chunk ${i + 1}/${chunks.length}: ${String(postErr)}`);
                throw postErr;
              }
            }
            return;
          }

          // --- No streaming message: original post-based flow ---
          const chunks = trimmed
            ? core.channel.text.chunkMarkdownText(trimmed, textLimit)
            : [""];
          if (!chunks.length && trimmed) {
            chunks.push(trimmed);
          }

          log?.info(`[${account.accountId}] deliver: posting ${chunks.length} chunk(s) (${trimmed.length} chars) to ${outboundTarget} (replyTo=${replyToOverride ?? "none"}, parent=${parentOverride ?? "none"})`);

          for (const [index, chunk] of chunks.entries()) {
            const content = chunk === "" ? " " : chunk;
            const dataPayload = index === 0 ? dataPayloadWithFiles : dataOverride;
            try {
              const posted = await postMessage(apiAccount, outboundTarget, content, {
                replyToId: replyToOverride,
                parentId: parentOverride,
                data: dataPayload,
                meta: metaOverride,
              });
              if (posted?.id) {
                log?.info(`[${account.accountId}] deliver: chunk ${index + 1}/${chunks.length} saved as ${posted.id} (${content.length}ch)`);
              } else {
                log?.error(`[${account.accountId}] deliver: chunk ${index + 1}/${chunks.length} returned no id! response=${JSON.stringify(posted).slice(0, 300)}`);
              }
            } catch (postErr) {
              log?.error(`[${account.accountId}] deliver: failed to post chunk ${index + 1}/${chunks.length} to ${outboundTarget}: ${String(postErr)}`);
              throw postErr;
            }
          }
          log?.info(`[${account.accountId}] deliver: successfully posted to ${outboundTarget}`);
        } catch (deliverErr) {
          log?.error(`[${account.accountId}] deliver: unexpected error: ${String(deliverErr)}`);
          throw deliverErr;
        }
      },
      onReplyStart: startTyping,
      onError: (err: unknown, info: { kind: string }) => {
        log?.error(`[${account.accountId}] dispatch error (${info.kind}): ${String(err)}`);
      },
    });

  try {
    await startTyping();
    await core.channel.reply.dispatchReplyFromConfig({
      ctx: finalizedCtx,
      cfg: config,
      dispatcher,
      replyOptions: {
        ...replyOptions,
        onPartialReply,
      },
    });
  } catch (err) {
    log?.error(`[${account.accountId}] failed to dispatch message: ${String(err)}`);
  } finally {
    if (streamingFlushTimer) {
      clearTimeout(streamingFlushTimer);
      streamingFlushTimer = null;
    }
    markDispatchIdle();
    await stopTyping();
  }
}
