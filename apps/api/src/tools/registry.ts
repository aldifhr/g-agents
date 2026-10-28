import type { ToolSet } from "ai";
import type { AppConfig } from "../platform/config.js";
import { Sandbox } from "./sandbox.js";
import { createWorkspaceTools, type WorkspaceTools } from "./workspace-tools.js";
import { createExecutionTools, type ExecutionTools } from "./execution-tools.js";

/**
 * The tool registry: one place that knows every tool an agent can call.
 *
 * An agent's `tools` field is a JSON array of names; an empty field means all
 * of them. The registry turns that permission into the actual tool record the
 * model sees, so an agent can never call a tool it was not granted — the tool
 * simply is not in the request.
 */

export const TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_code",
  "patch_file",
  "run_terminal",
  "git_status",
  "git_diff",
  "run_tests",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Human-readable blurbs, for the agent modal and the system prompt. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_files: "List files in the workspace",
  read_file: "Read a file with line numbers",
  search_code: "Regex search across the workspace",
  patch_file: "Exact-match edit inside a file",
  run_terminal: "Run a shell command in the workspace",
  git_status: "Git status of the workspace",
  git_diff: "Show the workspace diff",
  run_tests: "Run the project's test suite",
};

type AllTools = WorkspaceTools & ExecutionTools;

export class ToolRegistry {
  private readonly all: AllTools;

  constructor(config: AppConfig) {
    const sandbox = new Sandbox(config.sandboxRoot);
    this.all = { ...createWorkspaceTools(sandbox), ...createExecutionTools({
      sandbox,
      timeoutMs: config.toolTimeoutMs,
      testCommand: config.testCommand,
    }) };
  }

  /**
   * The tool names an agent's permission grants.
   *
   * The stored form is a JSON array: `["*"]` (or an empty column) means every
   * tool, `[]` means none, and a list of names means exactly those.
   */
  static permittedNames(tools: string[]): ToolName[] {
    if (tools.includes("*")) return [...TOOL_NAMES];
    return TOOL_NAMES.filter((name) => tools.includes(name));
  }

  /** The tool record for one agent, filtered by its permission. */
  forAgent(tools: string[]): ToolSet {
    const allowed = new Set(ToolRegistry.permittedNames(tools));
    const record: ToolSet = {};
    for (const [name, definition] of Object.entries(this.all)) {
      if (allowed.has(name as ToolName)) record[name] = definition;
    }
    return record;
  }

  /** Every tool's name and blurb, for the settings UI. */
  describeAll(): Array<{ name: ToolName; description: string }> {
    return TOOL_NAMES.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name] }));
  }
}
