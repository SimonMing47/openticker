import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  DATA_DIR,
  SERVICE_NAME
} from "./constants.js";
import { ensureAppDirs, fileExists } from "./fs.js";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../bin/openticker.js", import.meta.url));

export function getServiceDescriptor() {
  if (process.platform === "darwin") {
    return {
      platform: "darwin",
      filePath: path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_NAME}.plist`),
      label: SERVICE_NAME
    };
  }

  if (process.platform === "linux") {
    return {
      platform: "linux",
      filePath: path.join(
        os.homedir(),
        ".config",
        "systemd",
        "user",
        `${SERVICE_NAME}.service`
      ),
      label: SERVICE_NAME
    };
  }

  return {
    platform: process.platform,
    filePath: null,
    label: SERVICE_NAME
  };
}

export async function installService() {
  const descriptor = getServiceDescriptor();
  await ensureAppDirs();

  if (!descriptor.filePath) {
    throw new Error(`Platform ${process.platform} is not supported for service install`);
  }

  await fs.mkdir(path.dirname(descriptor.filePath), { recursive: true });
  await fs.writeFile(
    descriptor.filePath,
    descriptor.platform === "darwin" ? createLaunchdPlist() : createSystemdUnit(),
    "utf8"
  );

  if (descriptor.platform === "linux") {
    await execFileAsync("systemctl", ["--user", "daemon-reload"]);
    await execFileAsync("systemctl", ["--user", "enable", descriptor.label]);
  }

  return descriptor;
}

export async function uninstallService() {
  const descriptor = getServiceDescriptor();
  if (!descriptor.filePath || !(await fileExists(descriptor.filePath))) {
    return false;
  }

  try {
    await stopService();
  } catch {
    // Ignore stop errors during uninstall.
  }

  if (descriptor.platform === "linux") {
    try {
      await execFileAsync("systemctl", ["--user", "disable", descriptor.label]);
    } catch {
      // Ignore missing units.
    }
    await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  }

  await fs.rm(descriptor.filePath, { force: true });
  return true;
}

export async function startService() {
  const descriptor = getServiceDescriptor();

  if (descriptor.platform === "darwin") {
    await execFileAsync("launchctl", [
      "bootstrap",
      `gui/${process.getuid()}`,
      descriptor.filePath
    ]).catch(async () => {
      await execFileAsync("launchctl", [
        "kickstart",
        "-k",
        `gui/${process.getuid()}/${descriptor.label}`
      ]);
    });
    return;
  }

  if (descriptor.platform === "linux") {
    await execFileAsync("systemctl", ["--user", "start", descriptor.label]);
    return;
  }

  throw new Error(`Platform ${process.platform} is not supported for service start`);
}

export async function stopService() {
  const descriptor = getServiceDescriptor();

  if (descriptor.platform === "darwin") {
    await execFileAsync("launchctl", [
      "bootout",
      `gui/${process.getuid()}/${descriptor.label}`
    ]);
    return;
  }

  if (descriptor.platform === "linux") {
    await execFileAsync("systemctl", ["--user", "stop", descriptor.label]);
    return;
  }

  throw new Error(`Platform ${process.platform} is not supported for service stop`);
}

export async function getServiceStatus() {
  const descriptor = getServiceDescriptor();
  const installed = Boolean(descriptor.filePath && (await fileExists(descriptor.filePath)));

  if (!installed) {
    return {
      ...descriptor,
      installed: false,
      active: false
    };
  }

  if (descriptor.platform === "darwin") {
    try {
      await execFileAsync("launchctl", [
        "print",
        `gui/${process.getuid()}/${descriptor.label}`
      ]);
      return {
        ...descriptor,
        installed: true,
        active: true
      };
    } catch {
      return {
        ...descriptor,
        installed: true,
        active: false
      };
    }
  }

  if (descriptor.platform === "linux") {
    try {
      const result = await execFileAsync("systemctl", [
        "--user",
        "is-active",
        descriptor.label
      ]);
      return {
        ...descriptor,
        installed: true,
        active: result.stdout.trim() === "active"
      };
    } catch {
      return {
        ...descriptor,
        installed: true,
        active: false
      };
    }
  }

  return {
    ...descriptor,
    installed,
    active: false
  };
}

function createLaunchdPlist() {
  const stdoutPath = path.join(DATA_DIR, "service.stdout.log");
  const stderrPath = path.join(DATA_DIR, "service.stderr.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${process.execPath}</string>
      <string>${cliPath}</string>
      <string>daemon</string>
      <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${stdoutPath}</string>
    <key>StandardErrorPath</key>
    <string>${stderrPath}</string>
    <key>WorkingDirectory</key>
    <string>${process.cwd()}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${process.env.PATH}</string>
    </dict>
  </dict>
</plist>
`;
}

function createSystemdUnit() {
  return `[Unit]
Description=OpenTicker daemon
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${cliPath} daemon run
Restart=always
RestartSec=3
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;
}
