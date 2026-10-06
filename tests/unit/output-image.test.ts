import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { link, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildSavedMessage, pickNonOverwritePath, saveGeneratedImage } from "../../src/output-image"
import { PNG_BASE64, PNG_BUFFER } from "./fixtures"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "out-image-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// Place a real PNG at the path so it is occupied; pickNonOverwritePath only checks existence.
function occupy(p: string): Promise<void> {
  return writeFile(p, PNG_BUFFER)
}

describe("pickNonOverwritePath", () => {
  test("returns the requested path when nothing exists", async () => {
    const requested = path.join(dir, "image.png")
    expect(await pickNonOverwritePath(requested)).toBe(requested)
  })

  test("appends -v2 when the requested path exists", async () => {
    const requested = path.join(dir, "image.png")
    await occupy(requested)
    expect(await pickNonOverwritePath(requested)).toBe(path.join(dir, "image-v2.png"))
  })

  test("skips to the first free suffix when earlier versions exist", async () => {
    const requested = path.join(dir, "image.png")
    await occupy(requested)
    await occupy(path.join(dir, "image-v2.png"))
    expect(await pickNonOverwritePath(requested)).toBe(path.join(dir, "image-v3.png"))
  })

  test("preserves the extension and stem in the versioned name", async () => {
    const requested = path.join(dir, "my.photo.jpeg")
    await occupy(requested)
    expect(await pickNonOverwritePath(requested)).toBe(path.join(dir, "my.photo-v2.jpeg"))
  })

  test("throws once every version up to the limit is taken", async () => {
    // maxVersion is lowered to 2 so we can fill the suffix space without writing 999 files.
    const requested = path.join(dir, "image.png")
    await occupy(requested)
    await occupy(path.join(dir, "image-v2.png"))
    expect(pickNonOverwritePath(requested, 2)).rejects.toThrow(
      `could not find a non-conflicting filename under ${dir}/image-vN.png (tried up to v2)`,
    )
  })
})

describe("buildSavedMessage", () => {
  test("omits the version note when the path was not changed", () => {
    const p = "/tmp/image.png"
    expect(buildSavedMessage(p, p)).toBe(`Generated image saved to ${p}.`)
  })

  test("explains the versioning when the saved path differs from the requested one", () => {
    const saved = "/tmp/image-v2.png"
    const requested = "/tmp/image.png"
    expect(buildSavedMessage(saved, requested)).toBe(
      `Generated image saved to ${saved} (the requested path ${requested} already existed; ` +
        "the new image was versioned to avoid overwriting it).",
    )
  })
})

describe("saveGeneratedImage", () => {
  test("writes the decoded image to the requested path", async () => {
    const out = "image.png"
    const result = await saveGeneratedImage(out, dir, PNG_BASE64)
    expect(result.savedPath).toBe(path.join(dir, "image.png"))
    expect(result.versioned).toBe(false)
    const written = await readFile(result.savedPath)
    expect(written.equals(PNG_BUFFER)).toBe(true)
  })

  test("resolves a relative path against the context directory", async () => {
    const result = await saveGeneratedImage("nested/image.png", dir, PNG_BASE64)
    expect(result.savedPath).toBe(path.join(dir, "nested", "image.png"))
    expect(existsSync(result.savedPath)).toBe(true)
  })

  test("honors an absolute output path verbatim", async () => {
    const abs = path.join(dir, "absolute.png")
    const result = await saveGeneratedImage(abs, "/some/other/ctx", PNG_BASE64)
    expect(result.savedPath).toBe(abs)
  })

  test("creates missing parent directories", async () => {
    const result = await saveGeneratedImage("a/b/c/image.png", dir, PNG_BASE64)
    expect(existsSync(result.savedPath)).toBe(true)
  })

  test("versions the output instead of overwriting an existing file", async () => {
    const first = await saveGeneratedImage("image.png", dir, PNG_BASE64)
    const second = await saveGeneratedImage("image.png", dir, PNG_BASE64)
    expect(second.savedPath).toBe(path.join(dir, "image-v2.png"))
    expect(second.versioned).toBe(true)
    expect(second.message).toBe(
      `Generated image saved to ${second.savedPath} (the requested path ${first.savedPath} already existed; ` +
        "the new image was versioned to avoid overwriting it).",
    )
    // The original file is left untouched.
    expect(existsSync(first.savedPath)).toBe(true)
  })

  test("concurrent saves select different paths without replacing either image", async () => {
    const [first, second] = await Promise.all([
      saveGeneratedImage("image.png", dir, PNG_BASE64),
      saveGeneratedImage("image.png", dir, PNG_BASE64),
    ])
    expect(new Set([first.savedPath, second.savedPath])).toEqual(
      new Set([path.join(dir, "image.png"), path.join(dir, "image-v2.png")]),
    )
    expect(await readFile(first.savedPath)).toEqual(PNG_BUFFER)
    expect(await readFile(second.savedPath)).toEqual(PNG_BUFFER)
  })

  test("removes a partial temporary file after a write failure", async () => {
    await expect(
      saveGeneratedImage("image.png", dir, PNG_BASE64, undefined, async (handle, data) => {
        await handle.writeFile(data.subarray(0, 4))
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
      }),
    ).rejects.toMatchObject({ code: "ENOSPC" })
    expect(await readdir(dir)).toEqual([])
  })

  test("keeps an existing output when writing the temporary file fails", async () => {
    const original = path.join(dir, "image.png")
    await occupy(original)
    await expect(
      saveGeneratedImage("image.png", dir, PNG_BASE64, undefined, async (handle, data) => {
        await handle.writeFile(data.subarray(0, 4))
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
      }),
    ).rejects.toMatchObject({ code: "ENOSPC" })
    expect(await readdir(dir)).toEqual(["image.png"])
    expect(await readFile(original)).toEqual(PNG_BUFFER)
  })

  test("does not publish an image cancelled while writing the temporary file", async () => {
    const controller = new AbortController()
    await expect(
      saveGeneratedImage("image.png", dir, PNG_BASE64, controller.signal, async (handle, data) => {
        await handle.writeFile(data)
        controller.abort()
      }),
    ).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})

describe("published image ownership", () => {
  test("creates temporary and published image files with private permissions", async () => {
    if (process.platform === "win32") return
    let temporaryMode = 0
    const result = await saveGeneratedImage("private.png", dir, PNG_BASE64, undefined, async (handle, data) => {
      temporaryMode = (await handle.stat()).mode & 0o777
      await handle.writeFile(data)
    })
    expect(temporaryMode).toBe(0o600)
    expect((await stat(result.savedPath)).mode & 0o777).toBe(0o600)
  })

  test("does not delete another writer's replacement when cancellation lands after publication", async () => {
    const controller = new AbortController()
    const output = path.join(dir, "replaced.png")
    await saveGeneratedImage(
      "replaced.png",
      dir,
      PNG_BASE64,
      controller.signal,
      (handle, data) => handle.writeFile(data),
      async (temporary, destination) => {
        await link(temporary, destination)
        await unlink(destination)
        await writeFile(destination, "another writer's data")
        controller.abort()
      },
    )
    expect(await readFile(output, "utf8")).toBe("another writer's data")
  })
})
