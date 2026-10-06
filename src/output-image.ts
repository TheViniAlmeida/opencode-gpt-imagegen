import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

const MAX_OUTPUT_VERSION_SUFFIX = 999

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// maxVersion is injectable only so tests can reach the exhaustion branch cheaply; production callers use the default.
export async function pickNonOverwritePath(requested: string, maxVersion = MAX_OUTPUT_VERSION_SUFFIX): Promise<string> {
  if (!(await pathExists(requested))) return requested
  const dir = path.dirname(requested)
  const ext = path.extname(requested)
  const stem = path.basename(requested, ext)
  for (let n = 2; n <= maxVersion; n++) {
    const candidate = path.join(dir, `${stem}-v${n}${ext}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error(
    `could not find a non-conflicting filename under ${dir}/${stem}-vN${ext} (tried up to v${maxVersion})`,
  )
}

export function buildSavedMessage(savedPath: string, requestedPath: string): string {
  const versionNote =
    savedPath !== requestedPath
      ? ` (the requested path ${requestedPath} already existed; the new image was versioned to avoid overwriting it)`
      : ""
  return `Generated image saved to ${savedPath}${versionNote}.`
}

type SaveResult = { savedPath: string; versioned: boolean; message: string }

// Write a private file before publishing it through a no-overwrite hard link.
// The writer is injectable so tests can simulate a partial disk write.
export async function saveGeneratedImage(
  out: string,
  ctxDir: string,
  base64: string,
  signal?: AbortSignal,
  writeTempFile: (handle: fs.FileHandle, data: Buffer) => Promise<void> = (handle, data) => handle.writeFile(data),
  publishFile: (temporary: string, destination: string) => Promise<void> = fs.link,
): Promise<SaveResult> {
  signal?.throwIfAborted()
  const requestedPath = path.isAbsolute(out) ? out : path.resolve(ctxDir, out)
  await fs.mkdir(path.dirname(requestedPath), { recursive: true })
  signal?.throwIfAborted()
  const ext = path.extname(requestedPath)
  const stem = requestedPath.slice(0, -ext.length || undefined)
  const tempPath = path.join(path.dirname(requestedPath), `.${path.basename(requestedPath)}.${randomUUID()}.tmp`)
  const handle = await fs.open(tempPath, "wx", 0o600)
  try {
    await writeTempFile(handle, Buffer.from(base64, "base64"))
    await handle.close()
    for (let version = 1; version <= MAX_OUTPUT_VERSION_SUFFIX; version++) {
      signal?.throwIfAborted()
      const savedPath = version === 1 ? requestedPath : `${stem}-v${version}${ext}`
      try {
        // The hard link is the commit point. Never remove a published path after
        // awaiting I/O: another writer may already have replaced that entry.
        await publishFile(tempPath, savedPath)
        return {
          savedPath,
          versioned: savedPath !== requestedPath,
          message: buildSavedMessage(savedPath, requestedPath),
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
    }
    throw new Error(`could not find a non-conflicting filename for ${requestedPath}`)
  } finally {
    try {
      await handle.close()
    } finally {
      await fs.unlink(tempPath)
    }
  }
}
