import { Plugin } from "@opencode/plugin"
import { callViaOpenAI } from "./api"
import { resolveOpenAIAuth } from "./auth"
import { callViaCodexResponses } from "./codex"
import { readReferenceImages } from "./input-image"
import { saveGeneratedImage } from "./output-image"
import type { GenerateArgs } from "./types"

const input = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "out", "quality"],
  properties: {
    prompt: { type: "string", description: "Description of the image to generate." },
    out: { type: "string", description: "Output PNG path, relative to the project directory unless absolute." },
    quality: { type: "string", enum: ["low", "medium", "high", "auto"], description: "Image quality." },
    size: {
      type: "string",
      description:
        "Optional image size: `auto` or `WIDTHxHEIGHT`; dimensions must be multiples of 16px, max edge 3840px, ratio at most 3:1, and 655,360 to 8,294,400 total pixels.",
    },
    images: { type: "array", items: { type: "string" }, description: "Optional reference image paths." },
  },
} as const

export default Plugin.define({
  id: "opencode-gpt-imagegen",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "gpt_imagegen",
        description: [
          "Generate raster images using OpenAI gpt-image-2 with the active OpenAI connection.",
          "Use for photos, illustrations, textures, sprites, and mockups.",
          "Reference images may be attached through `images`; label each image's role inline in `prompt`.",
          "For distinct assets, invoke gpt_imagegen once per asset. Returns one PNG per call.",
          "Returns the absolute saved path and never overwrites an existing file.",
        ].join(" "),
        input,
        async execute(raw, context) {
          const args = raw as GenerateArgs
          context.signal.throwIfAborted()
          const auth = await resolveOpenAIAuth(ctx)
          context.signal.throwIfAborted()
          const images = await readReferenceImages(args.images, ctx.location.directory)
          context.signal.throwIfAborted()
          const base64 =
            auth.type === "oauth"
              ? await callViaCodexResponses(auth, args, images, context.signal)
              : await callViaOpenAI(auth.key, args, images, context.signal)
          context.signal.throwIfAborted()
          const { savedPath, versioned, message } = await saveGeneratedImage(
            args.out,
            ctx.location.directory,
            base64,
            context.signal,
          )
          return {
            content: message,
            metadata: { out: savedPath, versioned, billing: auth.type === "oauth" ? "subscription" : "api" },
          }
        },
      })
    })
  },
})
