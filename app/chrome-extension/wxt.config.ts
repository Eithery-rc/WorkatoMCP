import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { config } from 'dotenv';
import { resolve } from 'path';
import Icons from 'unplugin-icons/vite';
import Components from 'unplugin-vue-components/vite';
import IconsResolver from 'unplugin-icons/resolver';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

// Public RSA key (NOT a secret — Chrome publishes the `key` field in every installed
// manifest). Pinning it makes the unpacked-extension ID deterministic across machines,
// so everyone who builds this repo gets the same extension ID and the bridge's
// native-messaging `allowed_origins` whitelist works out of the box.
// Derived ID: bpjpdgkeelhkijkllcmogemkmndgeana
const DEFAULT_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6GcfzFpYKGf9KZNpdXCWXSK3JpsXE5kBnT0tGRrkXYYclQA3iIHbQtu6e7L8Hh8uDelB6+T64IIKU4lxMsruChCTshgdS51F6OT3+KNDGijeliZifV5nV6JR0h2X9qyMlvC+N727FziYjqbEIn+8o9skR8wP/1qsZbknB6nz2nZxhMtyqMOmI+fFw9dIsTcxEpz/0U15oMAeV8MpKgUHELij/obv90kC80E+5o1W+SMqzno5Aa5msBdq/57mQoTwmVyQ/fiRTHltAfC/NtN7uWtIz1HD8Ra52sjJN2JR19eAyZPg7bnfi1SfifnpVNylgTT53D0ANtcxpJlsjqyIYwIDAQAB';
const CHROME_EXTENSION_KEY = process.env.CHROME_EXTENSION_KEY ?? DEFAULT_EXTENSION_KEY;
// Detect dev mode early for manifest-level switches
const IS_DEV = process.env.NODE_ENV !== 'production' && process.env.MODE !== 'production';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  runner: {
    disabled: true,

    // chromiumArgs: [
    //   '--user-data-dir=' + homedir() + (process.platform === 'darwin'
    //     ? '/Library/Application Support/Google/Chrome'
    //     : process.platform === 'win32'
    //     ? '/AppData/Local/Google/Chrome/User Data'
    //     : '/.config/google-chrome'),
    //   '--remote-debugging-port=9222',
    // ],
  },
  manifest: {
    // Use environment variable for the key, fallback to undefined if not set
    key: CHROME_EXTENSION_KEY,
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    permissions: [
      'nativeMessaging',
      'tabs',
      'activeTab',
      'scripting',
      'contextMenus',
      'downloads',
      'webRequest',
      'webNavigation',
      'debugger',
      'history',
      'bookmarks',
      'offscreen',
      'storage',
      'declarativeNetRequest',
      'alarms',
    ],
    host_permissions: ['<all_urls>'],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'WorkatoMCP',
    },
    web_accessible_resources: [
      {
        resources: ['/inject-scripts/*'],
        matches: ['<all_urls>'],
      },
    ],
    // CSP is production-only: dev server assets are blocked by strict CSP in dev mode.
    ...(IS_DEV
      ? {}
      : {
          cross_origin_embedder_policy: { value: 'require-corp' as const },
          cross_origin_opener_policy: { value: 'same-origin' as const },
          content_security_policy: {
            // Allow inline styles injected by Vite (compiled CSS) and data images used in UI thumbnails
            extension_pages:
              "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;",
          },
        }),
  },
  vite: (env) => ({
    plugins: [
      // TailwindCSS v4 Vite plugin – no PostCSS config required
      tailwindcss(),
      // Auto-register SVG icons as Vue components; all icons are bundled locally
      Components({
        dts: false,
        resolvers: [IconsResolver({ prefix: 'i', enabledCollections: ['lucide', 'mdi', 'ri'] })],
      }) as any,
      Icons({ compiler: 'vue3', autoInstall: false }) as any,
      // Ensure static assets are available as early as possible to avoid race conditions in dev
      // Copy workers/_locales/inject-scripts into the build output before other steps
      viteStaticCopy({
        targets: [
          {
            src: 'inject-scripts/*.js',
            dest: 'inject-scripts',
          },
          {
            src: '_locales/**/*',
            dest: '_locales',
          },
        ],
        // Use writeBundle so outDir exists for dev and prod
        hook: 'writeBundle',
        // Enable watch so changes to these files are reflected during dev
        watch: {
          // Use default patterns inferred from targets; explicit true enables watching
          // Vite plugin will watch src patterns and re-copy on change
        } as any,
      }) as any,
    ],
    build: {
      target: 'es2015',
      sourcemap: env.mode !== 'production',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500,
      minify: false,
    },
  }),
});
