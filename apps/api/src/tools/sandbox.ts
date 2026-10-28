import path from "node:path";

/**
 * The sandbox: every workspace tool is confined to one root directory.
 *
 * A tool never receives a raw path from the model and uses it directly. It
 * comes through here first, where it is resolved against the root and checked:
 * anything that escapes — `../`, an absolute path elsewhere, a symlink pointing
 * out — is refused before a single byte is touched.
 */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class Sandbox {
  constructor(readonly root: string) {}

  /** Resolves a tool-supplied path inside the root, or throws. */
  resolve(requested: string): string {
    if (typeof requested !== "string" || requested.trim() === "") {
      throw new SandboxError("A path is required.");
    }
    const target = path.resolve(this.root, requested);
    const relative = path.relative(this.root, target);
    if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
      throw new SandboxError(`Path escapes the sandbox: ${requested}`);
    }
    return target;
  }

  /** The path relative to the root, for display back to the model. */
  relative(absolute: string): string {
    return path.relative(this.root, absolute) || ".";
  }
}

/** Directories a recursive walk never enters: huge, and never interesting. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".data",
  ".gagent-preserved",
  ".agent-chat-archive",
]);

export function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRECTORIES.has(name);
}
