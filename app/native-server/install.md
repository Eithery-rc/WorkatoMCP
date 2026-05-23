# Workato MCP Bridge Installation Guide

This document explains the installation and registration flow for Workato MCP Bridge.

## Installation Flow Overview

```
node app/native-server/dist/cli.js register  (or npm install -g ./app/native-server)
└─ cli.js
   ├─ Verify compiled files (index.js, cli.js, run_host.bat/sh)
   ├─ Attempt user-level registration     ← no admin required; succeeds in most cases
   └─ On failure ➜ prompt user to run register --system
      └─ Requires manual execution with admin privileges
```

The flow above shows the complete path from local compilation/installation to final registration.

## Detailed Installation Steps

### 1. Installation & Registration Options

Since `workatomcp-bridge` is compiled locally from source, you can register it using one of two methods:

#### Option A: Direct Registration from the Repository Clone (Recommended)

This is the simplest way. From the repository root, run:

```bash
node app/native-server/dist/cli.js register
```

#### Option B: Global Installation from the Local Folder

If you want to install it globally on your system path so the `workatomcp-bridge` command is available anywhere, run:

```bash
npm install -g ./app/native-server
```

### 2. User-Level Registration

User-level registration creates the manifest file at:

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

If automatic registration fails, or if you want to register manually, run:

```bash
mcp-chrome-bridge register
```

**Recommended: run the diagnostic tool to check for issues:**

```bash
mcp-chrome-bridge doctor
```

### 3. System-Level Registration

If user-level registration fails (e.g. due to permission issues), you can try system-level registration. This requires admin privileges, but two convenient methods are provided.

#### Option A: Use the `--system` flag (recommended)

```bash
# macOS/Linux
sudo mcp-chrome-bridge register --system

# Windows (run Command Prompt as Administrator)
mcp-chrome-bridge register --system
```

System-level installation requires admin privileges to write to system directories and the registry.

#### Option B: Run directly with admin privileges

**Windows**: Open an elevated Command Prompt or PowerShell and run:

```
mcp-chrome-bridge register
```

**macOS/Linux**: Use sudo:

```
sudo mcp-chrome-bridge register
```

## Registration Flow Details

### Registration Flow Diagram

```
Registration flow
├─ User-level registration (mcp-chrome-bridge register)
│  ├─ Determine user-level manifest path
│  ├─ Create user directory
│  ├─ Generate manifest content
│  ├─ Write manifest file
│  └─ Windows: create user-level registry key
│
└─ System-level registration (mcp-chrome-bridge register --system)
   ├─ Check for admin privileges
   │  ├─ Have privileges → create system directory and write manifest directly
   │  └─ No privileges  → prompt user to re-run with admin privileges
   └─ Windows: create system-level registry key
```

### Manifest File Structure

```
manifest.json
├─ name: "com.chromemcp.nativehost"
├─ description: "Node.js Host for Browser Bridge Extension"
├─ path: "/path/to/run_host.sh"       ← launcher script path
├─ type: "stdio"                      ← communication type
└─ allowed_origins: [                 ← extensions allowed to connect
   "chrome-extension://<extensionId>/"
]
```

### User-Level Registration Steps

1. Determine the user-level manifest file path
2. Create required directories
3. Generate manifest content, including:
   - Host name
   - Description
   - Node.js executable path
   - Communication type (stdio)
   - Allowed extension IDs
   - Launch arguments
4. Write the manifest file
5. On Windows, also create the corresponding registry key

### System-Level Registration Steps

1. Detect whether admin privileges are already held
2. If admin privileges are present:
   - Create system-level directory directly
   - Write manifest file
   - Set appropriate permissions
   - On Windows, create system-level registry key
3. If no admin privileges:
   - Prompt user to re-run the command with admin privileges
   - macOS/Linux: `sudo mcp-chrome-bridge register --system`
   - Windows: run Command Prompt as Administrator

## Verifying the Installation

### Verification Flow Diagram

```
Verify installation
├─ Check manifest file
│  ├─ File exists → verify content is correct
│  └─ File missing → reinstall
│
├─ Check Chrome extension
│  ├─ Extension installed → verify extension permissions
│  └─ Extension missing  → install extension
│
└─ Test connection
   ├─ Connection succeeds → installation complete
   └─ Connection fails   → check error logs → see Troubleshooting
```

### Verification Steps

After installation completes, verify success by:

1. Check whether the manifest file exists in the appropriate directory
   - User-level: check the user directory for the manifest file
   - System-level: check the system directory for the manifest file
   - Confirm the manifest file content is correct

2. Install the corresponding extension in Chrome
   - Ensure the extension is correctly installed
   - Ensure the extension has the `nativeMessaging` permission

3. Try connecting to the local service via the extension
   - Use the extension's test feature to attempt a connection
   - Check Chrome's extension logs for any error messages

## Troubleshooting

### Troubleshooting Flow Diagram

```
Troubleshooting
├─ Permission issues
│  ├─ Check user permissions
│  │  ├─ Sufficient permissions → check directory permissions
│  │  └─ Insufficient permissions → try system-level installation
│  │
│  ├─ Execution permission issues (macOS/Linux)
│  │  ├─ "Permission denied" error
│  │  ├─ "Native host has exited" error
│  │  └─ Run mcp-chrome-bridge fix-permissions
│  │
│  └─ Try mcp-chrome-bridge register --system
│
├─ Path issues
│  ├─ Check Node.js installation (node -v)
│  └─ Check global NPM path (npm root -g)
│
├─ Registry issues (Windows)
│  ├─ Check registry access permissions
│  └─ Try creating registry key manually
│
└─ Other issues
   ├─ Check console error messages
   └─ Submit an issue to the project repository
```

### Common Troubleshooting Steps

If you encounter issues during installation, try the following:

1. Ensure Node.js is correctly installed
   - Run `node -v` and `npm -v` to check versions
   - Ensure Node.js version >= 20.x

2. Check that you have sufficient permissions to create files and directories
   - User-level installation requires write access to the user directory
   - System-level installation requires Administrator/root privileges

3. **Fix execution permission issues**

   **macOS/Linux**:

   **Problem description**:
   - npm installs usually preserve file permissions, but pnpm may not
   - You may see "Permission denied" or "Native host has exited" errors
   - Chrome extension cannot launch the native host process

   **Solutions**:

   a) **Use the built-in fix command (recommended)**:

   ```bash
   mcp-chrome-bridge fix-permissions
   ```

   b) **Run the diagnostic tool with auto-fix**:

   ```bash
   mcp-chrome-bridge doctor --fix
   ```

   c) **Set permissions manually**:

   ```bash
   # Find the install path
   npm list -g mcp-chrome-bridge
   # Or for pnpm
   pnpm list -g mcp-chrome-bridge

   # Set execute permission (replace with actual path)
   chmod +x /path/to/node_modules/mcp-chrome-bridge/run_host.sh
   chmod +x /path/to/node_modules/mcp-chrome-bridge/index.js
   chmod +x /path/to/node_modules/mcp-chrome-bridge/cli.js
   ```

   **Windows**:

   **Problem description**:
   - `.bat` files on Windows generally do not need execute permission, but other issues may occur
   - Files may be marked as read-only
   - You may encounter "Access denied" or file-cannot-execute errors

   **Solutions**:

   a) **Use the built-in fix command (recommended)**:

   ```cmd
   mcp-chrome-bridge fix-permissions
   ```

   b) **Run the diagnostic tool with auto-fix**:

   ```cmd
   mcp-chrome-bridge doctor --fix
   ```

   c) **Check file attributes manually**:

   ```cmd
   # Find the install path
   npm list -g mcp-chrome-bridge

   # Check file attributes (right-click in File Explorer -> Properties)
   # Ensure run_host.bat is not read-only
   ```

   d) **Reinstall and force permissions**:

   ```bash
   # Uninstall
   npm uninstall -g mcp-chrome-bridge
   # Or pnpm uninstall -g mcp-chrome-bridge

   # Reinstall
   npm install -g mcp-chrome-bridge
   # Or pnpm install -g mcp-chrome-bridge

   # If issues persist, run permission fix
   mcp-chrome-bridge fix-permissions
   ```

4. On Windows, ensure registry access is not restricted
   - Check access to `HKCU\Software\Google\Chrome\NativeMessagingHosts\`
   - For system-level, check `HKLM\Software\Google\Chrome\NativeMessagingHosts\`

5. Try system-level installation
   - Use the `mcp-chrome-bridge register --system` command
   - Or run directly with admin privileges

6. Check error messages in the console output
   - Detailed error messages usually indicate the root cause
   - Add the `--verbose` flag for more log output

If the problem persists, please file an issue on the project repository and include:

- Operating system version
- Node.js version
- Installation command used
- Error messages
- Steps already tried
