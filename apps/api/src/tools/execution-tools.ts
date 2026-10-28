import { exec } from "node:child_process";
import { Sandbox } from "./sandbox.js";
import { tool } from "ai";
import { z } from "zod";

/**
 * The execution tools: the agent acts on the workspace, not just reads it.
 *
 * Every command runs inside the sandbox with a wall-clock cap and a captured,
 * truncated output. A timeout kills the process; nothing is left running in
 * the background to surprise the operator later.
 */

const MAX_OUTPUT_CHARS = 20_000;

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… truncated at ${MAX_OUTPUT_CHARS} characters`
    : text;
}

/** Runs a shell command in the sandbox, resolving with its combined output. */
function run(command: string, cwd: string, timeoutMs: number): Promise<{ output: string; ok: boolean }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const combined = `${stdout ?? ""}${stderr ?? ""}`.trim();
        if (error && error.killed) {
          resolve({ output: `Command timed out after ${timeoutMs}ms and was killed.\n${combined}`, ok: false });
          return;
        }
        resolve({ output: truncate(combined || "(no output)"), ok: !error });
      },
    );
  });
}

/**
 * The shell this host actually runs, so the tool can say so.
 *
 * `exec` uses the platform shell: cmd.exe on Windows, /bin/sh elsewhere. An
 * agent that assumes a POSIX shell will reach for `ls` and `cat` and get a
 * confusing "not recognized" instead of a usable answer, so the description
 * names the shell and its native commands outright.
 */
function shellDescription(): string {
  const isWindows = process.platform === "win32";
  return isWindows
    ? "Run a shell command in the workspace and get its combined stdout/stderr. This host runs the Windows command shell (cmd.exe), so use its native commands: dir instead of ls, type instead of cat, findstr instead of grep, and && to chain. There is a time limit; long-running commands are killed. Use it to build, inspect, and run things."
    : "Run a shell command in the workspace and get its combined stdout/stderr. This host runs a POSIX shell (/bin/sh). There is a time limit; long-running commands are killed. Use it to build, inspect, and run things.";
}

export type ExecutionContext = {
  sandbox: Sandbox;
  timeoutMs: number;
  testCommand: string;
};

/** Builds the three execution tools, all confined to the given sandbox. */
export function createExecutionTools(context: ExecutionContext) {
  const { sandbox, timeoutMs, testCommand } = context;

  return {
    /** Runs a shell command in the workspace. */
    run_terminal: tool({
      description: shellDescription(),
      inputSchema: z.object({
        command: z.string().describe("The shell command to run."),
      }),
      execute: async ({ command }) => {
        const result = await run(command, sandbox.root, timeoutMs);
        return `$ ${command}\n${result.output}`;
      },
    }),

    /** Git status of the workspace. */
    git_status: tool({
      description:
        "Show the git status of the workspace: changed, staged, and untracked files. Use it before and after making changes.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await run("git status --short --branch", sandbox.root, timeoutMs);
        return result.output;
      },
    }),

    /** The workspace diff, so a change can be reviewed before it is claimed. */
    git_diff: tool({
      description:
        "Show a git diff of the workspace. By default shows unstaged changes; pass staged to show what is staged, or a path to limit the diff to one file or directory.",
      inputSchema: z.object({
        staged: z.boolean().optional().describe("Show staged changes instead of unstaged. Defaults to false."),
        path: z.string().optional().describe("Limit the diff to this path, relative to the root."),
      }),
      execute: async ({ staged, path: requested }) => {
        const parts = ["git", "--no-pager", "diff"];
        if (staged) parts.push("--staged");
        if (requested) parts.push("--", JSON.stringify(requested));
        const command = parts.join(" ");
        const result = await run(command, sandbox.root, timeoutMs);
        return `$ ${command}\n${result.output}`;
      },
    }),

    /** Runs the project's test command in the workspace. */
    run_tests: tool({
      description:
        "Run the project's test suite in the workspace and get the result. Use it to verify a change before claiming it works.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await run(testCommand, sandbox.root, timeoutMs);
        return `$ ${testCommand}\n${result.output}`;
      },
    }),
  };
}

export type ExecutionTools = ReturnType<typeof createExecutionTools>;
