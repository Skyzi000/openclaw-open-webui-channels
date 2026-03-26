import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface OpenWebUIAccount {
  baseUrl: string;
  email: string;
  password: string;
  userId?: string;
  token?: string;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  reply_to_id?: string | null;
  parent_id?: string | null;
  created_at: number;
  updated_at?: number;
  user?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface Channel {
  id: string;
  name: string;
  type: string | null;
  description?: string;
}

export interface OpenWebUIFile {
  id: string;
  name?: string;
  filename?: string;
  type?: string;
  mime_type?: string;
  size?: number;
  created_at?: number;
}

export interface DownloadedFileContent {
  id: string;
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
}

// Cache tokens per account
const tokenCache = new Map<string, { token: string; userId: string; userName: string; expiresAt: number }>();

export function invalidateAuthToken(account: OpenWebUIAccount): void {
  const cacheKey = `${account.baseUrl}:${account.email}`;
  tokenCache.delete(cacheKey);
}

export async function getAuthToken(account: OpenWebUIAccount): Promise<{ token: string; userId: string; userName: string }> {
  const cacheKey = `${account.baseUrl}:${account.email}`;
  const cached = tokenCache.get(cacheKey);

  // Use cached token if not expired (tokens valid for ~24h, refresh every 12h)
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, userId: cached.userId, userName: cached.userName };
  }

  const response = await fetch(`${account.baseUrl}/api/v1/auths/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });

  if (!response.ok) {
    throw new Error(`[open-webui] Auth failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { token: string; id: string; name?: string };

  // Cache for 12 hours
  tokenCache.set(cacheKey, {
    token: data.token,
    userId: data.id,
    userName: data.name ?? "",
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  });

  return { token: data.token, userId: data.id, userName: data.name ?? "" };
}

async function fetchWithAuthRetry(
  account: OpenWebUIAccount,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const { token } = await getAuthToken(account);
  const headers = { ...init?.headers as Record<string, string>, Authorization: `Bearer ${token}` };
  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    invalidateAuthToken(account);
    const { token: newToken } = await getAuthToken(account);
    const retryHeaders = { ...init?.headers as Record<string, string>, Authorization: `Bearer ${newToken}` };
    return fetch(url, { ...init, headers: retryHeaders });
  }

  return response;
}

export async function getChannels(account: OpenWebUIAccount): Promise<Channel[]> {
  const response = await fetchWithAuthRetry(account, `${account.baseUrl}/api/v1/channels/`);

  if (!response.ok) {
    throw new Error(`[open-webui] Failed to get channels: ${response.status}`);
  }

  return response.json() as Promise<Channel[]>;
}

export async function getChannelMessages(
  account: OpenWebUIAccount,
  channelId: string,
  skip = 0,
  limit = 50
): Promise<ChannelMessage[]> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/channels/${channelId}/messages?skip=${skip}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error(`[open-webui] Failed to get messages: ${response.status}`);
  }

  return response.json() as Promise<ChannelMessage[]>;
}

export async function postMessage(
  account: OpenWebUIAccount,
  channelId: string,
  content: string,
  options?: {
    parentId?: string;
    replyToId?: string;
    data?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  }
): Promise<ChannelMessage> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/channels/${channelId}/messages/post`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        parent_id: options?.parentId,
        reply_to_id: options?.replyToId,
        data: options?.data ?? {},
        meta: options?.meta ?? {},
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[open-webui] Failed to post message: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ChannelMessage>;
}

function parseFilenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) {
    return undefined;
  }
  const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const asciiMatch = header.match(/filename\s*=\s*\"?([^\";]+)\"?/i);
  return asciiMatch?.[1];
}

export async function uploadFile(
  account: OpenWebUIAccount,
  filePath: string,
  options?: { filename?: string; mimeType?: string }
): Promise<OpenWebUIFile> {
  const buffer = await readFile(filePath);
  const filename = options?.filename ?? basename(filePath);
  const mimeType = options?.mimeType ?? "application/octet-stream";

  const buildForm = () => {
    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    form.append("file", blob, filename);
    return form;
  };

  const { token } = await getAuthToken(account);
  const response = await fetch(`${account.baseUrl}/api/v1/files/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: buildForm(),
  });

  if (response.status === 401) {
    invalidateAuthToken(account);
    const { token: newToken } = await getAuthToken(account);
    const retryResponse = await fetch(`${account.baseUrl}/api/v1/files/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${newToken}` },
      body: buildForm(),
    });
    if (!retryResponse.ok) {
      const errorText = await retryResponse.text();
      throw new Error(`[open-webui] Failed to upload file: ${retryResponse.status} - ${errorText}`);
    }
    return retryResponse.json() as Promise<OpenWebUIFile>;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[open-webui] Failed to upload file: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<OpenWebUIFile>;
}

export async function downloadFileContent(
  account: OpenWebUIAccount,
  fileId: string
): Promise<DownloadedFileContent> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/files/${fileId}/content`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[open-webui] Failed to download file ${fileId}: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(new Uint8Array(arrayBuffer));
  const filename = parseFilenameFromContentDisposition(response.headers.get("content-disposition"));
  const mimeType = response.headers.get("content-type") ?? undefined;

  return { id: fileId, buffer, filename, mimeType };
}

export async function updateMessage(
  account: OpenWebUIAccount,
  channelId: string,
  messageId: string,
  content: string,
  options?: { data?: Record<string, unknown>; meta?: Record<string, unknown> }
): Promise<ChannelMessage> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/channels/${channelId}/messages/${messageId}/update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        data: options?.data ?? {},
        meta: options?.meta ?? {},
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[open-webui] Failed to update message: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ChannelMessage>;
}

export async function getMessageById(
  account: OpenWebUIAccount,
  channelId: string,
  messageId: string
): Promise<ChannelMessage | null> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/channels/${channelId}/messages/${messageId}`
  );

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<ChannelMessage>;
}

export async function addReaction(
  account: OpenWebUIAccount,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<boolean> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/channels/${channelId}/messages/${messageId}/reactions/add`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: emoji }),
    }
  );

  return response.ok;
}

export async function removeReaction(
  account: OpenWebUIAccount,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<boolean> {
  const response = await fetchWithAuthRetry(
    account,
    `${account.baseUrl}/api/v1/channels/${channelId}/messages/${messageId}/reactions/remove`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: emoji }),
    }
  );

  return response.ok;
}
