import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import plugin from "../../src/index"
import { PNG_BASE64, PNG_BUFFER } from "./fixtures"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("V2 gpt_imagegen tool", () => {
  test("registers a structured result and saves an API image", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "imagegen-plugin-"))
    try {
      let tool:
        | { name: string; input: unknown; execute: (input: unknown, context: unknown) => Promise<unknown> }
        | undefined
      const ctx = {
        location: { directory },
        integration: {
          connection: {
            active: mock(async () => ({ id: "active" })),
            resolve: mock(async () => ({ type: "key", key: "test-key" })),
          },
        },
        tool: {
          transform: async (callback: (editor: { add: (value: typeof tool) => void }) => void) => {
            callback({
              add: (value) => {
                tool = value
              },
            })
            return { dispose: async () => {} }
          },
        },
      }
      await plugin.setup(ctx as never)
      expect(tool?.name).toBe("gpt_imagegen")
      expect(tool?.input).toHaveProperty("type", "object")
      globalThis.fetch = mock(async () =>
        Response.json({ data: [{ b64_json: PNG_BASE64 }] }),
      ) as unknown as typeof fetch
      const result = await tool?.execute(
        { prompt: "cat", out: "cat.png", quality: "high" },
        { signal: new AbortController().signal },
      )
      expect(result).toEqual({
        content: `Generated image saved to ${path.join(directory, "cat.png")}.`,
        metadata: { out: path.join(directory, "cat.png"), versioned: false, billing: "api" },
      })
      expect(await readFile(path.join(directory, "cat.png"))).toEqual(PNG_BUFFER)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("does not save an image when the tool is cancelled during the request", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "imagegen-cancel-"))
    try {
      let execute: ((input: unknown, context: unknown) => Promise<unknown>) | undefined
      const controller = new AbortController()
      const ctx = {
        location: { directory },
        integration: {
          connection: {
            active: mock(async () => ({ id: "active" })),
            resolve: mock(async () => ({ type: "key", key: "test-key" })),
          },
        },
        tool: {
          transform: async (callback: (editor: { add: (value: { execute: typeof execute }) => void }) => void) => {
            callback({
              add: (value) => {
                execute = value.execute
              },
            })
            return { dispose: async () => {} }
          },
        },
      }
      await plugin.setup(ctx as never)
      globalThis.fetch = mock(async (_url, init) => {
        expect(init?.signal).toBe(controller.signal)
        controller.abort()
        return Response.json({ data: [{ b64_json: PNG_BASE64 }] })
      }) as unknown as typeof fetch
      await expect(
        execute?.({ prompt: "cat", out: "cat.png", quality: "high" }, { signal: controller.signal }),
      ).rejects.toThrow()
      await expect(readFile(path.join(directory, "cat.png"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
