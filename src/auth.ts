import type { Plugin } from "@opencode/plugin"
import type { ImageAuth } from "./types"

type Integration = Pick<Plugin.Context, "integration">

function accountID(access: string, metadata: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const metadataID = metadata?.accountID
  if (typeof metadataID === "string" && metadataID) return metadataID

  try {
    const payload = access.split(".")[1]
    if (!payload) return undefined
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
    const auth = claims["https://api.openai.com/auth"]
    if (!auth || typeof auth !== "object") return undefined
    const id = (auth as Record<string, unknown>).chatgpt_account_id
    return typeof id === "string" && id ? id : undefined
  } catch {
    return undefined
  }
}

export async function resolveOpenAIAuth(ctx: Integration): Promise<ImageAuth> {
  const connection = await ctx.integration.connection.active("openai")
  const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined
  if (credential?.type === "key" && credential.key) return { type: "key", key: credential.key }
  if (credential?.type === "oauth" && credential.access) {
    return { type: "oauth", access: credential.access, accountId: accountID(credential.access, credential.metadata) }
  }
  throw new Error("OpenAI connection is not configured. Connect OpenAI in OpenCode first.")
}
