import { describe, expect, mock, test } from "bun:test"
import { resolveOpenAIAuth } from "../../src/auth"

function context(value: unknown) {
  const connection = { id: "connection-1" }
  const active = mock(async () => connection)
  const resolve = mock(async () => value)
  return { integration: { connection: { active, resolve } } } as unknown as Parameters<typeof resolveOpenAIAuth>[0]
}

describe("resolveOpenAIAuth", () => {
  test("uses the active OpenAI API key", async () => {
    const ctx = context({ type: "key", key: "test-key" })
    expect(await resolveOpenAIAuth(ctx)).toEqual({ type: "key", key: "test-key" })
    expect(ctx.integration.connection.active).toHaveBeenCalledWith("openai")
  })

  test("uses the active OAuth access and account metadata", async () => {
    const ctx = context({ type: "oauth", access: "test-access", metadata: { accountID: "test-account" } })
    expect(await resolveOpenAIAuth(ctx)).toEqual({ type: "oauth", access: "test-access", accountId: "test-account" })
  })

  test("reads the account ID from OAuth JWT when metadata is absent", async () => {
    const payload = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "jwt-account" } }),
    ).toString("base64url")
    const ctx = context({ type: "oauth", access: `header.${payload}.signature` })
    expect(await resolveOpenAIAuth(ctx)).toEqual({
      type: "oauth",
      access: `header.${payload}.signature`,
      accountId: "jwt-account",
    })
  })

  test("rejects a missing connection", async () => {
    const ctx = context(undefined)
    await expect(resolveOpenAIAuth(ctx)).rejects.toThrow("OpenAI connection is not configured")
  })
})
