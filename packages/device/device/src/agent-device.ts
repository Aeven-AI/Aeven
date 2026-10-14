/**
 * What pins the model's agent-device commands to one host daemon and one
 * device session: a per-host endpoint file, a per-(session, host, device)
 * session name, and a launcher script that refuses commands missing either.
 *
 * @module @aeven/device/agent-device
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentDeviceEndpoint } from './host.ts'

const key = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

/**
 * The endpoint file for one host. A stable path per host lets a restarted
 * daemon's new port reach commands already pinned to the file.
 * @param stateDir - the device state directory.
 * @param hostId - the host.
 * @returns the file path.
 */
export function agentDeviceConfigPath(stateDir: string, hostId: string): string {
  return join(stateDir, 'hosts', `${key(hostId)}.json`)
}

/**
 * The agent-device session name for one device opened by one session, so
 * concurrent devices and sessions keep separate agent-device state.
 * @param sessionId - the Aeven session.
 * @param hostId - the device's host.
 * @param deviceId - the device.
 * @returns the session name.
 */
export function agentDeviceSession(sessionId: string, hostId: string, deviceId: string): string {
  return `avn-${key(JSON.stringify([sessionId, hostId, deviceId]))}`
}

/**
 * Write the endpoint file, readable by the Host user only, replacing it
 * atomically when it changed.
 * @param file - from {@link agentDeviceConfigPath}.
 * @param endpoint - the daemon's address and token.
 */
export async function writeAgentDeviceConfig(file: string, endpoint: AgentDeviceEndpoint): Promise<void> {
  const content = JSON.stringify({ daemonBaseUrl: endpoint.baseUrl, daemonAuthToken: endpoint.token })
  const existing = await readFile(file, 'utf8').catch(() => undefined)
  if (existing === content) return
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600 })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * Write the `agent-device` launcher the model runs. It runs the pinned
 * install with the host's Node, strips daemon variables a user shell may
 * carry, and refuses any command without `--config` and `--session`, which
 * `device_open` hands the model.
 * @param stateDir - the device state directory.
 * @param nodePath - Node executable.
 * @param entryPath - agent-device's entry script.
 * @returns the launcher's absolute path.
 */
export async function ensureAgentDeviceLauncher(stateDir: string, nodePath: string, entryPath: string): Promise<string> {
  const dir = join(stateDir, 'bin')
  await mkdir(dir, { recursive: true })
  const script = join(dir, 'agent-device-launcher.mjs')
  await writeFile(script, `import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const informational = args.length === 1 && ["help", "--help", "-h", "--version", "version"].includes(args[0]);
const hasValue = flag => { const index = args.indexOf(flag); return index >= 0 && !!args[index + 1] && !args[index + 1].startsWith("--"); };
if (!informational && !(hasValue("--config") && hasValue("--session"))) {
  console.error("Call device_open first and include its --config and --session flags.");
  process.exit(1);
}
const env = { ...process.env };
delete env.AGENT_DEVICE_DAEMON_BASE_URL;
delete env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
delete env.AGENT_DEVICE_CONFIG;
const child = spawn(${JSON.stringify(nodePath)}, [${JSON.stringify(entryPath)}, ...args], { stdio: "inherit", env });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
`)
  if (process.platform === 'win32') {
    const launcher = join(dir, 'agent-device.cmd')
    await writeFile(launcher, `@echo off\r\n"${nodePath}" "${script}" %*\r\n`)
    return launcher
  }
  const quote = (value: string) => `'${value.replaceAll("'", '\'"\'"\'')}'`
  const launcher = join(dir, 'agent-device')
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(nodePath)} ${quote(script)} "$@"\n`)
  await chmod(launcher, 0o755)
  return launcher
}
