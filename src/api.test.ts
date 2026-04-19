import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { updateMessage, invalidateAuthToken, type OpenWebUIAccount } from "./api.js";

const TEST_ACCOUNT: OpenWebUIAccount = {
  baseUrl: "https://webui.example.com",
  email: "test@example.com",
  password: "test-password",
};

const TEST_CHANNEL_ID = "11111111-1111-1111-1111-111111111111";
const TEST_MESSAGE_ID = "22222222-2222-2222-2222-222222222222";

const mockFetch = vi.fn();

beforeEach(() => {
  invalidateAuthToken(TEST_ACCOUNT);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

function createMockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as Response;
}

function mockAuthThenResponse(responseStatus: number, responseBody: unknown): void {
  const authResponse = createMockResponse(200, { token: "test-token", id: "user-1", name: "Bot" });
  const apiResponse = createMockResponse(responseStatus, responseBody);
  mockFetch.mockResolvedValueOnce(authResponse).mockResolvedValueOnce(apiResponse);
}

describe("updateMessage", () => {
  it("should send POST to the update endpoint with correct body", async () => {
    mockAuthThenResponse(200, {
      id: TEST_MESSAGE_ID,
      channel_id: TEST_CHANNEL_ID,
      user_id: "user-1",
      content: "updated content",
      created_at: 1000,
    });

    const result = await updateMessage(TEST_ACCOUNT, TEST_CHANNEL_ID, TEST_MESSAGE_ID, "updated content", {
      data: { key: "value" },
      meta: { source: "test" },
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [updateUrl, updateInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe(
      `https://webui.example.com/api/v1/channels/${TEST_CHANNEL_ID}/messages/${TEST_MESSAGE_ID}/update`
    );
    expect(updateInit.method).toBe("POST");
    expect(JSON.parse(updateInit.body as string)).toEqual({
      content: "updated content",
      data: { key: "value" },
      meta: { source: "test" },
    });
    expect(result.id).toBe(TEST_MESSAGE_ID);
  });

  it("should send empty data/meta when options are not provided", async () => {
    mockAuthThenResponse(200, {
      id: TEST_MESSAGE_ID,
      channel_id: TEST_CHANNEL_ID,
      user_id: "user-1",
      content: "text",
      created_at: 1000,
    });

    await updateMessage(TEST_ACCOUNT, TEST_CHANNEL_ID, TEST_MESSAGE_ID, "text");

    const [, updateInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(updateInit.body as string)).toEqual({
      content: "text",
      data: {},
      meta: {},
    });
  });

  it("should throw on non-ok response", async () => {
    mockAuthThenResponse(404, { detail: "Not Found" });

    await expect(
      updateMessage(TEST_ACCOUNT, TEST_CHANNEL_ID, TEST_MESSAGE_ID, "text")
    ).rejects.toThrow("[open-webui] Failed to update message: 404");
  });
});
