import { afterEach, describe, expect, mock, test } from "bun:test"
import { callViaOpenAI } from "../../src/api"
import type { GenerateArgs } from "../../src/types"

const originalFetch = globalThis.fetch
const args: GenerateArgs = { prompt: "a cat", out: "cat.png", quality: "high", size: "1024x1024" }

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("callViaOpenAI", () => {
  test("generates with gpt-image-2 and PNG output", async () => {
    const fetchMock = mock(async () => Response.json({ data: [{ b64_json: "IMAGE" }] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    expect(await callViaOpenAI("test-key", args, [])).toBe("IMAGE")
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/images/generations")
    expect(init.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" })
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-image-2",
      prompt: "a cat",
      quality: "high",
      output_format: "png",
      size: "1024x1024",
    })
  })

  test("edits with all reference images in multipart form", async () => {
    const fetchMock = mock(async () => Response.json({ data: [{ b64_json: "EDIT" }] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    expect(
      await callViaOpenAI("test-key", args, ["data:image/png;base64,aGVsbG8=", "data:image/png;base64,d29ybGQ="]),
    ).toBe("EDIT")
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/images/edits")
    const form = init.body as FormData
    expect(form.get("model")).toBe("gpt-image-2")
    expect(form.getAll("image[]")).toHaveLength(2)
    expect(form.get("output_format")).toBe("png")
  })

  test("does not expose the upstream body on error", async () => {
    globalThis.fetch = mock(async () => new Response("secret-body", { status: 401 })) as unknown as typeof fetch
    await expect(callViaOpenAI("test-key", args, [])).rejects.toThrow("OpenAI image request failed: HTTP 401")
  })

  test("passes cancellation to fetch", async () => {
    const controller = new AbortController()
    const fetchMock = mock(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal)
      controller.abort()
      throw controller.signal.reason
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(callViaOpenAI("test-key", args, [], controller.signal)).rejects.toThrow()
  })
})
