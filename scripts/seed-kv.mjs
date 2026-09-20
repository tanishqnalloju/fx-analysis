#!/usr/bin/env node
/**
 * Upload public/data/snapshot.json + history.json into Cloudflare KV once.
 * Uses CLOUDFLARE_API_TOKEN + account/namespace from wrangler.jsonc.
 *
 * Usage:
 *   export PATH="/home/box/.local/node/bin:$PATH"
 *   export CLOUDFLARE_API_TOKEN=…   # never commit
 *   node scripts/seed-kv.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT_ID = "2161e11f506e6d2afde89f05a6f438eb";
const NS_ID = "05be48d5b28d447d950d2b614e749df6";

function loadToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const secrets = JSON.parse(
      readFileSync("/home/box/agent-data/box-secrets.json", "utf8")
    );
    const t = secrets?.card?.CLOUDFLARE_API_TOKEN;
    if (t) return t;
  } catch {
    /* ignore */
  }
  throw new Error("CLOUDFLARE_API_TOKEN not set and not found in box-secrets.json");
}

async function putKey(token, key, valueObj) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NS_ID}/values/${encodeURIComponent(key)}`;
  const body = JSON.stringify(valueObj);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!res.ok || json.success === false) {
    throw new Error(`KV put ${key} failed HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function main() {
  const token = loadToken();
  const snap = JSON.parse(readFileSync(join(root, "public/data/snapshot.json"), "utf8"));
  const hist = JSON.parse(readFileSync(join(root, "public/data/history.json"), "utf8"));
  const meta = {
    lastRefresh: new Date().toISOString(),
    source: "seed-kv.mjs",
    asOf: snap.asOf || null,
    fxCount: snap.fx?.length ?? 0,
    historySeries: Object.keys(hist.series || {}).length,
    historyFrom: hist.from || null,
    historyTo: hist.to || null,
    note: "Seeded from baked public/data/*.json",
  };

  console.log("seed-kv: putting snapshot…");
  await putKey(token, "snapshot", snap);
  console.log("seed-kv: putting history…");
  await putKey(token, "history", hist);
  console.log("seed-kv: putting meta…");
  await putKey(token, "meta", meta);
  console.log("seed-kv ok");
  console.log(`  fx=${meta.fxCount} historySeries=${meta.historySeries} asOf=${meta.asOf}`);
}

main().catch((e) => {
  console.error("seed-kv FAIL:", e.message || e);
  process.exit(1);
});
