<script setup lang="ts">
import { ref } from 'vue';
import { LINKS, NATIVE_HOST } from '@/common/constants';

import '@/shared/agent-theme/agent-chat.css';

const COMMANDS = {
  localRegister: 'node app/native-server/dist/cli.js register',
  npmInstall: 'npm install -g ./app/native-server',
  pnpmInstall: 'pnpm add -g ./app/native-server',
  yarnInstall: 'yarn global add ./app/native-server',
  mcpUrl: 'http://127.0.0.1:' + NATIVE_HOST.DEFAULT_PORT + '/mcp',
  doctor: 'node app/native-server/dist/cli.js doctor',
  fix: 'node app/native-server/dist/cli.js doctor --fix',
  workatoUrl: 'https://app.workato.com',
  claudeMcpConfig: `{
  "mcpServers": {
    "workato": {
      "transport": "http",
      "url": "http://127.0.0.1:${NATIVE_HOST.DEFAULT_PORT}/mcp"
    }
  }
}`,
  pluginMarketplaceAdd: '/plugin marketplace add Eithery-rc/WorkatoMCP',
  pluginInstall: '/plugin install workato-recipes@workato-mcp',
} as const;

type CommandKey = keyof typeof COMMANDS;

const copiedKey = ref<CommandKey | null>(null);

const ALT_INSTALL = [
  { label: 'npm (Global)', key: 'npmInstall' },
  { label: 'pnpm (Global)', key: 'pnpmInstall' },
  { label: 'yarn (Global)', key: 'yarnInstall' },
] as const satisfies ReadonlyArray<{ label: string; key: CommandKey }>;

const DIAGNOSTICS = [
  { label: 'Doctor', key: 'doctor' },
  { label: 'Auto-fix', key: 'fix' },
] as const satisfies ReadonlyArray<{ label: string; key: CommandKey }>;

function copyLabel(key: CommandKey): string {
  return copiedKey.value === key ? 'Copied' : 'Copy';
}

function copyColor(key: CommandKey): string {
  return copiedKey.value === key ? 'var(--ac-success)' : 'var(--ac-text-muted)';
}

async function copyCommand(key: CommandKey): Promise<void> {
  try {
    await navigator.clipboard.writeText(COMMANDS[key]);
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    copiedKey.value = null;
  }
}

async function openWorkato(): Promise<void> {
  try {
    await chrome.tabs.create({ url: COMMANDS.workatoUrl });
  } catch {
    window.open(COMMANDS.workatoUrl, '_blank', 'noopener,noreferrer');
  }
}

async function openDocs(): Promise<void> {
  try {
    await chrome.tabs.create({ url: LINKS.TROUBLESHOOTING });
  } catch {
    window.open(LINKS.TROUBLESHOOTING, '_blank', 'noopener,noreferrer');
  }
}
</script>

<template>
  <div class="agent-theme welcome-root">
    <div class="min-h-screen flex flex-col">
      <header class="welcome-header flex-none px-6 py-5">
        <div class="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <img
              src="/icon/48.png"
              alt="WorkatoMCP"
              class="welcome-icon-img w-10 h-10 flex-shrink-0"
            />
            <div class="min-w-0">
              <h1 class="welcome-title text-lg font-medium tracking-tight truncate">WorkatoMCP</h1>
              <p class="welcome-muted text-sm truncate">
                Expose your Workato session to AI agents via MCP.
              </p>
            </div>
          </div>

          <button
            class="welcome-button px-3 py-2 text-xs font-medium ac-btn flex-shrink-0"
            @click="openDocs"
          >
            Smoke-test docs
          </button>
        </div>
      </header>

      <main class="flex-1 px-6 py-8">
        <div class="max-w-3xl mx-auto space-y-6">
          <!-- STEP 1: Workato login -->
          <section class="welcome-card welcome-card--primary p-6">
            <div class="flex items-center gap-2">
              <span class="welcome-step-num">1</span>
              <h2 class="welcome-title text-xl font-medium">Sign in to Workato</h2>
            </div>
            <p class="welcome-muted text-sm mt-2">
              WorkatoMCP runs every API call as <em>you</em>, piggybacking on your existing browser
              session. No API tokens, no service accounts — just your normal Workato login. Make
              sure at least one tab is signed in before agents call any
              <code class="welcome-code">workato_*</code>
              tool.
            </p>
            <div class="mt-4">
              <button
                class="welcome-button welcome-primary-btn px-4 py-2 text-sm font-medium ac-btn"
                @click="openWorkato"
              >
                Open app.workato.com →
              </button>
            </div>
          </section>

          <!-- STEP 2: Install bridge -->
          <section class="welcome-card p-6">
            <div class="flex items-center gap-2">
              <span class="welcome-step-num">2</span>
              <h2 class="welcome-title text-xl font-medium">
                Register <code class="welcome-code">workatomcp-bridge</code>
              </h2>
            </div>
            <p class="welcome-muted text-sm mt-2">
              The local Node.js bridge connects this extension to your MCP client over a Chrome
              Native Messaging channel. Register it directly from your cloned repository, or
              optionally install it globally from the local folder.
            </p>

            <div class="mt-4 space-y-3">
              <div class="welcome-command-row flex items-center justify-between gap-3 px-4 py-3">
                <div class="min-w-0">
                  <div
                    class="welcome-mono welcome-subtle text-[10px] uppercase tracking-widest font-medium"
                  >
                    Register Local Host (Recommended)
                  </div>
                  <code class="welcome-code text-sm break-all">{{ COMMANDS.localRegister }}</code>
                </div>
                <button
                  class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                  :style="{ color: copyColor('localRegister') }"
                  @click="copyCommand('localRegister')"
                >
                  {{ copyLabel('localRegister') }}
                </button>
              </div>

              <div class="grid sm:grid-cols-3 gap-3">
                <div
                  v-for="item in ALT_INSTALL"
                  :key="item.key"
                  class="welcome-alt-row flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div class="min-w-0">
                    <div
                      class="welcome-mono welcome-subtle text-[10px] uppercase tracking-widest font-medium"
                    >
                      {{ item.label }}
                    </div>
                    <code class="welcome-code text-xs break-all">{{ COMMANDS[item.key] }}</code>
                  </div>
                  <button
                    class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                    :style="{ color: copyColor(item.key) }"
                    @click="copyCommand(item.key)"
                  >
                    {{ copyLabel(item.key) }}
                  </button>
                </div>
              </div>

              <div class="welcome-alt-row welcome-muted px-4 py-3 text-xs">
                Requires Node.js 20+. Check with
                <code class="welcome-code welcome-code-inline px-1 py-0.5">node -v</code>. The
                package registers a Chrome Native Messaging host manifest automatically.
              </div>
            </div>
          </section>

          <!-- STEP 3: Register MCP server -->
          <section class="welcome-card p-6">
            <div class="flex items-center gap-2">
              <span class="welcome-step-num">3</span>
              <h2 class="welcome-title text-xl font-medium">Register with your MCP client</h2>
            </div>
            <p class="welcome-muted text-sm mt-2">
              Add this to your MCP client config (Claude Code:
              <code class="welcome-code">~/.claude.json</code>; Claude Desktop:
              <code class="welcome-code">claude_desktop_config.json</code>):
            </p>

            <div class="mt-3">
              <div class="welcome-command-row flex items-start justify-between gap-3 px-4 py-3">
                <pre class="welcome-code text-xs flex-1 overflow-x-auto" style="white-space: pre">{{
                  COMMANDS.claudeMcpConfig
                }}</pre>
                <button
                  class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                  :style="{ color: copyColor('claudeMcpConfig') }"
                  @click="copyCommand('claudeMcpConfig')"
                >
                  {{ copyLabel('claudeMcpConfig') }}
                </button>
              </div>

              <p class="welcome-subtle text-xs mt-3">
                The bridge auto-launches on first MCP request and listens at
                <code class="welcome-code welcome-code-inline px-1 py-0.5">{{
                  COMMANDS.mcpUrl
                }}</code>
                via streamable HTTP.
              </p>
            </div>
          </section>

          <!-- STEP 4: Install agent skill -->
          <section class="welcome-card p-6">
            <div class="flex items-center gap-2">
              <span class="welcome-step-num">4</span>
              <h2 class="welcome-title text-xl font-medium">
                Install the <code class="welcome-code">workato-recipes</code> skill
                <span class="welcome-subtle text-xs ml-2">(optional but recommended)</span>
              </h2>
            </div>
            <p class="welcome-muted text-sm mt-2">
              An index + 7-file reference covering recipe code-tree JSON, control flow,
              Variables-by-Workato, and the full Ruby-allowlist formula API. When installed, Claude
              Code auto-loads it whenever you ask it to build, edit, or review a Workato recipe. Two
              slash commands in your Claude Code session:
            </p>

            <div class="mt-4 space-y-2">
              <div class="welcome-command-row flex items-center justify-between gap-3 px-4 py-3">
                <code class="welcome-code text-sm break-all">{{
                  COMMANDS.pluginMarketplaceAdd
                }}</code>
                <button
                  class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                  :style="{ color: copyColor('pluginMarketplaceAdd') }"
                  @click="copyCommand('pluginMarketplaceAdd')"
                >
                  {{ copyLabel('pluginMarketplaceAdd') }}
                </button>
              </div>
              <div class="welcome-command-row flex items-center justify-between gap-3 px-4 py-3">
                <code class="welcome-code text-sm break-all">{{ COMMANDS.pluginInstall }}</code>
                <button
                  class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                  :style="{ color: copyColor('pluginInstall') }"
                  @click="copyCommand('pluginInstall')"
                >
                  {{ copyLabel('pluginInstall') }}
                </button>
              </div>

              <div class="welcome-alt-row welcome-muted px-4 py-3 text-xs">
                Other agents (Codex, Cursor, Cline): copy
                <code class="welcome-code welcome-code-inline px-1 py-0.5"
                  >skills/workato-recipes/</code
                >
                from
                <a
                  href="https://github.com/Eithery-rc/WorkatoMCP"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="welcome-code"
                  >github.com/Eithery-rc/WorkatoMCP</a
                >
                into whatever skill/rules directory your agent loads from.
              </div>
            </div>
          </section>

          <!-- WHAT YOU GET -->
          <section class="welcome-card p-6">
            <h2 class="welcome-title text-lg font-medium">What your agents can do</h2>
            <p class="welcome-muted text-sm mt-2">
              Once installed, agents have access to <strong>8 Workato tools</strong> and
              <strong>28 Chrome browser tools</strong> through your authenticated session.
            </p>
            <ul class="welcome-muted text-sm mt-3 space-y-1.5 list-disc list-inside">
              <li>
                <code class="welcome-code">workato_pull_recipe</code> /
                <code class="welcome-code">workato_job_trace</code> — inspect recipes &amp; debug
                failed runs
              </li>
              <li>
                <code class="welcome-code">workato_search_recipes</code> /
                <code class="welcome-code">workato_search_connections</code> /
                <code class="welcome-code">workato_list_jobs</code> — discovery
              </li>
              <li>
                <code class="welcome-code">workato_get_connection</code> — connection metadata
                (secrets always stripped)
              </li>
              <li>
                <code class="welcome-code">workato_run_query</code> — SOQL / SuiteQL / SQL through
                any connection
              </li>
              <li>
                <code class="welcome-code">workato_call_action</code> — universal connector action
                runner (writes gated by <code class="welcome-code">allow_writes</code>)
              </li>
              <li>
                <code class="welcome-code">chrome_*</code> tools — navigate, screenshot, click,
                fill, capture network, inspect DOM
              </li>
            </ul>
          </section>

          <!-- TROUBLESHOOTING -->
          <details class="welcome-card overflow-hidden">
            <summary
              class="px-6 py-4 cursor-pointer select-none flex items-center justify-between gap-4"
            >
              <div class="min-w-0">
                <div class="welcome-title text-sm font-medium">Troubleshooting</div>
                <div class="welcome-muted text-xs truncate">
                  Use these only if the bridge fails to register or the MCP client can't connect.
                </div>
              </div>
              <span class="welcome-mono welcome-subtle text-xs flex-shrink-0">doctor</span>
            </summary>

            <div class="px-6 pb-6 space-y-4">
              <div class="welcome-alt-row p-4">
                <div class="text-sm font-medium">Diagnostics</div>
                <p class="welcome-muted text-sm mt-1">
                  <code class="welcome-code">doctor</code> checks installation, native-messaging
                  registration, port availability, and Node binary path. If anything fails, run
                  <code class="welcome-code">--fix</code>.
                </p>

                <div class="mt-3 space-y-2">
                  <div
                    v-for="item in DIAGNOSTICS"
                    :key="item.key"
                    class="welcome-command-row flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div class="min-w-0">
                      <div
                        class="welcome-mono welcome-subtle text-[10px] uppercase tracking-widest font-medium"
                      >
                        {{ item.label }}
                      </div>
                      <code class="welcome-code text-xs break-all">{{ COMMANDS[item.key] }}</code>
                    </div>
                    <button
                      class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                      :style="{ color: copyColor(item.key) }"
                      @click="copyCommand(item.key)"
                    >
                      {{ copyLabel(item.key) }}
                    </button>
                  </div>
                </div>

                <p class="welcome-subtle text-xs mt-3">
                  Legacy aliases <code class="welcome-code">mcp-chrome-bridge</code> /
                  <code class="welcome-code">chrome-mcp-bridge</code> still work for existing
                  configs.
                </p>
              </div>

              <div class="flex">
                <button
                  class="welcome-button px-3 py-2 text-xs font-medium ac-btn"
                  @click="openDocs"
                >
                  Smoke-test guide on GitHub →
                </button>
              </div>
            </div>
          </details>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.welcome-root {
  min-height: 100%;
  background: var(--ac-bg);
  background-image: var(--ac-bg-pattern);
  background-size: var(--ac-bg-pattern-size);
  color: var(--ac-text);
  font-family: var(--ac-font-body);
}

.welcome-header {
  background: var(--ac-header-bg);
  border-bottom: var(--ac-border-width) solid var(--ac-header-border);
  backdrop-filter: blur(8px);
}

.welcome-icon-img {
  border-radius: var(--ac-radius-card);
  box-shadow: var(--ac-shadow-card);
}

.welcome-card {
  background: var(--ac-surface);
  border: var(--ac-border-width) solid var(--ac-border);
  border-radius: var(--ac-radius-card);
  box-shadow: var(--ac-shadow-card);
}

.welcome-card--primary {
  box-shadow: var(--ac-shadow-float);
}

.welcome-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 999px;
  background: var(--ac-accent);
  color: var(--ac-bg);
  font-family: var(--ac-font-mono);
  font-size: 0.875rem;
  font-weight: 600;
}

.welcome-title {
  font-family: var(--ac-font-heading);
  color: var(--ac-text);
}

.welcome-muted {
  color: var(--ac-text-muted);
}

.welcome-subtle {
  color: var(--ac-text-subtle);
}

.welcome-mono {
  font-family: var(--ac-font-mono);
}

.welcome-code {
  font-family: var(--ac-font-code);
}

.welcome-button {
  font-family: var(--ac-font-mono);
  color: var(--ac-text-muted);
  background: var(--ac-surface);
  border: var(--ac-border-width) solid var(--ac-border);
  border-radius: var(--ac-radius-button);
  cursor: pointer;
  transition: all 0.2s ease;
}

.welcome-button:hover {
  background: var(--ac-hover-bg-subtle);
}

.welcome-primary-btn {
  color: var(--ac-bg);
  background: var(--ac-accent);
  border-color: var(--ac-accent);
}

.welcome-primary-btn:hover {
  opacity: 0.9;
  background: var(--ac-accent);
}

.welcome-command-row {
  background: var(--ac-code-bg);
  border: var(--ac-border-width) solid var(--ac-code-border);
  border-radius: var(--ac-radius-inner);
}

.welcome-alt-row {
  background: var(--ac-surface-muted);
  border: var(--ac-border-width) solid var(--ac-border);
  border-radius: var(--ac-radius-inner);
}

.welcome-code-inline {
  background: var(--ac-hover-bg-subtle);
  border: var(--ac-border-width) solid var(--ac-border);
  border-radius: 6px;
}

.ac-btn {
  cursor: pointer;
  transition: all 0.2s ease;
}

.ac-btn:hover {
  opacity: 0.8;
}

summary {
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}
</style>
