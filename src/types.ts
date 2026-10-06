export type ImageAuth = { type: "oauth"; access: string; accountId?: string } | { type: "key"; key: string }

export type GenerateArgs = {
  prompt: string
  out: string
  quality: "low" | "medium" | "high" | "auto"
  size?: string
  images?: string[]
}
