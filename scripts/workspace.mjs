import { spawnSync } from "node:child_process";

const [workspace, script, ...rest] = process.argv.slice(2);

if (!workspace || !script) {
  console.error("usage: node scripts/workspace.mjs <workspace> <script> [...args]");
  process.exit(1);
}

const userAgent = process.env.npm_config_user_agent ?? "";
const isBun = Boolean(process.versions.bun) || userAgent.startsWith("bun/");
const isWindows = process.platform === "win32";

const [command, args] = isBun
  ? ["bun", ["run", "--filter", workspace, script, "--", ...rest]]
  : [isWindows ? "npm.cmd" : "npm", ["run", script, "--workspace", workspace, "--", ...rest]];

const result = spawnSync(command, args, { stdio: "inherit", shell: isWindows });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
