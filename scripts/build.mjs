import { cp, mkdir, rm } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const exec = promisify(execFile);
const cargo = join(homedir(), ".cargo", "bin", process.platform === "win32" ? "cargo.exe" : "cargo");
const env = { ...process.env, PATH: `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH}` };

await rm(dist, { recursive: true, force: true });
await exec(cargo, ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", join(root, "Cargo.toml")], { env });
for (const browser of ["chrome", "firefox"]) {
  const target = join(dist, browser);
  await mkdir(target, { recursive: true });
  await cp(join(root, "extension"), target, { recursive: true });
  await cp(join(root, "target", "wasm32-unknown-unknown", "release", "explain_core.wasm"), join(target, "core.wasm"));
  await cp(join(root, `manifests/${browser}.json`), join(target, "manifest.json"));
  await exec("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${target}\\*' -DestinationPath '${join(dist, `${browser}.zip`)}' -Force`]).catch(async () => {
    await exec("zip", ["-qr", join(dist, `${browser}.zip`), "."], { cwd: target });
  });
}
