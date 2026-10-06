import type { GenerateArgs } from "./types"

const API_BASE = "https://api.openai.com/v1/images"

type ImageResponse = { data?: Array<{ b64_json?: string }> }

export async function callViaOpenAI(
  key: string,
  args: GenerateArgs,
  images: string[],
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const common = { model: "gpt-image-2", prompt: args.prompt, quality: args.quality, output_format: "png" }
  let endpoint = `${API_BASE}/generations`
  let body: BodyInit
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` }

  if (images.length) {
    endpoint = `${API_BASE}/edits`
    const form = new FormData()
    for (const [name, value] of Object.entries(common)) form.append(name, value)
    if (args.size) form.append("size", args.size)
    for (const [index, dataUrl] of images.entries()) {
      const match = /^data:(image\/[^;]+);base64,(.+)$/s.exec(dataUrl)
      if (!match) throw new Error("Invalid reference image data")
      form.append("image[]", new Blob([Buffer.from(match[2], "base64")], { type: match[1] }), `reference-${index + 1}`)
    }
    body = form
  } else {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify({ ...common, ...(args.size ? { size: args.size } : {}) })
  }

  const res = await fetch(endpoint, { method: "POST", headers, body, signal })
  if (!res.ok) throw new Error(`OpenAI image request failed: HTTP ${res.status}`)
  const result = (await res.json()) as ImageResponse
  signal?.throwIfAborted()
  const image = result.data?.[0]?.b64_json
  if (!image) throw new Error("OpenAI image response contained no image")
  return image
}
