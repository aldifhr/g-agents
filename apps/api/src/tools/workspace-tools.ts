import { promises as fs } from "node:fs";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { Sandbox, shouldSkipDirectory } from "./sandbox.js";

/**
 * The workspace tools: what an agent can see and change in the codebase.
 *
 * Every path goes through the sandbox, every listing is capped, and every
 * patch is an exact-match replacement — an agent cannot rewrite a file it has
 * not read, because the old text has to match byte for byte.
 */

const MAX_ENTRIES = 500;
const MAX_OUTPUT_CHARS = 20_000;

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… truncated at ${MAX_OUTPUT_CHARS} characters`
    : text;
}

/** Recursively lists files (not directories) under a sandbox path. */
async function walk(sandbox: Sandbox, absolute: string, cap: number): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [absolute];
  while (queue.length > 0 && found.length < cap) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= cap) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) queue.push(full);
      } else if (entry.isFile()) {
        // Forward slashes everywhere, so a listed path can be pasted straight
        // into read_file or search_code without the model normalising it.
        found.push(sandbox.relative(full).split(path.sep).join("/"));
      }
    }
  }
  return found;
}

/** Builds the four workspace tools, all confined to the given sandbox. */
export function createWorkspaceTools(sandbox: Sandbox) {
  return {
    /** Lists files under a directory, as paths relative to the sandbox root. */
    list_files: tool({
      description:
        "List files in the workspace, as paths relative to the root. Directories like node_modules are skipped. Use this to discover the layout before reading.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory to list, relative to the root. Defaults to the root itself."),
      }),
      execute: async ({ path: requested }) => {
        const target = sandbox.resolve(requested ?? ".");
        const stat = await fs.stat(target).catch(() => null);
        if (!stat?.isDirectory()) return `Not a directory: ${requested ?? "."}`;
        const files = await walk(sandbox, target, MAX_ENTRIES);
        if (files.length === 0) return "No files found.";
        return truncate(files.join("\n"));
      },
    }),

    /** Reads a line range of a file, with line numbers. */
    read_file: tool({
      description:
        "Read a file from the workspace with line numbers. Reads at most 400 lines starting at offset; call again with a larger offset to continue.",
      inputSchema: z.object({
        path: z.string().describe("File to read, relative to the root."),
        offset: z.number().int().optional().describe("1-based line to start from. Defaults to 1."),
        limit: z.number().int().optional().describe("How many lines to read. Defaults to 400."),
      }),
      execute: async ({ path: requested, offset, limit }) => {
        const target = sandbox.resolve(requested);
        const content = await fs.readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (content === null) return `No such file: ${requested}`;
        const lines = content.split("\n");
        const from = Math.max(1, Math.floor(offset ?? 1));
        const count = Math.min(400, Math.max(1, Math.floor(limit ?? 400)));
        const slice = lines.slice(from - 1, from - 1 + count);
        const body = slice.map((line, index) => `${String(from + index).padStart(5)} | ${line}`).join("\n");
        return truncate(`${requested} — lines ${from}-${from - 1 + slice.length} of ${lines.length}\n${body}`);
      },
    }),

    /** Regex search across the workspace, with matching lines. */
    search_code: tool({
      description:
        "Search the workspace with a regular expression and get back matching lines with file paths and line numbers. node_modules and .git are skipped.",
      inputSchema: z.object({
        pattern: z.string().describe("Regular expression to search for."),
        path: z.string().optional().describe("Directory to search, relative to the root. Defaults to the root."),
      }),
      execute: async ({ pattern, path: requested }) => {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, "i");
        } catch (error) {
          return `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`;
        }
        const target = sandbox.resolve(requested ?? ".");
        const files = await walk(sandbox, target, MAX_ENTRIES);
        const hits: string[] = [];
        for (const file of files) {
          if (hits.length >= 50) break;
          let content: string;
          try {
            content = await fs.readFile(path.join(sandbox.root, file), "utf8");
          } catch {
            continue;
          }
          const lines = content.split("\n");
          for (let index = 0; index < lines.length && hits.length < 50; index += 1) {
            if (regex.test(lines[index]!)) {
              hits.push(`${file}:${index + 1}: ${lines[index]!.trim().slice(0, 200)}`);
            }
          }
        }
        if (hits.length === 0) return `No matches for /${pattern}/.`;
        return truncate(hits.join("\n"));
      },
    }),

    /** Exact-match replacement inside a file. */
    patch_file: tool({
      description:
        "Replace an exact span of text in a file with new text. The old text must match byte for byte, so read the file first. Creates no new files.",
      inputSchema: z.object({
        path: z.string().describe("File to patch, relative to the root."),
        old_text: z.string().describe("The exact text to replace."),
        new_text: z.string().describe("The replacement text."),
      }),
      execute: async ({ path: requested, old_text, new_text }) => {
        if (!old_text) return "old_text is required and cannot be empty.";
        // A no-op edit is not a patch: say so, rather than reporting a change
        // that would leave the file byte-for-byte identical.
        if (old_text === new_text) {
          return `No change: old_text and new_text are identical in ${requested}.`;
        }
        const target = sandbox.resolve(requested);
        const content = await fs.readFile(target, "utf8").catch(() => null);
        if (content === null) return `No such file: ${requested}`;
        const occurrences = content.split(old_text).length - 1;
        if (occurrences === 0) {
          return `old_text not found in ${requested}. Read the file and copy the text exactly.`;
        }
        if (occurrences > 1) {
          return `old_text matches ${occurrences} places in ${requested}. Include more surrounding context to make it unique.`;
        }
        const patched = content.replace(old_text, new_text);
        await fs.writeFile(target, patched, "utf8");
        return `Patched ${requested} (${content.split("\n").length} → ${patched.split("\n").length} lines).`;
      },
    }),
  };
}

export type WorkspaceTools = ReturnType<typeof createWorkspaceTools>;
