<script setup lang="ts">
import { ref } from 'vue';
import { LINKS, NATIVE_HOST } from '@/common/constants';

import '@/entrypoints/styles/theme.css';

const MCP_URL = 'http://127.0.0.1:' + NATIVE_HOST.DEFAULT_PORT + '/mcp';

const COMMANDS = {
  npmInstall: 'npm install -g @mokuhub/mokutab-bridge',
  pnpmInstall: 'pnpm add -g @mokuhub/mokutab-bridge',
  yarnInstall: 'yarn global add @mokuhub/mokutab-bridge',
  mcpUrl: MCP_URL,
  claudeCodeAdd: `claude mcp add --transport http -s user mokutab ${MCP_URL}`,
  doctor: 'mokutab-bridge doctor',
  fix: 'mokutab-bridge doctor --fix',
  workatoUrl: 'https://app.workato.com',
  claudeMcpConfig: `{
  "mcpServers": {
    "mokutab": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${MCP_URL}",
        "--allow-http"
      ]
    }
  }
}`,
  pluginMarketplaceAdd: '/plugin marketplace add MokuTeam/MokuTab',
  pluginInstall: '/plugin install workato-recipes@workato-mcp',
} as const;

type CommandKey = keyof typeof COMMANDS;

const UPGRADE_URL = `${LINKS.REPO}#upgrade-from-workatomcp-1x`;

const copiedKey = ref<CommandKey | null>(null);

const ALT_INSTALL = [
  { label: 'pnpm', key: 'pnpmInstall' },
  { label: 'yarn', key: 'yarnInstall' },
] as const satisfies ReadonlyArray<{ label: string; key: CommandKey }>;

const DIAGNOSTICS = [
  { label: 'Doctor', key: 'doctor' },
  { label: 'Auto-fix', key: 'fix' },
] as const satisfies ReadonlyArray<{ label: string; key: CommandKey }>;

const CORE_TOOLS = [
  {
    tools: ['chrome_snapshot', 'chrome_snapshot_click', 'chrome_snapshot_fill'],
    text: 'read a page and act on it, element by element',
  },
  {
    tools: ['chrome_lease_tab'],
    text: 'a tab of its own for each agent, so several can work at once',
  },
  {
    tools: ['chrome_fn_run', 'chrome_fn_save'],
    text: 'saved browser flows, versioned and run by name',
  },
  {
    tools: ['chrome_watch_start'],
    text: 'wait for a page to change without spending tokens',
  },
  {
    tools: ['chrome_fetch_to_file', 'chrome_screenshot', 'chrome_network_capture'],
    text: 'downloads, captures and network traffic',
  },
] as const;

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

async function openUrl(url: string): Promise<void> {
  try {
    await chrome.tabs.create({ url });
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function openWorkato(): Promise<void> {
  return openUrl(COMMANDS.workatoUrl);
}

function openDocs(): Promise<void> {
  return openUrl(LINKS.TROUBLESHOOTING);
}

function openUpgrade(): Promise<void> {
  return openUrl(UPGRADE_URL);
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
              alt="MokuTab"
              class="welcome-icon-img w-10 h-10 flex-shrink-0"
            />
            <div class="min-w-0">
              <h1 class="welcome-title text-lg font-medium tracking-tight truncate">MokuTab</h1>
              <p class="welcome-muted text-sm truncate">
                Browser tools for AI agents, in the Chrome you already use.
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
          <!-- STEP 1: Install bridge -->
          <section class="welcome-card welcome-card--primary p-6">
            <div class="flex items-center gap-2">
              <span class="welcome-step-num">1</span>
              <h2 class="welcome-title text-xl font-medium">
                Install <code class="welcome-code">@mokuhub/mokutab-bridge</code>
              </h2>
            </div>
            <p class="welcome-muted text-sm mt-2">
              The local bridge connects this extension to your MCP client. Chrome starts it on the
              first tool call; there is nothing to run by hand.
            </p>

            <div class="mt-4 space-y-3">
              <div class="welcome-command-row flex items-center justify-between gap-3 px-4 py-3">
                <code class="welcome-code text-sm break-all">{{ COMMANDS.npmInstall }}</code>
                <button
                  class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                  :style="{ color: copyColor('npmInstall') }"
                  @click="copyCommand('npmInstall')"
                >
                  {{ copyLabel('npmInstall') }}
                </button>
              </div>

              <div class="grid sm:grid-cols-2 gap-3">
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
                Requires Node.js 20+. Its
                <code class="welcome-code welcome-code-inline px-1 py-0.5">postinstall</code>
                registers the Chrome Native Messaging host. Coming from WorkatoMCP 1.x? Remove the
                old package first:
                <button class="welcome-link ac-btn" @click="openUpgrade">upgrade steps</button>.
              </div>
            </div>
          </section>

          <!-- STEP 2: Register MCP server -->
          <section class="welcome-card p-6">
            <div class="flex items-center gap-2">
              <span class="welcome-step-num">2</span>
              <h2 class="welcome-title text-xl font-medium">Register it with your MCP client</h2>
            </div>
            <p class="welcome-muted text-sm mt-2">Claude Code, under the key mokutab:</p>

            <div class="mt-3 space-y-3">
              <div class="welcome-command-row flex items-center justify-between gap-3 px-4 py-3">
                <code class="welcome-code text-sm break-all">{{ COMMANDS.claudeCodeAdd }}</code>
                <button
                  class="welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0"
                  :style="{ color: copyColor('claudeCodeAdd') }"
                  @click="copyCommand('claudeCodeAdd')"
                >
                  {{ copyLabel('claudeCodeAdd') }}
                </button>
              </div>

              <p class="welcome-muted text-sm">
                Claude Desktop and other clients that launch a
                <code class="welcome-code">command</code>:
              </p>
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

              <p class="welcome-subtle text-xs">
                The bridge listens at
                <code class="welcome-code welcome-code-inline px-1 py-0.5">{{
                  COMMANDS.mcpUrl
                }}</code>
                (streamable HTTP). Restart the client after changing its config.
              </p>
            </div>
          </section>

          <!-- WHAT YOU GET: core -->
          <section class="welcome-card p-6">
            <h2 class="welcome-title text-lg font-medium">What your agents can do</h2>
            <p class="welcome-muted text-sm mt-2">
              <strong>52 core tools</strong> that act in your own tabs, profiles and signed-in
              sessions. No API tokens.
            </p>
            <ul class="welcome-muted text-sm mt-3 space-y-1.5 list-disc list-inside">
              <li v-for="item in CORE_TOOLS" :key="item.tools[0]">
                <code class="welcome-code">{{ item.tools.join(' / ') }}</code
                >: {{ item.text }}
              </li>
            </ul>
          </section>

          <!-- MODULES -->
          <section class="welcome-card p-6">
            <h2 class="welcome-title text-lg font-medium">Modules</h2>
            <p class="welcome-muted text-sm mt-2">
              A module adds the tools for one product. Turn it on under
              <strong>Modules</strong> in the extension popup; the switch applies to every Chrome
              profile on this machine.
            </p>

            <div class="welcome-alt-row p-4 mt-4">
              <div class="text-sm font-medium">Workato</div>
              <p class="welcome-muted text-sm mt-1">
                97 tools for recipes, jobs, connections, tables and Workflow App pages, run as you
                inside a signed-in Workato tab. Off on a fresh install.
              </p>
              <div class="mt-3">
                <button
                  class="welcome-button welcome-primary-btn px-4 py-2 text-sm font-medium ac-btn"
                  @click="openWorkato"
                >
                  Open app.workato.com →
                </button>
              </div>

              <p class="welcome-muted text-sm mt-4">
                Optional: the <code class="welcome-code">workato-recipes</code> skill, a reference
                for recipe JSON and the formula language, from two slash commands in Claude Code:
              </p>
              <div class="mt-2 space-y-2">
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
              </div>
              <p class="welcome-subtle text-xs mt-2">
                Other agents: copy
                <code class="welcome-code">skills/workato-recipes/</code>
                from
                <a :href="LINKS.REPO" target="_blank" rel="noopener noreferrer" class="welcome-code"
                  >github.com/MokuTeam/MokuTab</a
                >
                into their skill or rules directory.
              </p>
            </div>
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
                  registration, port availability, the Node binary path and what a 1.x install left
                  behind. If anything fails, run <code class="welcome-code">--fix</code>.
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
                  The 1.x command names still work until 3.0.
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

.welcome-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ac-accent);
  font: inherit;
  text-decoration: underline;
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
