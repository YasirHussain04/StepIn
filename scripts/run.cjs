const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const targets = {
  expo: "expo/bin/cli",
  tsc: "typescript/bin/tsc",
  vitest: "vitest/vitest.mjs",
};
const target = targets[process.argv[2]];
if (!target) throw new Error("Unknown project tool");
const localNode = path.resolve(
  "node_modules/node/bin",
  process.platform === "win32" ? "node.exe" : "node",
);
const result = spawnSync(
  existsSync(localNode) ? localNode : process.execPath,
  [path.resolve("node_modules", target), ...process.argv.slice(3)],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
