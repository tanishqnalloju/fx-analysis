#!/usr/bin/env node
/**
 * Run validate then build.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(script) {
  const r = spawnSync(node, [join(root, "scripts", script)], {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("validate.mjs");
run("build.mjs");
console.log("check ok");
