# workatomcp-bridge

The local bridge half of [WorkatoMCP](../../README.md), published to npm as [`workatomcp-bridge`](https://www.npmjs.com/package/workatomcp-bridge).

A Fastify server on `127.0.0.1:12306` that terminates MCP transports and forwards tool calls to the Chrome extension over native messaging. Chrome launches it on demand — there is nothing to start by hand.

## Install

```bash
npm install -g workatomcp-bridge
```

Postinstall attempts user-level native-messaging registration for detected browsers.

## CLI

```bash
workatomcp-bridge doctor              # diagnose registration, ports, permissions
workatomcp-bridge doctor --fix        # repair what it can
workatomcp-bridge register --detect   # (re)register for detected browsers
workatomcp-bridge register --system   # system-level install (needs admin/sudo)
workatomcp-bridge fix-permissions     # repair wrapper-script permissions
workatomcp-bridge update-port 12307   # move off a conflicting port
workatomcp-bridge report --copy       # redacted diagnostic report for bug reports
```

## Endpoints

| Route                         | Purpose                                   |
| ----------------------------- | ----------------------------------------- |
| `POST/GET/DELETE /mcp`        | Streamable HTTP transport                 |
| `GET /sse` + `POST /messages` | Legacy SSE transport                      |
| `GET /ws-client`              | Per-Chrome-profile WebSocket registration |
| `GET /ping`                   | Liveness check                            |

`workatomcp-stdio` is also installed, for MCP clients that require a spawned stdio process.

## Development

```bash
pnpm --filter workatomcp-bridge build
pnpm --filter workatomcp-bridge test
pnpm --filter workatomcp-bridge dev     # rebuild + re-register on change
```

## Layout

```text
src/
├── server/
│   ├── index.ts             # Fastify routes and MCP transports
│   └── profile-registry.ts  # per-profile WebSocket connections
├── native-messaging-host.ts # stdio framing to/from Chrome
├── file-handler.ts          # local file read/write for the recipe & CSV round-trips
├── mcp/                     # MCP server and stdio entrypoint
├── cli.ts                   # doctor / register / report commands
└── scripts/                 # build, postinstall, registration
```

`src/scripts/run_host.sh` must ship with LF line endings or the host fails to execute on macOS and Linux; `.gitattributes` enforces this.

Architecture details: [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
