#!/usr/bin/env node
/**
 * `tauri dev` launcher that refuses to be blocked by a busy port.
 *
 * Why this exists: `vite.config.ts` pins the dev server to 11422 and
 * `tauri.conf.json` points `devUrl` at the same number, so a leftover dev
 * server (a crashed run, a second checkout) meant `npm run tauri dev` died on
 * "Port 11422 is already in use" and nothing started at all.
 *
 * Here we probe for a free port first, hand it to vite through
 * `GLIMMERX_DEV_PORT`, and use `tauri dev --config` to point `devUrl` at the
 * *same* port. Both sides therefore always agree, and the preferred port is
 * still used whenever it happens to be free.
 *
 * Usage: npm run dev:app  (or `make dev`)
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PREFERRED_PORT = Number(process.env.GLIMMERX_DEV_PORT) || 11422;
/** How far above the preferred port to look before giving up. */
const ATTEMPTS = 20;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** Resolves to true when the port can be bound on every interface. */
function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    // Binding without a host mirrors vite's default (all interfaces), which
    // is what decides whether vite can take the port.
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

/**
 * First bindable port at or above `preferred`, or null when the whole range is
 * taken. Exported so the probe can be exercised without launching Tauri.
 */
export async function findFreePort(preferred = PREFERRED_PORT, attempts = ATTEMPTS) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferred + offset;
    if (port > 65535) break;
    if (await isFree(port)) return port;
  }
  return null;
}

async function main() {
  const port = await findFreePort();

  if (port === null) {
    // Every candidate is taken. Falling back to the preferred port would only
    // reproduce the old hard failure, so say what is actually wrong.
    console.error(
      `[dev] no free port in ${PREFERRED_PORT}..${PREFERRED_PORT + ATTEMPTS - 1}.`,
    );
    console.error(
      "[dev] Free one of them, or run with GLIMMERX_DEV_PORT=<port> npm run dev:app.",
    );
    process.exit(1);
  }

  if (port !== PREFERRED_PORT) {
    console.warn(`[dev] port ${PREFERRED_PORT} is busy, using ${port}.`);
  }

  const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  // Only `devUrl` is overridden: `beforeDevCommand` stays owned by
  // tauri.conf.json, so there is one place to change how vite is started. The
  // port reaches vite through the environment instead of the command string,
  // so the two values cannot drift apart.
  const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });

  const child = spawn(process.execPath, [tauriCli, "dev", "--config", config], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GLIMMERX_DEV_PORT: String(port) },
  });

  child.on("error", (error) => {
    console.error("[dev] failed to start tauri:", error.message);
    process.exit(1);
  });

  // Propagate the child's status so `make dev` fails when tauri fails, and
  // Ctrl+C tears both down (they share the console).
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
