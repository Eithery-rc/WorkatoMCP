# MokuTab Bridge Installation Guide

How `@mokuhub/mokutab-bridge` gets installed and registered as Chrome's native-messaging host, and what to check when it does not connect.

## Installation flow overview

```
npm install -g @mokuhub/mokutab-bridge   (or: node app/native-server/dist/cli.js register)
└─ postinstall / register
   ├─ Verify compiled files (index.js, cli.js, run_host.bat/sh)
   ├─ Attempt user-level registration     ← no admin required; succeeds in most cases
   └─ On failure ➜ prompt the user to run register --system
      └─ Requires manual execution with admin privileges
```

Upgrading from 1.x: uninstall the old `workatomcp-bridge` package first, with Chrome closed. The new package keeps the old command names as aliases until 3.0, so npm refuses to install it over the old one (`EEXIST`). The full order is in the [README](../../README.md#upgrade-from-workatomcp-1x).

## Installation steps

### 1. Install or register

#### Option A: from npm (recommended)

```bash
npm install -g @mokuhub/mokutab-bridge
```

Postinstall registers the native-messaging host for the detected browsers.

#### Option B: from a repository clone

After `pnpm build`, register the build in place:

```bash
node app/native-server/dist/cli.js register
```

or install it globally from the local folder, so the `mokutab-bridge` command is available anywhere:

```bash
npm install -g ./app/native-server
```

### 2. User-level registration

User-level registration writes the manifest file to:

```
Manifest file locations
├─ User-level (no admin required)
│  ├─ Windows: %APPDATA%\Google\Chrome\NativeMessagingHosts\
│  ├─ macOS:   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
│  └─ Linux:   ~/.config/google-chrome/NativeMessagingHosts/
│
└─ System-level (admin required)
   ├─ Windows: %ProgramFiles%\Google\Chrome\NativeMessagingHosts\
   ├─ macOS:   /Library/Google/Chrome/NativeMessagingHosts/
   └─ Linux:   /etc/opt/chrome/native-messaging-hosts/
```

If automatic registration failed, or to register again:

```bash
mokutab-bridge register                 # the browsers found on this machine
mokutab-bridge register --browser all   # Chrome and Chromium
mokutab-bridge register --force         # re-register over an existing manifest
```

**Then run the diagnostic tool:**

```bash
mokutab-bridge doctor
```

### 3. System-level registration

If user-level registration fails (for example because of permissions), register system-wide. This needs admin privileges.

```bash
# macOS/Linux
sudo mokutab-bridge register --system

# Windows (run Command Prompt as Administrator)
mokutab-bridge register --system
```

System-level registration writes to system directories and, on Windows, to the `HKLM` registry hive.

## Registration details

### Registration flow

```
Registration flow
├─ User-level registration (mokutab-bridge register)
│  ├─ Determine the user-level manifest path
│  ├─ Create the directory
│  ├─ Generate the manifest content
│  ├─ Write the manifest file
│  └─ Windows: create the user-level registry key
│
└─ System-level registration (mokutab-bridge register --system)
   ├─ Check for admin privileges
   │  ├─ Have privileges → create the system directory and write the manifest
   │  └─ No privileges  → prompt the user to re-run with admin privileges
   └─ Windows: create the system-level registry key
```

### Manifest file structure

```
com.chromemcp.nativehost.json
├─ name: "com.chromemcp.nativehost"
├─ description: "MokuTab native messaging host (Chrome ↔ MCP bridge)"
├─ path: "/path/to/run_host.sh"       ← launcher script inside the installed package (run_host.bat on Windows)
├─ type: "stdio"                      ← communication type
└─ allowed_origins: [                 ← the only extension allowed to connect
   "chrome-extension://bpjpdgkeelhkijkllcmogemkmndgeana/"
]
```

The host name `com.chromemcp.nativehost` and the extension ID are the same as in 1.x, so an upgrade re-registers the same host and the extension keeps working.

## Verifying the installation

1. `mokutab-bridge doctor` reports no failures. It checks the manifest (present, pointing at an existing wrapper inside this package, not into the old 1.x package), the Node.js path, the port, and what a 1.x install may have left behind.
2. The extension is loaded at `chrome://extensions/` with the ID `bpjpdgkeelhkijkllcmogemkmndgeana`.
3. The extension popup says the service is running, and `curl http://127.0.0.1:12306/ping` answers.

## Troubleshooting

```
Troubleshooting
├─ Permission issues
│  ├─ Execution permission (macOS/Linux)
│  │  ├─ "Permission denied" error
│  │  ├─ "Native host has exited" error
│  │  └─ Run mokutab-bridge fix-permissions
│  │
│  └─ Try mokutab-bridge register --system
│
├─ Path issues
│  ├─ Check the Node.js installation (node -v)
│  ├─ Check the global npm path (npm root -g)
│  └─ Set CHROME_MCP_NODE_PATH, or run mokutab-bridge doctor --fix
│
├─ Registry issues (Windows)
│  ├─ HKCU\Software\Google\Chrome\NativeMessagingHosts\
│  └─ HKLM\Software\Google\Chrome\NativeMessagingHosts\ (system-level)
│
└─ Other issues
   ├─ The wrapper logs (below)
   └─ mokutab-bridge report --copy, attached to an issue
```

### Common steps

1. **Node.js.** Run `node -v` and `npm -v`; the bridge needs Node.js 20 or later. The wrapper uses the Node.js that ran the install (recorded in `node_path.txt` next to it); `CHROME_MCP_NODE_PATH` overrides it.

2. **Execution permission (macOS/Linux).** npm installs usually preserve file permissions, but pnpm may not, and the symptom is "Permission denied" or "Native host has exited". Fix it with:

   ```bash
   mokutab-bridge fix-permissions
   # or
   mokutab-bridge doctor --fix
   ```

   or by hand:

   ```bash
   npm root -g    # then, under <that dir>/@mokuhub/mokutab-bridge/dist:
   chmod +x run_host.sh index.js cli.js
   ```

3. **Windows.** `.bat` files need no execute permission, but a file marked read-only or a restricted registry key can stop the host. Run `mokutab-bridge fix-permissions` or `mokutab-bridge doctor --fix`, check access to the registry keys above, and if it persists reinstall:

   ```bash
   npm uninstall -g @mokuhub/mokutab-bridge
   npm install -g @mokuhub/mokutab-bridge
   ```

4. **System-level registration.** `mokutab-bridge register --system`, from an elevated prompt.

5. **The logs.** The wrapper writes to `%LOCALAPPDATA%\mokutab-bridge\logs` on Windows, `~/Library/Logs/mokutab-bridge` on macOS and `$XDG_STATE_HOME/mokutab-bridge/logs` (or `~/.local/state/mokutab-bridge/logs`) on Linux. `doctor` and `report` read them too.

If the problem persists, file an issue on the project repository with the output of `mokutab-bridge report --copy` (redacted), plus:

- Operating system version
- Node.js version
- Installation command used
- Error messages
- Steps already tried
