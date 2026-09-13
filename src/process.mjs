import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// File descriptors avoid Windows restricted-token failures creating capture pipes.
// Commands still run as real child processes with their original exit status.
export function captureProcess(command, args, options = {}) {
  if (process.platform !== "win32") return spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  const directory = mkdtempSync(join(tmpdir(), "ai-sdlc-command-"));
  const stdoutPath = join(directory, "stdout");
  const stderrPath = join(directory, "stderr");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync(command, args, { ...options, windowsHide: true, stdio: ["ignore", stdoutFd, stderrFd] });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  try {
    return { ...result, stdout: readFileSync(stdoutPath, "utf8"), stderr: readFileSync(stderrPath, "utf8") };
  } finally {
    unlinkSync(stdoutPath);
    unlinkSync(stderrPath);
    rmdirSync(directory);
  }
}
