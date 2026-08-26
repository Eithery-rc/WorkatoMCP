/**
 * Shared MCP Tool Schemas.
 *
 * Author: Roman Chikalenko
 * Version: 1.4.0
 */
import { type Tool } from '@modelcontextprotocol/sdk/types.js';

export const TOOL_NAMES = {
  BROWSER: {
    GET_WINDOWS_AND_TABS: 'get_windows_and_tabs',
    NAVIGATE: 'chrome_navigate',
    SCREENSHOT: 'chrome_screenshot',
    CLOSE_TABS: 'chrome_close_tabs',
    SWITCH_TAB: 'chrome_switch_tab',
    WEB_FETCHER: 'chrome_get_web_content',
    CLICK: 'chrome_click_element',
    FILL: 'chrome_fill_or_select',
    REQUEST_ELEMENT_SELECTION: 'chrome_request_element_selection',
    GET_INTERACTIVE_ELEMENTS: 'chrome_get_interactive_elements',
    NETWORK_CAPTURE: 'chrome_network_capture',
    // Legacy tool names (kept for internal use, not exposed in TOOL_SCHEMAS)
    NETWORK_CAPTURE_START: 'chrome_network_capture_start',
    NETWORK_CAPTURE_STOP: 'chrome_network_capture_stop',
    NETWORK_REQUEST: 'chrome_network_request',
    NETWORK_DEBUGGER_START: 'chrome_network_debugger_start',
    NETWORK_DEBUGGER_STOP: 'chrome_network_debugger_stop',
    KEYBOARD: 'chrome_keyboard',
    HISTORY: 'chrome_history',
    BOOKMARK_SEARCH: 'chrome_bookmark_search',
    BOOKMARK_ADD: 'chrome_bookmark_add',
    BOOKMARK_DELETE: 'chrome_bookmark_delete',
    INJECT_SCRIPT: 'chrome_inject_script',
    SEND_COMMAND_TO_INJECT_SCRIPT: 'chrome_send_command_to_inject_script',
    JAVASCRIPT: 'chrome_javascript',
    CONSOLE: 'chrome_console',
    FILE_UPLOAD: 'chrome_upload_file',
    READ_PAGE: 'chrome_read_page',
    COMPUTER: 'chrome_computer',
    HANDLE_DIALOG: 'chrome_handle_dialog',
    HANDLE_DOWNLOAD: 'chrome_handle_download',
    USERSCRIPT: 'chrome_userscript',
    PERFORMANCE_START_TRACE: 'performance_start_trace',
    PERFORMANCE_STOP_TRACE: 'performance_stop_trace',
    PERFORMANCE_ANALYZE_INSIGHT: 'performance_analyze_insight',
    GIF_RECORDER: 'chrome_gif_recorder',
    SNAPSHOT: 'chrome_snapshot',
    SNAPSHOT_CLICK: 'chrome_snapshot_click',
    SNAPSHOT_FILL: 'chrome_snapshot_fill',
    SNAPSHOT_HOVER: 'chrome_snapshot_hover',
    SNAPSHOT_WAIT_FOR: 'chrome_snapshot_wait_for',
  },
  RECORD_REPLAY: {
    FLOW_RUN: 'record_replay_flow_run',
    LIST_PUBLISHED: 'record_replay_list_published',
  },
  WORKATO: {
    PULL_RECIPE: 'workato_pull_recipe',
    RENAME_RECIPE: 'workato_rename_recipe',
    SET_VERSION_COMMENT: 'workato_set_version_comment',
    START_RECIPE: 'workato_start_recipe',
    STOP_RECIPE: 'workato_stop_recipe',
    RECIPE_STATUS: 'workato_recipe_status',
    VERSION_DIFF: 'workato_recipe_version_diff',
    JOB_TRACE: 'workato_job_trace',
    REPEAT_JOB: 'workato_repeat_job',
    SEARCH_RECIPES: 'workato_search_recipes',
    SEARCH_CONNECTIONS: 'workato_search_connections',
    GET_CONNECTION: 'workato_get_connection',
    LIST_JOBS: 'workato_list_jobs',
    RUN_QUERY: 'workato_run_query',
    CALL_ACTION: 'workato_call_action',
    LIST_PROFILES: 'workato_list_profiles',
    SWITCH_PROFILE: 'workato_switch_profile',
    LIST_FOLDERS: 'workato_list_folders',
    CREATE_FOLDER: 'workato_create_folder',
    UPDATE_FOLDER: 'workato_update_folder',
    DELETE_FOLDER: 'workato_delete_folder',
    MOVE_RECIPE: 'workato_move_recipe',
    COPY_RECIPE: 'workato_copy_recipe',
    DELETE_RECIPE: 'workato_delete_recipe',
    CREATE_PROJECT: 'workato_create_project',
    UPDATE_PROJECT: 'workato_update_project',
    ADAPTER_META: 'workato_adapter_meta',
    APPS_LIST: 'workato_apps_list',
    PICK_LIST: 'workato_pick_list',
    RECIPE_STEP_SEARCH: 'workato_recipe_step_search',
    SAVE_WITH_DEPENDENTS: 'workato_recipe_save_with_dependents',
    CALLABLE_SCHEMA_SET: 'workato_callable_schema_set',
    CALLER_BIND: 'workato_caller_bind',
    DATAPILL: 'workato_datapill',
    API_REQUEST: 'workato_api_request',
  },
  WORKATO_UI: {
    OPEN_RECIPE: 'workato_ui_open_recipe',
    ENTER_EDIT_MODE: 'workato_ui_enter_edit_mode',
    LIST_STEPS: 'workato_ui_list_steps',
    FOCUS_STEP: 'workato_ui_focus_step',
    ADD_STEP: 'workato_ui_add_step',
    SET_FIELD: 'workato_ui_set_field',
    INSERT_DATAPILL: 'workato_ui_insert_datapill',
    SAVE_RECIPE: 'workato_ui_save_recipe',
    EXIT_EDIT_MODE: 'workato_ui_exit_edit_mode',
    CREATE_RECIPE: 'workato_ui_create_recipe',
    SAVE_RECIPE_CODE: 'workato_ui_save_recipe_code',
  },
  WORKATO_RECIPE: {
    ADD_STEP: 'workato_recipe_add_step',
    SET_STEP_INPUT: 'workato_recipe_set_step_input',
    MAP_DATAPILL: 'workato_recipe_map_datapill',
    SET_INPUT_PATH: 'workato_recipe_set_input_path',
    DELETE_INPUT_PATH: 'workato_recipe_delete_input_path',
    SET_PY_EVAL_CODE: 'workato_recipe_set_py_eval_code',
    SET_EXTENDED_SCHEMA: 'workato_recipe_set_extended_schema',
  },
  WORKATO_LCAP: {
    APPS_LIST: 'workato_lcap_apps_list',
    PAGE_GET: 'workato_lcap_page_get',
    PAGE_SAVE: 'workato_lcap_page_save',
    PAGE_VALIDATE: 'workato_lcap_page_validate',
    WIDGET_PATCH: 'workato_lcap_widget_patch',
    PAGE_CREATE: 'workato_lcap_page_create',
    PAGE_DELETE: 'workato_lcap_page_delete',
  },
  WORKATO_LOOKUP: {
    TABLES_LIST: 'workato_lookup_tables_list',
    TABLE_GET: 'workato_lookup_table_get',
    TABLE_CREATE: 'workato_lookup_table_create',
    TABLE_RENAME: 'workato_lookup_table_rename',
    TABLE_SET_COLUMNS: 'workato_lookup_table_set_columns',
    TABLE_DELETE: 'workato_lookup_table_delete',
    ROW_CREATE: 'workato_lookup_table_row_create',
    ROW_UPDATE: 'workato_lookup_table_row_update',
    ROW_DELETE: 'workato_lookup_table_row_delete',
    ROW_UPSERT: 'workato_lookup_table_row_upsert',
    ROW_SEARCH: 'workato_lookup_table_row_search',
    IMPORT_CSV: 'workato_lookup_table_import_csv',
  },
  WORKATO_DATA_TABLE: {
    TABLES_LIST: 'workato_data_tables_list',
    TABLE_GET: 'workato_data_table_get',
    TABLE_CREATE: 'workato_data_table_create',
    TABLE_RENAME: 'workato_data_table_rename',
    TABLE_DELETE: 'workato_data_table_delete',
    ADD_COLUMN: 'workato_data_table_add_column',
    UPDATE_COLUMN: 'workato_data_table_update_column',
    DELETE_COLUMN: 'workato_data_table_delete_column',
    ROW_LIST: 'workato_data_table_row_list',
    ROW_CREATE: 'workato_data_table_row_create',
    ROW_UPDATE: 'workato_data_table_row_update',
    ROW_DELETE: 'workato_data_table_row_delete',
  },
  WORKATO_SESSION: {
    WHOAMI: 'workato_whoami',
  },
};

export const TOOL_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
    description:
      'Get all currently open browser windows and tabs. Pass filter to return only tabs whose ' +
      'URL or title contains the substring (e.g. filter:"workato") — strongly preferred when ' +
      'looking for a specific app tab, so unrelated personal tabs never enter the context.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Case-insensitive substring matched against each tab URL and title. Windows with no matching tabs are dropped.',
        },
      },
      required: [],
    },
  },
  // {
  //   name: TOOL_NAMES.RECORD_REPLAY.FLOW_RUN,
  //   description:
  //     'Run a recorded flow by ID with optional variables and run options. Returns a standardized run result.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       flowId: { type: 'string', description: 'ID of the flow to run' },
  //       args: {
  //         type: 'object',
  //         description: 'Variable values for the flow (flat object of key/value)',
  //       },
  //       tabTarget: {
  //         type: 'string',
  //         description: "Target tab: 'current' or 'new' (default: current)",
  //         enum: ['current', 'new'],
  //       },
  //       refresh: { type: 'boolean', description: 'Refresh before running (default false)' },
  //       captureNetwork: {
  //         type: 'boolean',
  //         description: 'Capture network snippets for debugging (default false)',
  //       },
  //       returnLogs: { type: 'boolean', description: 'Return run logs (default false)' },
  //       timeoutMs: { type: 'number', description: 'Global timeout in ms (optional)' },
  //       startUrl: { type: 'string', description: 'Optional start URL to open before running' },
  //     },
  //     required: ['flowId'],
  //   },
  // },
  // {
  //   name: TOOL_NAMES.RECORD_REPLAY.LIST_PUBLISHED,
  //   description: 'List published flows available as dynamic tools (for discovery).',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {},
  //     required: [],
  //   },
  // },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE,
    description:
      'Starts a performance trace recording on the selected page. Optionally reloads the page and/or auto-stops after a short duration.',
    inputSchema: {
      type: 'object',
      properties: {
        reload: {
          type: 'boolean',
          description:
            'Determines if, once tracing has started, the page should be automatically reloaded (ignore cache).',
        },
        autoStop: {
          type: 'boolean',
          description: 'Determines if the trace should be automatically stopped (default false).',
        },
        durationMs: {
          type: 'number',
          description: 'Auto-stop duration in milliseconds when autoStop is true (default 5000).',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE,
    description: 'Stops the active performance trace recording on the selected page.',
    inputSchema: {
      type: 'object',
      properties: {
        saveToDownloads: {
          type: 'boolean',
          description: 'Whether to save the trace as a JSON file in Downloads (default true).',
        },
        filenamePrefix: {
          type: 'string',
          description: 'Optional filename prefix for the downloaded trace JSON.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT,
    description:
      'Provides a lightweight summary of the last recorded trace. For deep insights (CWV, breakdowns), integrate native-side DevTools trace engine.',
    inputSchema: {
      type: 'object',
      properties: {
        insightName: {
          type: 'string',
          description:
            'Optional insight name for future deep analysis (e.g., "DocumentLatency"). Currently informational only.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Timeout for deep analysis via native host (milliseconds). Default 60000. Increase for large traces.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.READ_PAGE,
    description:
      'Get an accessibility tree representation of visible elements on the page. Only returns elements that are visible in the viewport. Optionally filter for only interactive elements.\nTip: If the returned elements do not include the specific element you need, use the computer tool\'s screenshot (action="screenshot") to capture the element\'s on-screen coordinates, then operate by coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Filter elements: "interactive" for such as  buttons/links/inputs only (default: all visible elements)',
        },
        depth: {
          type: 'number',
          description:
            'Maximum DOM depth to traverse (integer >= 0). Lower values reduce output size and can improve performance.',
        },
        refId: {
          type: 'string',
          description:
            'Focus on the subtree rooted at this element refId (e.g., "ref_12"). The refId must come from a recent chrome_read_page response in the same tab (refs may expire).',
        },
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.COMPUTER,
    description:
      "Use a mouse and keyboard to interact with a web browser, and take screenshots.\n* Whenever you intend to click on an element like an icon, you should consult a read_page to determine the ref of the element before moving the cursor.\n* If you tried clicking on a program or link but it failed to load, even after waiting, try screenshot and then adjusting your click location so that the tip of the cursor visually falls on the element that you want to click.\n* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.",
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab ID (default: active tab)' },
        background: {
          type: 'boolean',
          description:
            'Avoid focusing/activating tab/window for certain operations (best-effort). Default: false',
        },
        action: {
          type: 'string',
          description:
            'Action to perform: left_click | right_click | double_click | triple_click | left_click_drag | scroll | scroll_to | type | key | fill | fill_form | hover | wait | resize_page | zoom | screenshot',
        },
        ref: {
          type: 'string',
          description:
            'Element ref from chrome_read_page. For click/scroll/scroll_to/key/type and drag end when provided; takes precedence over coordinates.',
        },
        coordinates: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
          },
          description:
            'Coordinates for actions (in screenshot space if a recent screenshot was taken, otherwise viewport). Required for click/scroll and as end point for drag.',
        },
        startCoordinates: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          description: 'Starting coordinates for drag action',
        },
        startRef: {
          type: 'string',
          description: 'Drag start ref from chrome_read_page (alternative to startCoordinates).',
        },
        scrollDirection: {
          type: 'string',
          description: 'Scroll direction: up | down | left | right',
        },
        scrollAmount: {
          type: 'number',
          description: 'Scroll ticks (1-10), default 3',
        },
        text: {
          type: 'string',
          description:
            'Text to type (for action=type) or keys/chords separated by space (for action=key, e.g. "Backspace Enter" or "cmd+a")',
        },
        repeat: {
          type: 'number',
          description:
            'For action=key: number of times to repeat the key sequence (integer 1-100, default 1).',
        },
        modifiers: {
          type: 'object',
          description:
            'Modifier keys for click actions (left_click/right_click/double_click/triple_click).',
          properties: {
            altKey: { type: 'boolean' },
            ctrlKey: { type: 'boolean' },
            metaKey: { type: 'boolean' },
            shiftKey: { type: 'boolean' },
          },
        },
        region: {
          type: 'object',
          description:
            'For action=zoom: rectangular region to capture (x0,y0)-(x1,y1) in viewport pixels (or screenshot-space if a recent screenshot context exists).',
          properties: {
            x0: { type: 'number' },
            y0: { type: 'number' },
            x1: { type: 'number' },
            y1: { type: 'number' },
          },
          required: ['x0', 'y0', 'x1', 'y1'],
        },
        // For action=fill
        selector: {
          type: 'string',
          description: 'CSS selector for fill (alternative to ref).',
        },
        value: {
          oneOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }],
          description: 'Value to set for action=fill (string | boolean | number)',
        },
        elements: {
          type: 'array',
          description: 'For action=fill_form: list of elements to fill (ref + value)',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Element ref from chrome_read_page' },
              value: { type: 'string', description: 'Value to set (stringified if non-string)' },
            },
            required: ['ref', 'value'],
          },
        },
        width: { type: 'number', description: 'For action=resize_page: viewport width' },
        height: { type: 'number', description: 'For action=resize_page: viewport height' },
        appear: {
          type: 'boolean',
          description:
            'For action=wait with text: whether to wait for the text to appear (true, default) or disappear (false)',
        },
        timeout: {
          type: 'number',
          description:
            'For action=wait with text: timeout in milliseconds (default 10000, max 120000)',
        },
        duration: {
          type: 'number',
          description: 'Seconds to wait for action=wait (max 30s)',
        },
      },
      required: ['action'],
    },
  },
  // {
  //   name: TOOL_NAMES.BROWSER.USERSCRIPT,
  //   description:
  //     'Unified userscript tool (create/list/get/enable/disable/update/remove/send_command/export). Paste JS/CSS/Tampermonkey script and the system will auto-select the best strategy (insertCSS / persistent script in ISOLATED or MAIN world / once by CDP) with CSP-aware fallbacks.',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       action: {
  //         type: 'string',
  //         description:
  //           'Operation to perform',
  //         enum: [
  //           'create',
  //           'list',
  //           'get',
  //           'enable',
  //           'disable',
  //           'update',
  //           'remove',
  //           'send_command',
  //           'export',
  //         ],
  //       },
  //       args: {
  //         type: 'object',
  //         description:
  //           'Arguments for the specified action.\n- create: { script (required), name?, description?, matches?: string[], excludes?: string[], persist?: boolean (default true), runAt?: "document_start"|"document_end"|"document_idle"|"auto", world?: "auto"|"ISOLATED"|"MAIN", allFrames?: boolean (default true), mode?: "auto"|"css"|"persistent"|"once", dnrFallback?: boolean (default true), tags?: string[] }\n- list: { query?: string, status?: "enabled"|"disabled", domain?: string }\n- get: { id (required) }\n- enable/disable: { id (required) }\n- update: { id (required), script?, name?, description?, matches?, excludes?, runAt?, world?, allFrames?, persist?, dnrFallback?, tags? }\n- remove: { id (required) }\n- send_command: { id (required), payload?: string, tabId?: number }\n- export: {}\nTip: For a one-off execution that returns a value, use create with args.mode="once". The returned value is included as onceResult in the tool response.',
  //         properties: {
  //           // Common identifiers
  //           id: { type: 'string', description: 'Userscript id (for get/enable/disable/update/remove/send_command)' },
  //           // Create / Update fields
  //           script: { type: 'string', description: 'JS/CSS/Tampermonkey script source (required for create)' },
  //           name: { type: 'string', description: 'Userscript name (optional)' },
  //           description: { type: 'string', description: 'Userscript description (optional)' },
  //           matches: {
  //             type: 'array',
  //             items: { type: 'string' },
  //             description: 'Match patterns for pages to apply to (e.g., https://*.example.com/*)'
  //           },
  //           excludes: {
  //             type: 'array',
  //             items: { type: 'string' },
  //             description: 'Exclude patterns'
  //           },
  //           persist: { type: 'boolean', description: 'Persist userscript for matched pages (default true)' },
  //           runAt: {
  //             type: 'string',
  //             description: 'Injection timing',
  //             enum: ['document_start', 'document_end', 'document_idle', 'auto'],
  //           },
  //           world: {
  //             type: 'string',
  //             description: 'Execution world',
  //             enum: ['auto', 'ISOLATED', 'MAIN'],
  //           },
  //           allFrames: { type: 'boolean', description: 'Inject into all frames (default true)' },
  //           mode: {
  //             type: 'string',
  //             description:
  //               'Injection strategy: auto | css | persistent | once. Use once to evaluate immediately (no persistence) and include the return value in onceResult.',
  //             enum: ['auto', 'css', 'persistent', 'once'],
  //           },
  //           dnrFallback: { type: 'boolean', description: 'Use DNR fallback when needed (default true)' },
  //           tags: { type: 'array', items: { type: 'string' }, description: 'Custom tags' },
  //           // List filters
  //           query: { type: 'string', description: 'Search by name/description (list action)' },
  //           status: { type: 'string', enum: ['enabled', 'disabled'], description: 'Filter by status (list action)' },
  //           domain: { type: 'string', description: 'Filter by domain (list action)' },
  //           // Send command
  //           payload: { type: 'string', description: 'Arbitrary payload (stringified) for send_command' },
  //           tabId: { type: 'number', description: 'Target tab for send_command (default active tab)' },
  //         },
  //       },
  //     },
  //     required: ['action'],
  //   },
  // },
  {
    name: TOOL_NAMES.BROWSER.NAVIGATE,
    description:
      'Navigate to a URL, refresh the current tab, or navigate browser history (back/forward)',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'URL to navigate to. Special values: "back" or "forward" to navigate browser history in the target tab.',
        },
        newWindow: {
          type: 'boolean',
          description: 'Create a new window to navigate to the URL or not. Defaults to false',
        },
        tabId: {
          type: 'number',
          description:
            'Target an existing tab by ID (if provided, navigate/refresh/back/forward that tab instead of the active tab).',
        },
        windowId: {
          type: 'number',
          description:
            'Target an existing window by ID (when creating a new tab in existing window, or picking active tab if tabId is not provided).',
        },
        background: {
          type: 'boolean',
          description:
            'Perform the operation without stealing focus (do not activate the tab or focus the window). Default: false',
        },
        width: {
          type: 'number',
          description:
            'Window width in pixels (default: 1280). When width or height is provided, a new window will be created.',
        },
        height: {
          type: 'number',
          description:
            'Window height in pixels (default: 720). When width or height is provided, a new window will be created.',
        },
        refresh: {
          type: 'boolean',
          description:
            'Refresh the current active tab instead of navigating to a URL. When true, the url parameter is ignored. Defaults to false',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SCREENSHOT,
    description:
      '[Prefer read_page over taking a screenshot and Prefer chrome_computer] Take a screenshot of the current page or a specific element. For new usage, use chrome_computer with action="screenshot". Use this tool if you need advanced options.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the screenshot, if saving as PNG' },
        selector: { type: 'string', description: 'CSS selector for element to screenshot' },
        tabId: {
          type: 'number',
          description: 'Target tab ID to capture from (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab from when tabId is not provided.',
        },
        background: {
          type: 'boolean',
          description:
            'Attempt capture without bringing tab/window to foreground. CDP-based capture is used for simple viewport captures. For element/full-page capture, the tab may still be made active in its window without focusing the window. Default: false',
        },
        width: { type: 'number', description: 'Width in pixels (default: 800)' },
        height: { type: 'number', description: 'Height in pixels (default: 600)' },
        storeBase64: {
          type: 'boolean',
          description:
            'return screenshot in base64 format (default: false) if you want to see the page, recommend set this to be true',
        },
        fullPage: {
          type: 'boolean',
          description: 'Store screenshot of the entire page (default: true)',
        },
        savePng: {
          type: 'boolean',
          description:
            'Save screenshot as PNG file (default: true)，if you want to see the page, recommend set this to be false, and set storeBase64 to be true',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.CLOSE_TABS,
    description: 'Close one or more browser tabs',
    inputSchema: {
      type: 'object',
      properties: {
        tabIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of tab IDs to close. If not provided, will close the active tab.',
        },
        url: {
          type: 'string',
          description: 'Close tabs matching this URL. Can be used instead of tabIds.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SWITCH_TAB,
    description: 'Switch to a specific browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to switch to.',
        },
        windowId: {
          type: 'number',
          description: 'The ID of the window where the tab is located.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.WEB_FETCHER,
    description: 'Fetch content from a web page',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch content from. If not provided, uses the current active tab',
        },
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        background: {
          type: 'boolean',
          description: 'Do not activate tab/focus window while fetching (default: false)',
        },
        htmlContent: {
          type: 'boolean',
          description:
            'Get the visible HTML content of the page. If true, textContent will be ignored (default: false)',
        },
        textContent: {
          type: 'boolean',
          description:
            'Get the visible text content of the page with metadata. Ignored if htmlContent is true (default: true)',
        },

        selector: {
          type: 'string',
          description:
            'CSS selector to get content from a specific element. If provided, only content from this element will be returned',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.NETWORK_REQUEST,
    description: 'Send a network request from the browser with cookies and other browser context',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to send the request to',
        },
        method: {
          type: 'string',
          description: 'HTTP method to use (default: GET)',
        },
        headers: {
          type: 'object',
          description: 'Headers to include in the request',
        },
        body: {
          type: 'string',
          description: 'Body of the request (for POST, PUT, etc.)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
        formData: {
          type: 'object',
          description:
            'Multipart/form-data descriptor. If provided, overrides body and builds FormData with optional file attachments. Shape: { fields?: Record<string,string|number|boolean>, files?: Array<{ name: string, fileUrl?: string, filePath?: string, base64Data?: string, filename?: string, contentType?: string }> }. Also supports a compact array form: [ [name, fileSpec, filename?], ... ] where fileSpec may be url:, file:, or base64:.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
    description:
      'Unified network capture tool. Use action="start" to begin capturing, action="stop" to end and retrieve results. Set needResponseBody=true to capture response bodies (uses Debugger API, may conflict with DevTools). Default mode uses webRequest API (lightweight, no debugger conflict, but no response body).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop'],
          description: 'Action to perform: "start" begins capture, "stop" ends and returns results',
        },
        needResponseBody: {
          type: 'boolean',
          description:
            'When true, captures response body using Debugger API (default: false). Only use when you need to inspect response content.',
        },
        url: {
          type: 'string',
          description:
            'URL to capture network requests from. For action="start". If not provided, uses the current active tab.',
        },
        maxCaptureTime: {
          type: 'number',
          description: 'Maximum capture time in milliseconds (default: 180000)',
        },
        inactivityTimeout: {
          type: 'number',
          description: 'Stop after inactivity in milliseconds (default: 60000). Set 0 to disable.',
        },
        includeStatic: {
          type: 'boolean',
          description: 'Include static resources like images/scripts/styles (default: false)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD,
    description: 'Wait for a browser download and return details (id, filename, url, state, size)',
    inputSchema: {
      type: 'object',
      properties: {
        filenameContains: { type: 'string', description: 'Filter by substring in filename or URL' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
        waitForComplete: { type: 'boolean', description: 'Wait until completed (default true)' },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.HISTORY,
    description: 'Retrieve and search browsing history from Chrome',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Text to search for in history URLs and titles. Leave empty to retrieve all history entries within the time range.',
        },
        startTime: {
          type: 'string',
          description:
            'Start time as a date string. Supports ISO format (e.g., "2023-10-01", "2023-10-01T14:30:00"), relative times (e.g., "1 day ago", "2 weeks ago", "3 months ago", "1 year ago"), and special keywords ("now", "today", "yesterday"). Default: 24 hours ago',
        },
        endTime: {
          type: 'string',
          description:
            'End time as a date string. Supports ISO format (e.g., "2023-10-31", "2023-10-31T14:30:00"), relative times (e.g., "1 day ago", "2 weeks ago", "3 months ago", "1 year ago"), and special keywords ("now", "today", "yesterday"). Default: current time',
        },
        maxResults: {
          type: 'number',
          description:
            'Maximum number of history entries to return. Use this to limit results for performance or to focus on the most relevant entries. (default: 100)',
        },
        excludeCurrentTabs: {
          type: 'boolean',
          description:
            "When set to true, filters out URLs that are currently open in any browser tab. Useful for finding pages you've visited but don't have open anymore. (default: false)",
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_SEARCH,
    description: 'Search Chrome bookmarks by title and URL',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query to match against bookmark titles and URLs. Leave empty to retrieve all bookmarks.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of bookmarks to return (default: 50)',
        },
        folderPath: {
          type: 'string',
          description:
            'Optional folder path or ID to limit search to a specific bookmark folder. Can be a path string (e.g., "Work/Projects") or a folder ID.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_ADD,
    description: 'Add a new bookmark to Chrome',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to bookmark. If not provided, uses the current active tab URL.',
        },
        title: {
          type: 'string',
          description: 'Title for the bookmark. If not provided, uses the page title from the URL.',
        },
        parentId: {
          type: 'string',
          description:
            'Parent folder path or ID to add the bookmark to. Can be a path string (e.g., "Work/Projects") or a folder ID. If not provided, adds to the "Bookmarks Bar" folder.',
        },
        createFolder: {
          type: 'boolean',
          description: 'Whether to create the parent folder if it does not exist (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
    description: 'Delete a bookmark from Chrome',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: {
          type: 'string',
          description: 'ID of the bookmark to delete. Either bookmarkId or url must be provided.',
        },
        url: {
          type: 'string',
          description: 'URL of the bookmark to delete. Used if bookmarkId is not provided.',
        },
        title: {
          type: 'string',
          description: 'Title of the bookmark to help with matching when deleting by URL.',
        },
      },
      required: [],
    },
  },
  // {
  //   name: TOOL_NAMES.BROWSER.INJECT_SCRIPT,
  //   description:
  //     'inject the user-specified content script into the webpage. By default, inject into the currently active tab',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       url: {
  //         type: 'string',
  //         description:
  //           'If a URL is specified, inject the script into the webpage corresponding to the URL.',
  //       },
  //       tabId: {
  //         type: 'number',
  //         description:
  //           'Target an existing tab by ID to inject into. Overrides url/active tab selection when provided.',
  //       },
  //       windowId: {
  //         type: 'number',
  //         description:
  //           'Target window ID for selecting active tab or creating new tab when url is provided and tabId is omitted.',
  //       },
  //       background: {
  //         type: 'boolean',
  //         description:
  //           'Do not activate tab/focus window during injection when true (default: false).',
  //       },
  //       type: {
  //         type: 'string',
  //         description:
  //           'the javaScript world for a script to execute within. must be ISOLATED or MAIN',
  //       },
  //       jsScript: {
  //         type: 'string',
  //         description: 'the content script to inject',
  //       },
  //     },
  //     required: ['type', 'jsScript'],
  //   },
  // },
  // {
  //   name: TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT,
  //   description:
  //     'if the script injected using chrome_inject_script listens for user-defined events, this tool can be used to trigger those events',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       tabId: {
  //         type: 'number',
  //         description:
  //           'the tab where you previously injected the script(if not provided,  use the currently active tab)',
  //       },
  //       eventName: {
  //         type: 'string',
  //         description: 'the eventName your injected content script listen for',
  //       },
  //       payload: {
  //         type: 'string',
  //         description: 'the payload passed to event, must be a json string',
  //       },
  //     },
  //     required: ['eventName'],
  //   },
  // },
  {
    name: TOOL_NAMES.BROWSER.JAVASCRIPT,
    description:
      'Execute JavaScript code in a browser tab and return the result. Uses CDP Runtime.evaluate with awaitPromise and returnByValue; automatically falls back to chrome.scripting.executeScript if the debugger is busy. Output is sanitized (sensitive data redacted) and truncated by default.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'JavaScript code to execute. Runs inside an async function body, so top-level await and "return ..." are supported.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Execution timeout in milliseconds (default: 60000, ceiling ~110000 before the bridge ' +
            'call itself times out). A timeout abandons the wait but does NOT cancel the script — ' +
            'page-side fetches still complete, so retrying non-idempotent code can execute it twice.',
        },
        maxOutputBytes: {
          type: 'number',
          description:
            'Maximum output size in bytes after sanitization (default: 51200). Output exceeding this limit will be truncated.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.CLICK,
    description:
      'Click on an element in a web page. Supports multiple targeting methods: CSS selector, XPath, element ref (from chrome_read_page), or viewport coordinates. More focused than chrome_computer for simple click operations.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector or XPath for the element to click.',
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'xpath'],
          description: 'Type of selector (default: "css").',
        },
        ref: {
          type: 'string',
          description: 'Element ref from chrome_read_page (takes precedence over selector).',
        },
        coordinates: {
          type: 'object',
          description: 'Viewport coordinates to click at.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        double: {
          type: 'boolean',
          description: 'Perform double click when true (default: false).',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button to click (default: "left").',
        },
        modifiers: {
          type: 'object',
          description: 'Modifier keys to hold during click.',
          properties: {
            altKey: { type: 'boolean' },
            ctrlKey: { type: 'boolean' },
            metaKey: { type: 'boolean' },
            shiftKey: { type: 'boolean' },
          },
        },
        waitForNavigation: {
          type: 'boolean',
          description: 'Wait for navigation to complete after click (default: false).',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds for waiting (default: 5000).',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
        frameId: {
          type: 'number',
          description: 'Target frame ID for iframe support.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.FILL,
    description:
      'Fill or select a form element on a web page. Supports input, textarea, select, checkbox, and radio elements. Use CSS selector, XPath, or element ref to target the element.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector or XPath for the form element.',
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'xpath'],
          description: 'Type of selector (default: "css").',
        },
        ref: {
          type: 'string',
          description: 'Element ref from chrome_read_page (takes precedence over selector).',
        },
        value: {
          type: ['string', 'number', 'boolean'],
          description:
            'Value to fill. For text inputs: string. For checkboxes/radios: boolean. For selects: option value or text.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
        frameId: {
          type: 'number',
          description: 'Target frame ID for iframe support.',
        },
      },
      required: ['value'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.REQUEST_ELEMENT_SELECTION,
    description:
      'Request the user to manually select one or more elements on the current page. Use this as a human-in-the-loop fallback when you cannot reliably locate the target element after approximately 3 attempts using chrome_read_page combined with chrome_click_element/chrome_fill_or_select/chrome_computer. The user will see a panel with instructions and can click on the requested elements. Returns element refs compatible with chrome_click_element/chrome_fill_or_select (including iframe frameId for cross-frame support).',
    inputSchema: {
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          description:
            'A list of element selection requests. Each request produces exactly one picked element. The user will see these requests in a panel and select each element by clicking on the page.',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description:
                  'Optional stable request id for correlation. If omitted, an id is auto-generated (e.g., "req_1").',
              },
              name: {
                type: 'string',
                description:
                  'Short label shown to the user describing what element to select (e.g., "Login button", "Email input field").',
              },
              description: {
                type: 'string',
                description:
                  'Optional longer instruction shown to the user with more context (e.g., "Click on the primary login button in the top-right corner").',
              },
            },
            required: ['name'],
          },
        },
        timeoutMs: {
          type: 'number',
          description:
            'Timeout in milliseconds for the user to complete all selections. Default: 180000 (3 minutes). Maximum: 600000 (10 minutes).',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: ['requests'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.KEYBOARD,
    description:
      'Simulate keyboard input on a web page. Supports single keys (Enter, Tab, Escape), key combinations (Ctrl+C, Ctrl+V), and text input. Can target a specific element or send to the focused element.',
    inputSchema: {
      type: 'object',
      properties: {
        keys: {
          type: 'string',
          description:
            'Keys or key combinations to simulate. Examples: "Enter", "Tab", "Ctrl+C", "Shift+Tab", "Hello World".',
        },
        selector: {
          type: 'string',
          description: 'CSS selector or XPath for target element to receive keyboard events.',
        },
        selectorType: {
          type: 'string',
          enum: ['css', 'xpath'],
          description: 'Type of selector (default: "css").',
        },
        delay: {
          type: 'number',
          description: 'Delay between keystrokes in milliseconds (default: 50).',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
        frameId: {
          type: 'number',
          description: 'Target frame ID for iframe support.',
        },
      },
      required: ['keys'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.CONSOLE,
    description:
      'Capture console output from a browser tab. Supports snapshot mode (default; one-time capture with ~2s wait) and buffer mode (persistent per-tab buffer you can read/clear instantly without waiting).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'URL to navigate to and capture console from. If not provided, uses the current active tab',
        },
        tabId: {
          type: 'number',
          description: 'Target an existing tab by ID (default: active tab).',
        },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted.',
        },
        background: {
          type: 'boolean',
          description: 'Do not activate tab/focus window when capturing via CDP. Default: false',
        },
        includeExceptions: {
          type: 'boolean',
          description: 'Include uncaught exceptions in the output (default: true)',
        },
        maxMessages: {
          type: 'number',
          description:
            'Maximum number of console messages to capture in snapshot mode (default: 100). If limit is provided, it takes precedence.',
        },
        mode: {
          type: 'string',
          enum: ['snapshot', 'buffer'],
          description:
            'Console capture mode: snapshot (default; waits ~2s for messages) or buffer (persistent per-tab buffer; reads from memory instantly).',
        },
        buffer: {
          type: 'boolean',
          description: 'Alias for mode="buffer" (default: false).',
        },
        clear: {
          type: 'boolean',
          description:
            'Buffer mode only: clear the buffered logs for this tab before reading (default: false). Use clearAfterRead instead to clear after reading (mcp-tools.js style).',
        },
        clearAfterRead: {
          type: 'boolean',
          description:
            'Buffer mode only: clear the buffered logs for this tab AFTER reading, to avoid duplicate messages on subsequent calls (default: false). This matches mcp-tools.js behavior.',
        },
        pattern: {
          type: 'string',
          description:
            'Optional regex filter applied to message/exception text. Supports /pattern/flags syntax.',
        },
        onlyErrors: {
          type: 'boolean',
          description:
            'Only return error-level console messages (and exceptions when includeExceptions=true). Default: false.',
        },
        limit: {
          type: 'number',
          description:
            'Limit returned console messages. In snapshot mode this is an alias for maxMessages; in buffer mode it limits returned messages from the buffer.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.FILE_UPLOAD,
    description:
      'Upload files to web forms with file input elements using Chrome DevTools Protocol',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Target tab ID (default: active tab)' },
        windowId: {
          type: 'number',
          description: 'Target window ID to pick active tab when tabId is omitted',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the file input element (input[type="file"])',
        },
        filePath: {
          type: 'string',
          description: 'Local file path to upload',
        },
        fileUrl: {
          type: 'string',
          description: 'URL to download file from before uploading',
        },
        base64Data: {
          type: 'string',
          description: 'Base64 encoded file data to upload',
        },
        fileName: {
          type: 'string',
          description: 'Optional filename when using base64 or URL (default: "uploaded-file")',
        },
        multiple: {
          type: 'boolean',
          description: 'Whether the input accepts multiple files (default: false)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.HANDLE_DIALOG,
    description: 'Handle JavaScript dialogs (alert/confirm/prompt) via CDP',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'accept | dismiss' },
        promptText: {
          type: 'string',
          description: 'Optional prompt text when accepting a prompt',
        },
      },
      required: ['action'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.GIF_RECORDER,
    description:
      'Record browser tab activity as an animated GIF.\n\nModes:\n- Fixed FPS mode (action="start"): Captures frames at regular intervals. Good for animations/videos.\n- Auto-capture mode (action="auto_start"): Captures frames automatically when chrome_computer or chrome_navigate actions succeed. Better for interaction recordings with natural pacing.\n\nUse "stop" to end recording and save the GIF.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'status', 'auto_start', 'capture', 'clear', 'export'],
          description:
            'Action to perform:\n- "start": Begin fixed-FPS recording (captures frames at regular intervals)\n- "auto_start": Begin auto-capture mode (frames captured on tool actions)\n- "stop": End recording and save GIF\n- "status": Get current recording state\n- "capture": Manually trigger a frame capture in auto mode\n- "clear": Clear all recording state and cached GIF without saving\n- "export": Export the last recorded GIF (download or drag&drop upload)',
        },
        tabId: {
          type: 'number',
          description:
            'Target tab ID (default: active tab). Used with "start"/"auto_start" for recording, and with "export" (download=false) for drag&drop upload target.',
        },
        fps: {
          type: 'number',
          description:
            'Frames per second for fixed-FPS mode (1-30, default: 5). Higher values = smoother but larger file.',
        },
        durationMs: {
          type: 'number',
          description:
            'Maximum recording duration in milliseconds (default: 5000, max: 60000). Only for fixed-FPS mode.',
        },
        maxFrames: {
          type: 'number',
          description:
            'Maximum number of frames to capture (default: 50 for fixed-FPS, 100 for auto mode, max: 300).',
        },
        width: {
          type: 'number',
          description: 'Output GIF width in pixels (default: 800, max: 1920).',
        },
        height: {
          type: 'number',
          description: 'Output GIF height in pixels (default: 600, max: 1080).',
        },
        maxColors: {
          type: 'number',
          description:
            'Maximum colors in palette (default: 256). Lower values = smaller file size.',
        },
        filename: {
          type: 'string',
          description: 'Output filename (without extension). Defaults to timestamped name.',
        },
        captureDelayMs: {
          type: 'number',
          description:
            'Auto-capture mode only: Delay in ms after action before capturing frame (default: 150). Allows UI to stabilize.',
        },
        frameDelayCs: {
          type: 'number',
          description:
            'Auto-capture mode only: Display duration per frame in centiseconds (default: 20 = 200ms per frame).',
        },
        annotation: {
          type: 'string',
          description:
            'Auto-capture mode only (action="capture"): Optional text label to render on the captured frame.',
        },
        download: {
          type: 'boolean',
          description:
            'Export action only: Set to true (default) to download the GIF, or false to upload via drag&drop.',
        },
        coordinates: {
          type: 'object',
          description:
            'Export action only (when download=false): Target coordinates for drag&drop upload.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
        ref: {
          type: 'string',
          description:
            'Export action only (when download=false): Element ref from chrome_read_page for drag&drop target.',
        },
        selector: {
          type: 'string',
          description:
            'Export action only (when download=false): CSS selector for drag&drop target element.',
        },
        enhancedRendering: {
          type: 'object',
          description:
            'Auto-capture mode only: Configure visual overlays for recorded actions (click indicators, drag paths, labels). Pass `true` to enable all defaults.',
          properties: {
            clickIndicators: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    enabled: {
                      type: 'boolean',
                      description: 'Enable click indicators (default: true)',
                    },
                    color: {
                      type: 'string',
                      description:
                        'CSS color for click indicator (default: "rgba(255, 87, 34, 0.8)")',
                    },
                    radius: { type: 'number', description: 'Initial radius in px (default: 20)' },
                    animationDurationMs: {
                      type: 'number',
                      description: 'Animation duration in ms (default: 400)',
                    },
                    animationFrames: {
                      type: 'number',
                      description: 'Number of animation frames (default: 3)',
                    },
                    animationIntervalMs: {
                      type: 'number',
                      description: 'Interval between animation frames in ms (default: 80)',
                    },
                  },
                },
              ],
              description:
                'Click indicator overlay config (true for defaults, or object for custom).',
            },
            dragPaths: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    enabled: {
                      type: 'boolean',
                      description: 'Enable drag path rendering (default: true)',
                    },
                    color: {
                      type: 'string',
                      description: 'CSS color for drag path (default: "rgba(33, 150, 243, 0.7)")',
                    },
                    lineWidth: { type: 'number', description: 'Line width in px (default: 3)' },
                    lineDash: {
                      type: 'array',
                      items: { type: 'number' },
                      description: 'Dash pattern (default: [6, 4])',
                    },
                    arrowSize: {
                      type: 'number',
                      description: 'Arrow head size in px (default: 10)',
                    },
                  },
                },
              ],
              description: 'Drag path overlay config (true for defaults, or object for custom).',
            },
            labels: {
              oneOf: [
                { type: 'boolean' },
                {
                  type: 'object',
                  properties: {
                    enabled: {
                      type: 'boolean',
                      description: 'Enable action labels (default: true)',
                    },
                    font: {
                      type: 'string',
                      description: 'Font for labels (default: "bold 12px sans-serif")',
                    },
                    textColor: { type: 'string', description: 'Text color (default: "#fff")' },
                    bgColor: {
                      type: 'string',
                      description: 'Background color (default: "rgba(0,0,0,0.7)")',
                    },
                    padding: { type: 'number', description: 'Padding in px (default: 4)' },
                    borderRadius: {
                      type: 'number',
                      description: 'Border radius in px (default: 4)',
                    },
                    offset: {
                      type: 'object',
                      properties: { x: { type: 'number' }, y: { type: 'number' } },
                      description: 'Offset from action position (default: {x: 10, y: -20})',
                    },
                  },
                },
              ],
              description: 'Action label overlay config (true for defaults, or object for custom).',
            },
            durationMs: {
              type: 'number',
              description: 'How long overlays remain visible in ms (default: 1500).',
            },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.PULL_RECIPE,
    description:
      "Fetch a Workato recipe's code tree plus version metadata. Read-only. " +
      'Requires an open Workato tab (*.workato.com or *.workato.is) using the same ' +
      "session as the recipe's account.\n\n" +
      'By default returns a COMPACT view: the full step tree with bulky UI-metadata ' +
      'sections (extended_input_schema, extended_output_schema, visible_config_fields, ' +
      "dynamicPickListSelection) stripped and each step's configured input kept with " +
      'its verbose _dp(...) datapills shortened to a readable datapill(...) form. The ' +
      'cheap whole-recipe index — scan it to understand a recipe.\n\n' +
      'Usage pipeline:\n' +
      '1. pull_recipe(recipe_id) — compact tree, see the whole recipe.\n' +
      '2. pull_recipe(recipe_id, view:"outline") — lightest view: step tree and ' +
      'descriptions only, no input. Use for very large recipes that overflow compact.\n' +
      '3. pull_recipe(recipe_id, step:"<as|number>") — drill into one step: its ' +
      'input distilled into a classified `mappings` list (datapill / formula / ' +
      'interpolated / literal / code), the settable input `fields`, and the ' +
      '`available_datapills` produced by upstream steps it can reference.\n' +
      '4. pull_recipe(recipe_id, step:"...", field_query:"text") — filter that ' +
      "step's `fields` and `available_datapills` by name, label, or ref.\n" +
      '5. pull_recipe(recipe_id, view:"full") — the lossless raw tree (exact ' +
      '_dp(...) references), only for wholesale tree rewrites.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id, e.g. 72449879. Found in the recipe URL: ' +
            'app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        view: {
          type: 'string',
          enum: ['compact', 'outline', 'full'],
          description:
            "Whole-recipe read mode. 'compact' (default) strips UI metadata and " +
            "shortens datapills; 'outline' additionally drops every step's input " +
            "(lightest, for very large recipes); 'full' returns the lossless raw " +
            'code tree. With [step], view:"full" returns the raw step node.',
        },
        step: {
          type: 'string',
          description:
            "Drill into a single step. Accepts the step's 'as' anchor or its " +
            'numeric step number. Returns the step header, its `mappings` ' +
            '(classified input leaves — the wiring and logic), the settable ' +
            '`fields`, and `available_datapills` from upstream steps. Pass ' +
            'view:"full" with step to return the raw step node, including schemas.',
        },
        field_query: {
          type: 'string',
          description:
            "Case-insensitive substring filter for [step] mode's `fields` and " +
            '`available_datapills`, matched against name, label, and ref. ' +
            'Lifts the 60-item cap on both. Requires [step].',
        },
        out_file: {
          type: 'string',
          description:
            'Absolute path to write the complete recipe to as a JSON file (envelope: ' +
            '{recipe_id, name, version_no, code, config}). When set, the full code tree ' +
            'is saved to disk and the response returns only a compact summary plus a ' +
            'step list — the raw tree never enters the agent context. Forces full view; ' +
            '[view]/[step]/[field_query] are ignored. Edit the file, then push it back ' +
            'with workato_ui_save_recipe_code(code_path).',
        },
        timeout_ms: {
          type: 'number',
          description:
            'In-page fetch timeout in milliseconds. Default 30000, clamped 10000–110000. ' +
            'Raise for very large recipes (300 KB+ code trees) that time out at the default.',
          minimum: 10000,
          maximum: 110000,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.RENAME_RECIPE,
    description:
      'Rename a Workato recipe by PUTting /recipes/<id>.json with {flow:{name}}. ' +
      'Returns the recipe id, new name, version number, updated_at, folders, and validation errors if Workato returns them. ' +
      'Requires an open Workato tab (*.workato.com or *.workato.is) using the same session as the recipe account.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Found in the recipe URL: app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        name: {
          type: 'string',
          description: 'New recipe name.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.SET_VERSION_COMMENT,
    description:
      'Set the comment on a specific Workato recipe version by PUTting /recipes/<id>/versions/<version>.json with {comment}. ' +
      'Use it to annotate a version in the recipe Versions tab (e.g. what changed and why). Pass an empty string to clear the comment. ' +
      'TIP: when the comment belongs to a save you are about to make, pass comment: directly to ' +
      'workato_ui_save_recipe_code instead — one call, one timeout window. ' +
      'If this request times out, the tool verifies whether the comment landed before reporting failure ' +
      '(succeeded_after_timeout:true in the response). ' +
      'Returns the recipe id, version, and comment. Requires an open Workato tab (*.workato.com or *.workato.is) using the same session as the recipe account.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Found in the recipe URL: app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        version: {
          type: 'number',
          description:
            'Recipe version number to annotate, as shown in the recipe Versions tab (version_no from workato_pull_recipe).',
        },
        comment: {
          type: 'string',
          description: 'Comment text to attach to the version. Empty string clears the comment.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'version', 'comment'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.START_RECIPE,
    description:
      'Start a Workato recipe by POSTing /web_api/recipes/<id>/start.json. ' +
      'Returns the enqueue status; pass wait:true to poll until the recipe actually reports running. ' +
      'If the request times out, the tool verifies actual recipe state before reporting failure ' +
      '(status "succeeded_after_timeout" means the start landed despite the timeout). ' +
      'Requires an open Workato tab (*.workato.com or *.workato.is) using the same session as the recipe account.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Found in the recipe URL: app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        wait: {
          type: 'boolean',
          description:
            'Poll workato_recipe_status until running=true (or the wait window expires). Response includes state, running, waited_ms, state_flipped.',
          default: false,
        },
        wait_timeout_ms: {
          type: 'number',
          description: 'Max polling window for wait:true. Default 20000, clamped 1000–60000.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.STOP_RECIPE,
    description:
      'Stop a Workato recipe by POSTing /web_api/recipes/<id>/stop.json. ' +
      'Pass force:true when Workato reports active dependent recipes and you still want to enqueue the stop. ' +
      'Returns the enqueue status; pass wait:true to poll until the recipe actually reports stopped. ' +
      'If the request times out, the tool verifies actual recipe state before reporting failure ' +
      '(status "succeeded_after_timeout" means the stop landed despite the timeout). ' +
      'NOTE: to edit a running recipe, prefer workato_ui_save_recipe_code(restart_if_running:true) over a manual stop→save→start. ' +
      'Requires an open Workato tab (*.workato.com or *.workato.is) using the same session as the recipe account.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Found in the recipe URL: app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        force: {
          type: 'boolean',
          description:
            'When true, sends {"force":true} to stop even if Workato reports active dependent recipes.',
        },
        wait: {
          type: 'boolean',
          description:
            'Poll workato_recipe_status until running=false (or the wait window expires). Response includes state, running, waited_ms, state_flipped.',
          default: false,
        },
        wait_timeout_ms: {
          type: 'number',
          description: 'Max polling window for wait:true. Default 20000, clamped 1000–60000.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.RECIPE_STATUS,
    description:
      "Cheap read of a recipe's live state: {running, state, version_no, last_run_at, stopped_at, " +
      'stop_reason, stopped_for_error, job_succeeded_count, job_failed_count}. ~4 KB fetch, no code tree. ' +
      'THE post-write verification tool: call after start/stop/save to confirm the change took effect, ' +
      'instead of re-running search_recipes or pulling the recipe. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.ADAPTER_META,
    description:
      "Look up a connector's REAL config surface from /integrations/meta — the endpoint the " +
      'recipe editor itself calls. THE answer to "what is this field actually called?". ' +
      'Workato silently DROPS input keys it does not recognise, so a guessed key name saves ' +
      'cleanly and then does nothing; one call here replaces the guess/save/pull/check loop. ' +
      'Returns, per trigger and action: input[] and output[] field lists (name, type, ' +
      'control_type, label, optional, extends_schema), help text, and the behaviour flags ' +
      'extends_input_schema / extends_output_schema / depends_on / deprecated / batch / realtime. ' +
      'Each field also carries what decides whether a written step WORKS: `options` for a static ' +
      'select (the VALUE to write, not the label the UI shows — Workato takes a wrong value ' +
      'silently), `default`, `properties` for the item fields of an object/array, and ' +
      '`toggle_field` for the alternative form of a field that accepts either shape. ' +
      'Per adapter it returns title / aliases / categories, which confirm a GUESSED name is the ' +
      'right app, and connection_required — false means the connector needs no connection at all ' +
      '(Email by Workato, logger, py_eval) and its step carries no account_id. ' +
      'Resolves any standard adapter whether or not this workspace has a connection to it, and ' +
      'the array form reports unknown names under not_found, which makes it the way to test a ' +
      'guess. For the apps this workspace HAS, use workato_apps_list; for how a connector is ' +
      'actually used here, workato_recipe_step_search. ' +
      '`depends_on` is how you learn a step takes its schema from another step (e.g. ' +
      "return_result's fields come from the recipe-function trigger's result_schema_json). " +
      'PAYLOAD: a bare call returns only the operation INDEX (names + titles) because some ' +
      'adapters are hundreds of KB; pass operation to get one operation in full, or field_grep ' +
      'to find fields by name/label across all of them. Read-only. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        adapter: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Adapter name or names, e.g. "workato_recipe_function", "salesforce", ' +
            '["workato_recipe_function","workato_workflow_task"]. A custom connector uses its ' +
            'generated name (e.g. "netsuite_rest_connector_5105163_1745592003") — read it off ' +
            "a recipe step's `provider` field.",
        },
        operation: {
          type: 'string',
          description:
            'Trigger or action name (e.g. "execute", "call_recipe", "return_result"). Returns ' +
            'that operation with full input/output field lists.',
        },
        field_grep: {
          type: 'string',
          description:
            'Substring, or /regex/, matched case-insensitively against field name and label. ' +
            'Returns every operation with a matching field, carrying only the matches. ' +
            'e.g. "schema" finds parameters_schema_json and result_schema_json.',
        },
        include_help: {
          type: 'boolean',
          description: "Include each operation's help text. Default true.",
        },
        raw: {
          type: 'boolean',
          description:
            'Return the raw meta document instead of the slim view. Capped at 20k chars — ' +
            'use out_file for the whole thing.',
        },
        out_file: {
          type: 'string',
          description:
            'Absolute path to write the raw meta JSON to. The document never enters the ' +
            'response, so this is the safe way to read a large adapter in full.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['adapter'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.APPS_LIST,
    description:
      'List the apps this workspace can build recipe steps with, and their TECHNICAL adapter ' +
      'names. This is the step BEFORE workato_adapter_meta: that tool describes one connector ' +
      'in full but only once its name is known, and the name is exactly what cannot be guessed ' +
      'for a custom connector ("netsuite_rest_connector_5105163_1745592003"). Merges five ' +
      'read-only sources by adapter name and marks each app with where it came from: ' +
      '"connection" (a real connection exists here, so a step can authenticate today, with the ' +
      'connection ids and authorization status), "recipes" (already used by a recipe here, so ' +
      'workato_recipe_step_search will find live examples), "builtin" (one of Workato\'s own ' +
      'connectors, always available), "custom" (this workspace\'s own SDK connector), ' +
      '"certified" (Workato certified catalogue, not installed here). Sorted so the ' +
      'immediately usable apps come first. ' +
      'NO CONNECTION MEANS STOP AND ASK THE USER: these tools cannot create one, and a step ' +
      'needs its provider account_id in the recipe config, which does not exist until the ' +
      'connection does. An app listed WITHOUT a "connection" source, or with one whose ' +
      'authorization_status is not "success", is a blocker to raise before writing the step. ' +
      'The exception is a "builtin" whose connection_required is false (email, logger, ' +
      'py_eval, clock and the rest of the Workato tools), which needs nothing. ' +
      "WORKATO'S OWN CONNECTORS ARE NAMED NOTHING LIKE THEY ARE CALLED: HTTP is `rest`, Workato " +
      'Event Streams is `workato_pub_sub`, Scheduler is `clock`, Python snippets is `py_eval`, ' +
      'Workflow apps is `workato_workflow_task`. Guessing from the display name returns an EMPTY ' +
      'meta document, indistinguishable from "no such app". Their titles and aliases are read ' +
      'live, so searching "event stream", "pub/sub" or "approval" lands on the right adapter. ' +
      'KNOWN LIMIT, also stated in the response: Workato serves NO catalogue of its ~1000 ' +
      'standard connectors — the recipe editor compiles that list into its own bundle and makes ' +
      'no request for it. An app missing from this list is therefore not proof it does not ' +
      'exist; resolve a standard app by passing the guessed name(s) to workato_adapter_meta, ' +
      'which takes an array and reports the misses under not_found. ' +
      'Read-only. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Case-insensitive substring matched against adapter name, title and aliases, ' +
            'e.g. "sales", "netsuite", "email".',
        },
        include_certified: {
          type: 'boolean',
          description:
            "Search Workato's certified community catalogue too (~70 KB raw). Defaults to " +
            'true when query is set (the filter keeps it small), false otherwise.',
        },
        limit: {
          type: 'number',
          description: 'Max apps returned. Default 200, clamped 1-1000.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.PICK_LIST,
    description:
      'Resolve a DYNAMIC pick list against a real connection: the customer own Salesforce ' +
      'objects, NetSuite record types, Slack channels. workato_adapter_meta returns a static ' +
      'select values inline; when a field pick_list is a STRING instead, the values are not in ' +
      'the meta document at all, because they are per-connection data. This is the call that ' +
      'turns "the agent knows the field" into "the agent can fill the field". ' +
      'Pass adapter + operation + field name and the field definition is looked up for you ' +
      '(nested properties and toggle_field included), or pass a raw field definition object. ' +
      'A field whose pick_list is already a static array is answered without a network call. ' +
      'Returns {value, label} pairs: Workato stores them label-FIRST, and `value` is the ' +
      'string that goes into step.input. A list can run to thousands of entries, so narrow ' +
      'with query and limit. ' +
      'WRITING THE RESULT: a step field fed by a dynamic pick list carries its choice TWICE, ' +
      'in `input` and in `dynamicPickListSelection` under the same field name. Setting only ' +
      '`input` saves cleanly and leaves the editor showing an empty picker. ' +
      'Read-only. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'number',
          description:
            'Numeric Workato connection id the list is resolved against. A dynamic pick list is ' +
            "the customer's own data, so it exists only per connection. Find one with " +
            'workato_apps_list or workato_search_connections.',
        },
        adapter: {
          type: 'string',
          description: 'Adapter name, e.g. "salesforce". Required when field is a name.',
        },
        operation: {
          type: 'string',
          description:
            'Trigger or action name that owns the field, e.g. "search_sobjects". Required when ' +
            'field is a name.',
        },
        field: {
          oneOf: [{ type: 'string' }, { type: 'object' }],
          description:
            'Field name (e.g. "sobject_name"), or the raw field definition object from ' +
            'workato_adapter_meta for a field it did not surface by name.',
        },
        pick_list_params: {
          type: 'object',
          description:
            'Values a parameterised list depends on, EVALUATED: {"sobject_name": "Account", ' +
            '"field_name": "Rating"}. The field names the params it needs in its own ' +
            'pick_list_params, but shows them as FORMULAS (the value appears wrapped in quotes), ' +
            'and sending that form verbatim fails with a bad-URI error. Quotes copied by mistake ' +
            'are stripped and reported. Omit for an unparameterised list.',
        },
        flow_id: {
          type: 'number',
          description: 'Recipe id, sent as flow_id. Optional; most lists resolve without it.',
        },
        query: {
          type: 'string',
          description: 'Case-insensitive substring filter over label and value.',
        },
        limit: {
          type: 'number',
          description: 'Max options returned. Default 100, clamped 1-2000.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 45000, clamped 10000-110000.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['connection_id', 'field'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.RECIPE_STEP_SEARCH,
    description:
      'Find how a connector is ACTUALLY used in this workspace: returns real steps from real ' +
      'recipes as templates. workato_adapter_meta says what a field is called and what it ' +
      'accepts; it cannot say what a working value looks like — which datapill shape the team ' +
      'uses, which optional fields they always set, how they format an internal id. That only ' +
      'exists in the recipes already running here, and this replaces the manual ' +
      'search_recipes -> pull_recipe -> scroll loop. ' +
      'Scans the recipe list (every item already carries trigger_application and ' +
      'action_applications, so candidates are found without opening them), reads the code of the ' +
      'matches, and walks the tree at any depth so steps nested inside if / repeat_each / try ' +
      'blocks are found too. Returns per hit: recipe_id, recipe_name, step_number, keyword, ' +
      'name, `as` anchor, description and the full `input` block. Connection secrets are ' +
      'stripped. ' +
      'The returned input is a TEMPLATE, not a value to copy blindly: its datapills are bound to ' +
      "that recipe's own steps and must be repointed. Zero results is a normal answer meaning " +
      'this connector was never used here, not an error. Read-only. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description:
            'Adapter name to look for, matched against step.provider, e.g. "salesforce", ' +
            '"email", "netsuite_rest_connector_5105163_1745592003". Find it with ' +
            'workato_apps_list.',
        },
        action: {
          type: 'string',
          description:
            'Optional action or trigger name matched exactly (case-insensitive) against ' +
            'step.name, e.g. "send_mail". Omit to see every step for this provider, which is ' +
            'also how you learn which of its operations are used here at all.',
        },
        limit: {
          type: 'number',
          description: 'Max matching steps returned. Default 5, clamped 1-25.',
        },
        max_recipes: {
          type: 'number',
          description: 'Max recipes whose code is read. Default 8, clamped 1-25.',
        },
        max_pages: {
          type: 'number',
          description:
            'Pages of the recipe list to scan, 20 recipes per page. Default 5, clamped 1-25. ' +
            'Raise it for a workspace with more recipes than that.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 45000, clamped 10000-110000.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['provider'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.SAVE_WITH_DEPENDENTS,
    description:
      'Save a CALLABLE recipe (recipe function) and handle its callers around the save. ' +
      'Workato refuses to stop a callable while a recipe that calls it is running ' +
      '(active_dependent_recipes_count), and refuses a code save on a running recipe, so every ' +
      'edit to a shared callable is stop-caller-A, stop-caller-B, save, start-A, start-B. This ' +
      'does that in one call and RESTORES each dependent to the state it was in — a caller that ' +
      'was already stopped stays stopped. ' +
      'DEPENDENT DISCOVERY: Workato exposes only a COUNT of active dependents, never their ids, ' +
      'so this tool will not guess. Pass dependent_recipe_ids (the callers you know), or ' +
      'scan_folder_id to read every recipe in a folder and match call_recipe.flow_id. With ' +
      'neither, the call is REFUSED rather than saving as if there were no dependents. If the ' +
      'save fails because more dependents are active than were listed, everything this call ' +
      'stopped is restarted and the mismatch is reported. ' +
      'For a callable with no callers, use workato_ui_save_recipe_code instead.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'The callable recipe to save.' },
        code: {
          type: 'object',
          description: 'Full recipe code tree. Use code_path for anything large.',
        },
        code_path: {
          type: 'string',
          description:
            'Absolute path to a recipe JSON file (as written by workato_pull_recipe out_file). ' +
            'Read in the bridge, so the tree never crosses the context.',
        },
        config: {
          type: 'array',
          description: "Recipe connection config. Defaults to the recipe's own.",
        },
        dependent_recipe_ids: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Recipe ids that call this one. The fast, exact path — used verbatim, no discovery.',
        },
        scan_folder_id: {
          type: 'number',
          description:
            'Instead of a list: read every recipe in this folder and treat those whose ' +
            'call_recipe step targets recipe_id as the dependents. Costs one pull per recipe.',
        },
        expected_base_version_no: {
          type: 'number',
          description:
            'Optimistic lock: refuse if the recipe moved past this version since you pulled it.',
        },
        ensure_running: {
          type: 'boolean',
          description: 'Start the callee after the save even if it was stopped beforehand.',
        },
        comment: {
          type: 'string',
          description:
            'Version comment. CLIENT-VISIBLE in the recipe version history (these recipes get ' +
            'promoted to the client production environment), so keep it neutral and boring — ' +
            '"schema refresh", "config update". Never a narrative of what was changed or of ' +
            'what an agent did. Defaults to "schema refresh".',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.CALLABLE_SCHEMA_SET,
    description:
      "Declare a callable recipe's parameter and result schemas as one coherent unit. " +
      "A recipe function's contract lives in FOUR places that must agree and nothing checks " +
      "that they do: the trigger's parameters_schema_json, the trigger's result_schema_json, " +
      "the trigger's extended_output_schema (the `parameters` wrapper), and the return_result " +
      "step's extended_input_schema + input {result:{...}} + visible_config_fields. " +
      'MISSING result_schema_json IS SILENT AND TOTAL: the callee saves cleanly, its job ' +
      "succeeds, its trace shows the full payload, and the caller's call_recipe output is " +
      '{job_id, job_url, result: null} with every downstream pill resolving empty. This tool ' +
      'writes all four together. Existing datapill mappings under input.result are preserved, ' +
      'and values sitting flat on input (the pre-fix shape that CAUSES result:null) are migrated ' +
      'under the result wrapper instead of being dropped. Pulls, mutates and saves in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'The CALLABLE recipe (trigger provider workato_recipe_function).',
        },
        parameters: {
          type: 'array',
          description:
            'Input fields the callable accepts. Each {name, type, control_type?, label?, ' +
            'optional?, properties?}. Only `name` is required; the rest are filled in the way ' +
            'the schema designer would. At runtime these arrive under `parameters` — the ' +
            'trigger pill path is ["parameters","<Name>"].',
          items: { type: 'object' },
        },
        results: {
          type: 'array',
          description:
            'Fields the callable returns. Same entry shape; nested arrays take of:"object" plus ' +
            'properties[]. These must be WRITTEN under a `result` wrapper, which this tool does.',
          items: { type: 'object' },
        },
        expected_base_version_no: {
          type: 'number',
          description: 'Optimistic lock against the version you pulled.',
        },
        restart_if_running: {
          type: 'boolean',
          description:
            'Stop, save, restart when the recipe is running. Does NOT stop dependent callers — ' +
            'use workato_recipe_save_with_dependents when the callable has running callers.',
        },
        ensure_running: { type: 'boolean', description: 'Start the recipe after saving.' },
        comment: {
          type: 'string',
          description:
            'Version comment. CLIENT-VISIBLE in the recipe version history — keep it neutral ' +
            '("schema refresh", "schema update"), never a description of the work done. ' +
            'Defaults to "schema refresh".',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.CALLER_BIND,
    description:
      'Teach a call_recipe step what its callee returns, and repoint the pills written against ' +
      "the old shape. Reads the CALLEE's own trigger for the contract (nothing is guessed), then " +
      "writes the caller step's extended_output_schema (job_id, job_url, and the callee's " +
      '`result` object node) plus its extended_input_schema (the `parameters` node), and rewrites ' +
      'every datapill in the caller that reads a result field straight off that step so its path ' +
      'starts with "result". Run workato_callable_schema_set on the callee FIRST — a callee with ' +
      'no result_schema_json is refused here, because binding to it would produce result:null.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'The CALLER recipe (the one with the call_recipe step).',
        },
        callee_recipe_id: {
          type: 'number',
          description:
            'The callable being called. Optional when the caller has exactly one call_recipe ' +
            "step — it is read from that step's flow_id.",
        },
        step: {
          type: 'string',
          description:
            'Which call_recipe step, by `as` id or step number. Needed only when several match.',
        },
        expected_base_version_no: { type: 'number', description: 'Optimistic lock.' },
        restart_if_running: { type: 'boolean', description: 'Stop, save, restart when running.' },
        ensure_running: { type: 'boolean', description: 'Start the recipe after saving.' },
        comment: {
          type: 'string',
          description:
            'Version comment. CLIENT-VISIBLE — keep it neutral ("schema refresh"). Defaults to ' +
            '"schema refresh".',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.DATAPILL,
    description:
      'Build a datapill reference string exactly, instead of assembling one by hand. Workato ' +
      "matches the _dp('<json>') literal BYTE-FOR-BYTE: one inserted space, or a line wrap, " +
      'and the pill saves fine and then silently resolves to nothing. THREE dialects — recipe ' +
      'step output ({pill_type, provider, line, path}), Workflow App widget ({source:"widget", ' +
      'id, path}), and Workflow App page variable ({source:"page-variable", id, path}) — and ' +
      'two modes: "interpolated" (#{_dp(...)}, for a normal string field) and ' +
      '"formula" (bare _dp(...), valid only inside a value whose first character is "="). ' +
      'Path shorthand: "rows[]" is the element under iteration (current_item), "rows#size" is the ' +
      'collection length. Pure string assembly — no browser, no Workato call.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['recipe', 'widget', 'variable'],
          description:
            'Which dialect. Inferred from widget_id / variable_id when given, "recipe" otherwise.',
        },
        mode: {
          type: 'string',
          enum: ['interpolated', 'formula'],
          description:
            '"interpolated" (default) wraps as #{_dp(...)} for a plain string field. "formula" ' +
            'emits a bare _dp(...) for use inside a leading-"=" expression.',
        },
        shorthand: {
          type: 'string',
          description:
            'Recipe dialect in one token: "provider.line.path.parts", e.g. ' +
            '"salesforce.9ad56b78.records[].Id" or "py_eval.84767f5e.output.rows#size".',
        },
        provider: {
          type: 'string',
          description: 'Recipe dialect: the step adapter, e.g. "salesforce", "py_eval".',
        },
        line: {
          type: 'string',
          description: 'Recipe dialect: the target step `as` id (8 hex chars), NOT its number.',
        },
        pill_type: {
          type: 'string',
          description: 'Recipe dialect. Default "output". "job_context" takes no provider/line.',
        },
        widget_id: {
          type: 'string',
          description:
            'Widget dialect: the widget 8-hex id read from the page content. Never invent one.',
        },
        variable_id: {
          type: 'string',
          description:
            'Page-variable dialect: the variable 8-hex id from the page content. Emits ' +
            'source:"page-variable" — the shape the builder itself writes when a page variable ' +
            'is dropped into a field.',
        },
        path: {
          oneOf: [{ type: 'string' }, { type: 'array' }],
          description:
            'Dotted string or array. Widget and page-variable pills default to ["value"]. Array ' +
            'entries may be literal {"path_element_type":"current_item"} / ' +
            '{"path_element_type":"size"} objects.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.VERSION_DIFF,
    description:
      'Compare two saved versions of a recipe and return ONLY the changed steps (compact). ' +
      'Fetches both code trees via /recipes/<id>/code.json?version_no=N, diffs them in the ' +
      'background, and returns {summary, added, removed, changed} where each changed step lists ' +
      'field-level changes as {path, from, to} excerpts. Steps that merely got renumbered by an ' +
      'insertion above them are counted in summary.moved but not listed. Use for "what did I just ' +
      'change" verification (from=base, to=new version_no returned by save) and for version ' +
      'archaeology ("what changed between v46 and v47"). Read-only. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id.',
        },
        from: {
          type: 'number',
          description: 'Older version_no (as shown in the Versions tab).',
        },
        to: {
          type: 'number',
          description: 'Newer version_no to compare against.',
        },
        value_excerpt_chars: {
          type: 'number',
          description:
            'Max characters per old/new value excerpt in field changes. Default 200, clamped 40–2000.',
        },
        timeout_ms: {
          type: 'number',
          description:
            'In-page fetch timeout in milliseconds (two full code trees are fetched). ' +
            'Default 40000, clamped 10000–110000.',
          minimum: 10000,
          maximum: 110000,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'from', 'to'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.LIST_FOLDERS,
    description:
      'List the full Workato project/folder tree (GET /folders?projects_mode=true). ' +
      'Top-level entries are project root folders: their `id` is the folder id to use as ' +
      'parent_id (create/move folder) or folder_id (move recipe), and `project_id` is the owning ' +
      "project's id. Each node reports flow_count/active_flow_count (recipes) plus non-zero asset " +
      'counts under `counts`, and nested `children`. Slim by default; totals holds account-wide ' +
      'asset counters. THE tool to call before creating/moving folders or recipes — it is the ' +
      'source of folder ids. Read-only. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Optional filter: return only the project whose name (case-insensitive) or project_id ' +
            'matches. Errors with the list of available projects when nothing matches.',
        },
        full: {
          type: 'boolean',
          description: 'Return the raw untrimmed API response instead of the slim tree.',
          default: false,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.CREATE_FOLDER,
    description:
      'Create a folder by POSTing /folders with {name, parent_id}. parent_id is a folder id from ' +
      "workato_list_folders — use a project's root folder id to create at the top of a project, " +
      'or another folder id to nest. Returns the new folder_id (use it as parent_id/folder_id in ' +
      'later calls). If the request times out, the tool re-reads the folder tree to check whether ' +
      'the folder actually got created before reporting failure (succeeded_after_timeout:true). ' +
      'Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new folder.',
        },
        parent_id: {
          type: 'number',
          description:
            'Parent folder id (from workato_list_folders). Project root folders work here.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['name', 'parent_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.UPDATE_FOLDER,
    description:
      'Rename and/or move a folder by PUTting /folders/<id> with {name?, parent_id?}. ' +
      'Pass name to rename, parent_id to move it under another folder (must be in the same ' +
      'project tree), or both. At least one is required; omitted fields are left unchanged. ' +
      'If the request times out, the tool re-reads the folder tree to verify the change landed ' +
      'before reporting failure (succeeded_after_timeout:true). Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'number',
          description: 'Folder id to update (from workato_list_folders).',
        },
        name: {
          type: 'string',
          description: 'New folder name. Omit to keep the current name.',
        },
        parent_id: {
          type: 'number',
          description: 'New parent folder id to move the folder under. Omit to keep it in place.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['folder_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.DELETE_FOLDER,
    description:
      'Delete a folder by DELETEing /folders/<id>. DANGER: Workato CASCADES this delete — a ' +
      'non-empty folder is deleted together with everything inside it (recipes, subfolders, ' +
      'connections...), verified live. This tool therefore pre-checks the folder tree and refuses ' +
      'when the folder is not empty unless force:true; it also refuses project root folders ' +
      'outright. Only pass force:true when the user explicitly confirmed cascading deletion. ' +
      'Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'number',
          description: 'Folder id to delete (from workato_list_folders).',
        },
        force: {
          type: 'boolean',
          description:
            'Delete even when the folder is not empty — CASCADES to all contents. Requires ' +
            'explicit user confirmation.',
          default: false,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['folder_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.MOVE_RECIPE,
    description:
      'Move a recipe into another folder by PUTting /recipes/<id>/update_folder.json with ' +
      '{folder_id}. Get the target folder id from workato_list_folders (project root folder ids ' +
      'work — that puts the recipe at the top level of the project). Moving across projects ' +
      'changes which project owns the recipe. If the request times out, the tool re-reads the ' +
      "recipe's folder_id to verify the move landed before reporting failure " +
      '(succeeded_after_timeout:true). Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Found in the recipe URL: app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        folder_id: {
          type: 'number',
          description: 'Destination folder id (from workato_list_folders).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'folder_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.COPY_RECIPE,
    description:
      'Copy (clone) a recipe by POSTing /recipes/<id>/copy.json with {folder_id}. Returns the ' +
      'new recipe id. The copy is created stopped, with the same code tree as the source; get the ' +
      'destination folder id from workato_list_folders (project root folder ids work, and copying ' +
      'into another project is allowed). If the request times out, the tool re-reads the ' +
      "destination folder's recipe list to check whether the copy landed before reporting failure " +
      '(succeeded_after_timeout:true). Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id of the source recipe. Found in the recipe URL: ' +
            'app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        folder_id: {
          type: 'number',
          description: 'Destination folder id for the copy (from workato_list_folders).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'folder_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.DELETE_RECIPE,
    description:
      'Permanently delete a recipe by DELETEing /recipes/<id>.json. There is no undo, so only ' +
      'call this when the user explicitly asked for the deletion. The tool pre-reads the recipe ' +
      'and refuses when it is running (stop it first with workato_stop_recipe). If the request ' +
      'times out, the tool re-reads the recipe to verify it is gone before reporting failure ' +
      '(succeeded_after_timeout:true). Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Found in the recipe URL: app.workato.com/recipes/<recipe_id>-<slug>.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.CREATE_PROJECT,
    description:
      'Create a new Workato project by POSTing /web_api/projects.json with {name}. Returns ' +
      "{project_id, name, folder_id, project_type} — folder_id is the project's root folder, the " +
      'parent_id to use for workato_create_folder and the folder_id for placing recipes in the ' +
      'new project. If the request times out, the tool re-reads the folder tree to check whether ' +
      'the project got created before reporting failure (succeeded_after_timeout:true). ' +
      'NOTE: there is no delete-project tool — creating a project is easy to do but manual to ' +
      'undo, so only create when the user asked for it. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new project.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.UPDATE_PROJECT,
    description:
      'Rename a project and/or change its color/icon by PUTting /web_api/projects/f<folder_id>.json ' +
      "with {name?, color?, icon?}. Takes the project's ROOT FOLDER id (top-level `id` from " +
      'workato_list_folders, or folder_id from workato_create_project) — NOT the project_id. ' +
      'Omitted fields keep their current value. If the request times out, the tool re-reads the ' +
      'folder tree to verify the change landed before reporting failure ' +
      '(succeeded_after_timeout:true). Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'number',
          description:
            "The project's root folder id (top-level `id` in workato_list_folders). Not the project_id.",
        },
        name: {
          type: 'string',
          description: 'New project name. Omit to keep the current name.',
        },
        color: {
          type: 'string',
          description:
            'Project color slug as used by the Workato UI (e.g. "forest", "purple", "gold", ' +
            '"plum", "slate", "neutral"). Omit to keep the current color.',
        },
        icon: {
          type: 'string',
          description: 'Project icon identifier. Omit to keep the current icon.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['folder_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.JOB_TRACE,
    description:
      "Fetch a Workato job's per-step execution trace. Read-only. Returns a slimmed " +
      'shape by default (step list, status, error, truncated input/output; schema noise ' +
      'like output_schema/extended_*_schema is stripped from summaries). ' +
      'For long recipes, narrow with lines:[104,118] (exact set) or line_range:[91,123] ' +
      "(inclusive). THE PER-STEP UNTRUNCATED READ IS detail:'full' PLUS lines:[N] (or " +
      'line_range) — there is no `step` parameter, and passing one does nothing, so a trace ' +
      'that still looks truncated means the line selection was missing. That pair is the ' +
      'way to answer "what exactly did step 118 receive ' +
      'in this job". Pass full=true to get raw responses for both the job metadata and ' +
      'line details endpoints. Requires an open Workato tab. Both recipe_id and job_id ' +
      'are required — Workato job trace endpoints are recipe-scoped.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id the job belongs to.',
        },
        job_id: {
          type: ['string', 'number'],
          description:
            'Workato job id. May be string or number depending on source; both accepted.',
        },
        lines: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Only return steps with these exact recipe_line_number values, e.g. [104, 118].',
        },
        line_range: {
          type: 'array',
          items: { type: 'number' },
          minItems: 2,
          maxItems: 2,
          description: 'Only return steps whose recipe_line_number is within [from, to] inclusive.',
        },
        detail: {
          type: 'string',
          enum: ['summary', 'full'],
          description:
            "'summary' (default): truncated summaries. 'full': exact untruncated input/output " +
            '(schema-stripped) for the selected steps — requires lines/line_range matching ≤20 steps.',
        },
        full: {
          type: 'boolean',
          description: 'If true, return raw responses instead of the slim shape. Default false.',
          default: false,
        },
        timeout_ms: {
          type: 'number',
          description:
            'In-page fetch timeout in milliseconds. Default 30000, clamped 10000–110000. ' +
            'Raise for very large job traces.',
          minimum: 10000,
          maximum: 110000,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'job_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.SEARCH_RECIPES,
    description:
      'Search Workato recipes by name. Returns a paginated list of recipes ' +
      '(20 per page, server-capped). Optional folder_id scopes the search. ' +
      'Optional text does a name substring match across the workspace. ' +
      'Slim response includes `count` (total matches across all pages) so ' +
      'you can decide whether to advance `page=`. Pass full=true for the ' +
      'raw 24-key Workato response shape. Requires an open Workato tab ' +
      '(*.workato.com or *.workato.is).',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Name substring search. Omit or empty for all recipes.',
        },
        folder_id: {
          type: 'number',
          description: 'Numeric folder id to scope the search.',
        },
        page: {
          type: 'number',
          description:
            '1-based page number. Default 1. Workato returns 20 items per page (server-capped).',
          default: 1,
        },
        sort: {
          type: 'string',
          enum: ['latest_activity', 'name', 'updated_at', 'created_at'],
          description: 'Sort order. Default latest_activity.',
          default: 'latest_activity',
        },
        full: {
          type: 'boolean',
          description: 'If true, return the raw Workato response shape instead of the slim shape.',
          default: false,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.SEARCH_CONNECTIONS,
    description:
      'Search Workato connections by name. Same paginated endpoint as ' +
      'workato_search_recipes but filters to connections. Note: text= ' +
      'matches connection NAMES, not the provider field — to find "the ' +
      'salesforce connection" pass provider:"salesforce" instead (the tool ' +
      'walks up to 5 pages and filters client-side). Alternative pattern: ' +
      "read the connection id straight from the recipe's config " +
      '(pull_recipe version.config account_id entries) — often the better ' +
      'source when you already have the recipe. Slim response includes ' +
      '`count` for pagination decisions. Pass full=true for the raw 18-key ' +
      'per-item Workato shape. Requires an open Workato tab (*.workato.com ' +
      'or *.workato.is).',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Connection name substring search.',
        },
        provider: {
          type: 'string',
          description:
            'Exact provider/adapter name filter (case-insensitive), e.g. "salesforce", "netsuite". ' +
            'Applied client-side across up to 5 pages; response sets provider_filtered:true and pages_scanned.',
        },
        folder_id: {
          type: 'number',
          description: 'Numeric folder id to scope the search.',
        },
        page: {
          type: 'number',
          description: '1-based page number. Default 1. 20 items per page.',
          default: 1,
        },
        sort: {
          type: 'string',
          enum: ['latest_activity', 'name', 'updated_at'],
          description: 'Sort order. Default latest_activity.',
          default: 'latest_activity',
        },
        full: {
          type: 'boolean',
          description: 'If true, return raw Workato shape instead of slim shape.',
          default: false,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.GET_CONNECTION,
    description:
      'Fetch a single Workato connection by id. Returns metadata ' +
      '(id, name, provider, recipe_count, authorization_status, ' +
      'dates) plus a config object containing per-provider settings ' +
      'with secret-shaped keys/values stripped (auth tokens, passwords, ' +
      'API keys, JWTs, long opaque tokens). The strip applies even with ' +
      'full=true — there is no escape hatch for secrets. Requires an ' +
      'open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'number',
          description: 'Numeric Workato connection id.',
        },
        full: {
          type: 'boolean',
          description:
            'If true, return the secret-stripped raw response instead of the slim metadata+config shape.',
          default: false,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['connection_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.LIST_JOBS,
    description:
      "List jobs for a Workato recipe. Tool auto-walks Workato's cursor " +
      'pagination under the hood up to `limit` (default 25, max 100). When ' +
      '`cursor` is supplied, auto-walk begins from that job id (useful for ' +
      'resuming a previous fetch). Supports server-side filters: status ' +
      '(singular), query, started_at window, group_by_master_job. ' +
      'query is full-text: it matches the job title, error message, AND the ' +
      'custom job-report columns — so searching a record id (e.g. an asset ' +
      'or transaction id shown in the job report) finds its job directly. ' +
      'If the walk runs out of time mid-pagination the tool returns what it ' +
      'scanned with partial:true, scanned_through (timestamp) and next_cursor ' +
      'to resume — partial results are never discarded. Pass full=true for ' +
      'raw page responses instead of the slim shape. Requires an open Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id.',
        },
        limit: {
          type: 'number',
          description:
            'Max jobs to return. 1..100, default 25. Tool auto-walks Workato pagination cursor to fulfill.',
          default: 25,
          minimum: 1,
          maximum: 100,
        },
        status: {
          type: 'string',
          description:
            "Server-side status filter. Use 'failed', 'succeeded', 'pending', etc. SINGULAR — statuses[] is silently ignored.",
        },
        query: {
          type: 'string',
          description: 'Full-text search against job title and error message.',
        },
        started_at: {
          type: 'string',
          enum: ['7.days', '30.days', 'all'],
          description: 'Time window for job start time. Default behavior is server-defined.',
        },
        group_by_master_job: {
          type: 'boolean',
          description: 'Collapse retry chains under their master job.',
          default: false,
        },
        cursor: {
          type: 'string',
          description:
            'Job id to resume from. Pass the next_cursor from a previous response to page forward.',
        },
        full: {
          type: 'boolean',
          description: 'If true, return raw concatenated pages instead of the slim shape.',
          default: false,
        },
        timeout_ms: {
          type: 'number',
          description:
            'Overall timeout in milliseconds. Default 30000, clamped 10000–110000. The internal ' +
            'page-walk budget is timeout_ms minus ~8s headroom, so raising this lets one call scan ' +
            'deeper before returning partial results.',
          minimum: 10000,
          maximum: 110000,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.REPEAT_JOB,
    description:
      'Repeat (re-run) one or more Workato jobs by master job id. WRITE operation — ' +
      "each repeated job re-executes the recipe against that job's original trigger " +
      'data. job_ids are the string master job ids as returned by workato_list_jobs / ' +
      "workato_job_trace (e.g. 'j-Aaxc9bm4-egoMDh-CD'). Returns a per-job ok flag " +
      'from Workato. Not auto-retried on timeout (a blind retry could double-run ' +
      'jobs) — re-check with workato_list_jobs before retrying. Requires an open ' +
      'Workato tab.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description: 'Numeric Workato recipe id the jobs belong to.',
        },
        job_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
          description: "Master job ids to repeat, e.g. ['j-Aaxc9bm4-egoMDh-CD']. Max 50 per call.",
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['recipe_id', 'job_ids'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.RUN_QUERY,
    description:
      'Run a SQL-style query (SOQL, SuiteQL, or SQL) against any Workato ' +
      'connection. Returns {schema, rows} in a consistent shape regardless ' +
      'of underlying SaaS. Hard-capped at ~100 rows server-side; narrow via ' +
      'WHERE clause for more. SOQL queries: any trailing LIMIT clause is ' +
      'stripped before sending (Workato auto-appends LIMIT 100, so a ' +
      'user-supplied LIMIT would collide). connection_id is shared_account_id ' +
      'from search_connections or recipe.version.config. Read-only — never ' +
      'treat as a write API. Requires an open Workato tab (*.workato.com or ' +
      '*.workato.is).',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'number',
          description: 'Numeric Workato connection id (shared_account_id).',
        },
        query: {
          type: 'string',
          description:
            'The query body. For SOQL, do NOT include a LIMIT clause (Workato adds its own). For SuiteQL use NetSuite Analytics Browser syntax. For SQL, support depends on adapter.',
        },
        type: {
          type: 'string',
          enum: ['soql', 'suiteql', 'sql'],
          description:
            "Query dialect. 'soql' for Salesforce, 'suiteql' for NetSuite, 'sql' for some database adapters (not all support this).",
        },
        schema_only: {
          type: 'boolean',
          description: 'If true, return only field schema (drop rows). Default false.',
          default: false,
        },
        full: {
          type: 'boolean',
          description: 'If true, return the raw Workato result envelope instead of the slim shape.',
          default: false,
        },
        timeout_ms: {
          type: 'number',
          description:
            'Max time to wait for the query before aborting, in milliseconds. Default 90000 ' +
            '(90s). Clamped to 5000–110000. Raise this for slow connectors (e.g. NetSuite ' +
            'SuiteQL or large scans) that return "timed out after Ns and was aborted".',
          minimum: 5000,
          maximum: 110000,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['connection_id', 'query', 'type'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.CALL_ACTION,
    description:
      'Invoke any named connector action with arbitrary input via the same ' +
      "endpoint Workato's recipe editor uses for the Test button. " +
      '\n\n**MOST POWERFUL TOOL IN THE KIT — CAN MUTATE SAAS DATA.** ' +
      'Defaults to a read-only safety gate: action_name must start with ' +
      'search_/get_/list_/query_/find_/describe_/read_/fetch_, OR be exactly ' +
      "'execute_suiteql', OR be '__adhoc_http_action' with verb get/head/options. " +
      'Anything else (add_record, upsert_record, delete_*, POST/PUT/DELETE HTTP ' +
      'verbs, etc.) is rejected with WorkatoUnsafeAction unless caller passes ' +
      'allow_writes:true. Use that flag deliberately — it can create, modify, or ' +
      'delete real records in production SaaS. ' +
      '\n\nAction names come from inspecting recipe steps: every step in a ' +
      "recipe's code tree has a 'name' field that is a valid action_name. " +
      'Pull a representative recipe with workato_pull_recipe and read its ' +
      'step structure to learn what actions exist on a connector. Common ' +
      "names: '__adhoc_http_action' (any HTTP connector), 'execute_suiteql' " +
      "(NetSuite), 'search_sobjects_soql_v2' (Salesforce), 'add_record'/" +
      "'upsert_record'/'delete_record' (NetSuite — writes)." +
      '\n\nAD-HOC SOQL (the killer use case — query Salesforce through the ' +
      "recipe's own connection, no SFDC UI access needed): action_name " +
      "'search_sobjects_soql_v2' with minimal input {query:'SELECT Id FROM " +
      'Asset WHERE ...\', limit:100, output_schema:\'[{"name":"Id"}]\'}. ' +
      'output_schema is REQUIRED but need not match the selected fields — a ' +
      'one-field dummy schema works; all selected fields come back anyway. ' +
      'Omitting output_schema/limit makes Workato introspect the full object ' +
      'schema and the call usually times out (which looks like a wrong input ' +
      'shape but is not). Prefer workato_run_query(type:"soql") when you just ' +
      'need rows; call_action is for when you need the raw action behavior.',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: {
          type: 'number',
          description: 'Numeric Workato connection id.',
        },
        action_name: {
          type: 'string',
          description:
            "The action identifier (the 'name' field on a recipe step). E.g. 'execute_suiteql', '__adhoc_http_action', 'search_sobjects_soql_v2'.",
        },
        input: {
          type: 'object',
          description:
            "The action's input parameters as a JSON object. Shape is action-specific. For __adhoc_http_action: {mnemonic:'Custom action', verb, path, response_type:'json', inspect:true, request_headers?} — both `mnemonic` and `inspect:true` are REQUIRED; Workato rejects with \"'Action name' must be present\" if either is omitted. For execute_suiteql: {query}. For SOQL search: {query, output_schema, ...}.",
        },
        allow_writes: {
          type: 'boolean',
          description:
            'Required (true) for actions that look like writes. Default false. Loudly enables potentially destructive operations.',
          default: false,
        },
        full: {
          type: 'boolean',
          description:
            'If true, return the full Workato response envelope instead of just the result.',
          default: false,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
      },
      required: ['connection_id', 'action_name', 'input'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SNAPSHOT,
    description:
      'Capture an accessibility-tree snapshot of a tab and tag every interactive element with a [uid=N] marker. ' +
      'You MUST call this before chrome_snapshot_click/_fill/_hover — those tools resolve UIDs against the latest snapshot of the same tab.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SNAPSHOT_CLICK,
    description:
      'Click an element identified by a UID from the latest chrome_snapshot of this tab. ' +
      'Call chrome_snapshot first to obtain UIDs; stale UIDs will fail with an error asking you to re-snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'Element UID from the latest chrome_snapshot of this tab.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: ['uid'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SNAPSHOT_FILL,
    description:
      'Focus an element by UID (from the latest chrome_snapshot of this tab), select-all + clear its current value, then insert the provided text. ' +
      'UIDs come from chrome_snapshot. Call chrome_snapshot first.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'Element UID from the latest chrome_snapshot of this tab.',
        },
        value: {
          type: 'string',
          description: 'Text to insert into the focused element after clearing it.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: ['uid', 'value'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SNAPSHOT_HOVER,
    description:
      'Hover the mouse over an element identified by a UID from the latest chrome_snapshot of this tab. ' +
      'Useful for surfacing hover-triggered menus/tooltips before a subsequent click. Call chrome_snapshot first.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'Element UID from the latest chrome_snapshot of this tab.',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: ['uid'],
    },
  },
  {
    name: TOOL_NAMES.BROWSER.SNAPSHOT_WAIT_FOR,
    description:
      'Poll the accessibility tree until an element matching the given role and/or text appears (or timeout). ' +
      'On success, returns a fresh chrome_snapshot of the tab so you immediately have new UIDs to act on. ' +
      'Provide at least one of `role` or `text`.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Substring (case-insensitive) to match against accessible names.',
        },
        role: {
          type: 'string',
          description: 'Exact ARIA role to match (case-insensitive), e.g. "button", "link".',
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default 10000, max 120000).',
        },
        tabId: {
          type: 'number',
          description: 'Target tab ID. If omitted, uses the current active tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.OPEN_RECIPE,
    description:
      'Open a Workato recipe by ID. If a tab is already on this recipe, activates it; otherwise navigates the active Workato tab. ' +
      'Set mode="edit" to open directly in the editor (URL gets /edit suffix). ' +
      'Waits for the recipe toolbar to appear before returning.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Workato recipe ID (integer).' },
        mode: {
          type: 'string',
          enum: ['view', 'edit'],
          description: 'Open in view or edit mode (default: view).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: {
          type: 'number',
          description: 'Window ID to select active tab from (when tabId is omitted).',
        },
      },
      required: ['recipe_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.ENTER_EDIT_MODE,
    description:
      'Click the toolbar "Edit" button to enter the recipe editor. No-op if the URL is already /edit. ' +
      'Waits up to 8s for the "Save" button to appear before returning. ' +
      'Prerequisite: workato_ui_open_recipe must have been called (or a Workato recipe page is otherwise loaded).',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.LIST_STEPS,
    description:
      'List all steps on the currently open recipe as JSON: {number, label}. ' +
      "`label` is the trimmed text of each step's .recipe-step__title-container " +
      '(e.g. "Log message to Job report"). ' +
      'Useful right after workato_ui_open_recipe or after workato_ui_add_step to discover the newest step number. ' +
      'Works in both view and edit mode.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.FOCUS_STEP,
    description:
      'Click the step bubble with the given number to open its config panel on the right. ' +
      'Required before workato_ui_set_field / workato_ui_insert_datapill, which operate on the focused step.',
    inputSchema: {
      type: 'object',
      properties: {
        step_number: { type: 'number', description: 'Step number to focus (1-indexed).' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['step_number'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.ADD_STEP,
    description:
      'Insert a new step after step `after_step`. For kind="action" (default), drives the full picker chain: ' +
      '"Add step" -> "Action in app" -> select app -> select action. For other kinds (if/repeat/stop/handle_errors), ' +
      'only the menuitem click is performed. Returns the new step number. ' +
      'Prerequisite: recipe must be in edit mode (call workato_ui_enter_edit_mode first).',
    inputSchema: {
      type: 'object',
      properties: {
        after_step: {
          type: 'number',
          description:
            'Step number to insert after (1-indexed; uses 1 to insert after the trigger).',
        },
        app: {
          type: 'string',
          description:
            'App display name as shown in Workato (e.g. "Logger by Workato", "Salesforce", "NetSuite SOAP"). Case-insensitive substring match.',
        },
        action: {
          type: 'string',
          description:
            'Action display name within the chosen app. Case-insensitive substring match.',
        },
        kind: {
          type: 'string',
          enum: ['action', 'if', 'repeat', 'stop', 'handle_errors'],
          description: 'Step kind (default: action).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['after_step', 'app', 'action'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.SET_FIELD,
    description:
      'Set a field value on the currently focused step. Matches the field by visible label first (e.g. "Message"), ' +
      'then falls back to internal data-field-id (e.g. "message"). Handles CodeMirror, plain inputs, textareas, ' +
      'and contenteditable. Optional mode="formula"/"text" toggles the formula switcher. ' +
      'Prerequisite: caller must have focused the relevant step first via workato_ui_focus_step.',
    inputSchema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Field label (visible) or internal data-field-id. Label is tried first.',
        },
        value: { type: 'string', description: 'Value to write into the field.' },
        mode: {
          type: 'string',
          enum: ['text', 'formula'],
          description: 'Optionally toggle the text/formula switcher before writing.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.INSERT_DATAPILL,
    description:
      'Insert a datapill from `source_step` into the named field. First tries HTML5 drag emulation; if the field value ' +
      'does not change within 300ms, falls back to formula injection (=_dp(...)) by fetching the recipe code and ' +
      "reading the source step's line id + provider. " +
      'Prerequisite: caller must have focused the relevant step first via workato_ui_focus_step. ' +
      'NOTE: HTML5 synthetic drag is unreliable across Chrome versions — formula fallback is the production path.',
    inputSchema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Target field (label or data-field-id) on the currently focused step.',
        },
        source_step: {
          type: 'number',
          description: 'Step number whose output tree provides the pill.',
        },
        path: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Path through the source step\'s output tree to the leaf (e.g. ["body","id"]).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['field', 'source_step', 'path'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.SAVE_RECIPE,
    description:
      'Click "Save" and wait until the recipe\'s ng-dirty count drops to 0 (verified via DOM poll). ' +
      'Returns an error if validation errors appear or if dirty state does not clear within 10s. ' +
      'Prerequisite: recipe must be in edit mode with pending changes.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.EXIT_EDIT_MODE,
    description:
      'Click "Exit". If Workato pops a "Unsaved changes" confirm dialog, the `discard` flag picks which button to press: ' +
      'true -> discard/leave; false (default) -> cancel/stay. ' +
      'Prerequisite: recipe must be in edit mode.',
    inputSchema: {
      type: 'object',
      properties: {
        discard: {
          type: 'boolean',
          description:
            'If a confirm dialog appears, true=discard changes, false=stay (default false).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.CREATE_RECIPE,
    description:
      "Create a new Workato recipe via the live tab's authenticated session (POST /recipes.json). " +
      'Two modes: ' +
      '(1) pass `folder_id` to drop the recipe into an existing folder; ' +
      '(2) pass `project_name` (and omit `folder_id`) to first create a new project via ' +
      "POST /web_api/projects.json and then create the recipe in that project's folder. " +
      'Returns the new recipe id and edit URL. Prerequisite: the active tab must be a logged-in Workato page ' +
      '(needed to read the CSRF token and reuse the session cookie). The recipe is created in trigger-only ' +
      'state — open it in edit mode (workato_ui_open_recipe with mode="edit") to configure the trigger.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Recipe name (required).' },
        folder_id: {
          type: 'number',
          description:
            'Existing folder/project ID to create the recipe in. Mutually exclusive with project_name.',
        },
        project_name: {
          type: 'string',
          description:
            'If provided AND folder_id is omitted, a new project is created first and its folder_id is used.',
        },
        description: {
          type: 'string',
          description:
            'Optional description. When creating a project it is applied to the project; the recipe description defaults to empty.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_UI.SAVE_RECIPE_CODE,
    description:
      'Save a complete recipe code tree directly via the Workato REST API (PUT /recipes/<id>.json). ' +
      'Bypasses the UI entirely — no need to enter edit mode, focus steps, or drive the editor. ' +
      'Pair with workato_pull_recipe to fetch the current code, mutate it client-side, then save. ' +
      'For large recipes use the file round-trip: workato_pull_recipe(out_file:...) then save with ' +
      '[code_path] so the recipe tree never has to be passed inline. ' +
      'RUNNING RECIPES: Workato rejects code saves on running recipes — pass restart_if_running:true ' +
      'to have the tool stop → save → verify → restart atomically (response reports stopped_at + restarted). ' +
      'SAFETY: pass expected_base_version_no (the version_no you pulled) to refuse saving over someone ' +
      "else's concurrent edit; pass comment to annotate the new version in the same call. " +
      'If the save request times out, the tool verifies via version_no and a tree readback whether the ' +
      'save actually landed and reports save_status:"succeeded_after_timeout" instead of a false failure; ' +
      'retrying a save that already landed returns save_status:"already_applied" without creating a ' +
      'duplicate version. ' +
      'VERIFIED WRITES: every save is read back and compared against what was sent. Workato silently ' +
      'drops dynamic input keys (py_eval code_input.data, call_recipe parameters, custom_fields, ' +
      'data-table columns, declare_variable variables) on steps that lack a matching ' +
      'extended_input_schema — it answers 200 with empty code_errors and stores nothing. When that ' +
      'happens the tool FAILS with save_status:"persisted_incomplete" and names the dropped paths. ' +
      'Datapill payloads are also re-serialized compactly before saving, because Workato matches ' +
      "#{_dp('<json>')} byte-for-byte and a pill with json.dumps spacing resolves to an empty value. " +
      'Returns the new version_no plus any validation errors Workato emits about the saved tree. ' +
      'Targets the session pinned tab or any open Workato app tab (never whatever tab is focused).',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: {
          type: 'number',
          description:
            'Numeric Workato recipe id. Required unless [code_path] is given and the file ' +
            'contains a numeric recipe_id.',
        },
        code: {
          description:
            'Recipe code tree. Either a plain object (will be JSON.stringified) or an already-stringified JSON string. Same shape as workato_pull_recipe returns under .code. Provide this OR [code_path], not both.',
        },
        code_path: {
          type: 'string',
          description:
            'Absolute path to a recipe JSON file as written by workato_pull_recipe(out_file:...). ' +
            'When set, code/config/recipe_id are read from the file and [code]/[config] are ' +
            'ignored — the recipe tree never has to be passed inline. The agent-friendly push path.',
        },
        config: {
          description:
            'Optional config array (apps/connections used by the recipe). Either an array (will be JSON.stringified) or a stringified JSON. Ignored when [code_path] is set.',
        },
        name: {
          type: 'string',
          description: 'Optional new recipe name. Omit to leave unchanged.',
        },
        description: {
          type: 'string',
          description: 'Optional description. Omit to leave unchanged.',
        },
        restart_if_running: {
          type: 'boolean',
          description:
            'When the recipe is running: stop it, save, then start it again — one atomic call ' +
            'with the smallest possible trigger downtime. Response includes stopped_at and restarted. ' +
            'Without this flag, saving a running recipe fails fast with a clear error. ' +
            'This flag only restores what the save stopped — a recipe that was ALREADY stopped stays ' +
            'stopped (the response says so via was_running:false). Use ensure_running to start it.',
          default: false,
        },
        ensure_running: {
          type: 'boolean',
          description:
            'Start the recipe after a successful save even when it was already stopped before the ' +
            'call. Use it when the recipe must be live afterwards regardless of the state it was in.',
          default: false,
        },
        comment: {
          type: 'string',
          description:
            'Version comment to set on the newly created version (replaces a separate workato_set_version_comment call).',
        },
        expected_base_version_no: {
          type: 'number',
          description:
            'Optimistic lock: refuse to save when the current version_no differs from this value ' +
            '(someone else saved since you pulled). Pass the version_no from your pull_recipe call.',
        },
        verify_readback: {
          type: 'boolean',
          description:
            'Read the saved tree back and compare it against what was sent (default true). This is ' +
            'the silent-strip guard — turn it off only to push past a verification you have ' +
            'established is a false positive.',
          default: true,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.ADD_STEP,
    description:
      'Insert a new step into a Workato recipe via a single GET-mutate-PUT round-trip ' +
      '(GET /recipes/<id>/code.json then PUT /recipes/<id>.json). This is the high-level mutator that ' +
      'sits on top of workato_pull_recipe + workato_ui_save_recipe_code: one call per logical change, ' +
      'no manual code-tree manipulation. Generates a fresh `as` (8-char hex) and `uuid`, renumbers the ' +
      'block sequentially, deduplicates the `config` array of providers, and returns the new step number. ' +
      'Requires an open logged-in Workato tab (uses the session pinned tab or first Workato app tab — never whatever tab is focused).',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        after_step: {
          type: 'number',
          description:
            'Insert the new step after this step number. Use 0 to insert as the first action right after the trigger.',
        },
        provider: {
          type: 'string',
          description:
            'Connector/provider name, e.g. "logger", "salesforce", "netsuite". Becomes the step.provider field and is added to the recipe `config` array.',
        },
        action_name: {
          type: 'string',
          description:
            'Action name within the provider, e.g. "log_message", "search_sobjects_soql_v2". Becomes step.name.',
        },
        input: {
          type: 'object',
          description:
            'Optional initial field values for the new step (becomes step.input). Defaults to an empty object.',
        },
        keyword: {
          type: 'string',
          enum: ['action', 'if', 'repeat_each', 'stop', 'return_result'],
          description: 'Step keyword. Defaults to "action".',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['recipe_id', 'after_step', 'provider', 'action_name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.SET_STEP_INPUT,
    description:
      'Set an input field on an existing recipe step (GET /recipes/<id>/code.json, mutate, ' +
      'PUT /recipes/<id>.json). NESTED PATHS SUPPORTED: field accepts dotted paths like ' +
      '"parameters.sysid_param.asset_id" or "filters[0].value" — no file round-trip needed for ' +
      'one-field fixes deep in a step. Steps anywhere in the tree are reachable: step_number ' +
      'accepts the numeric step number (0 = trigger) OR the step `as` anchor string, and nested ' +
      'blocks (if / foreach / try) are searched recursively. Preserves all other fields. ' +
      'For datapill/formula values with validation, prefer workato_recipe_set_input_path. ' +
      'Requires a logged-in Workato browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        step_number: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description:
            'Step to modify: numeric step number (0 = trigger) or `as` anchor string (e.g. "c0a385ab"). Nested blocks are searched.',
        },
        field: {
          type: 'string',
          description:
            'Input field name or nested dotted path, e.g. "message" or "parameters.sysid_param.asset_id" or "filters[0].value". Missing intermediate objects/arrays are created.',
        },
        value: {
          description:
            'Value to write into the path. Accepts string, number, boolean, object, or array.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['recipe_id', 'step_number', 'field', 'value'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.MAP_DATAPILL,
    description:
      "Map a target step field to a datapill from another step's output (GET /recipes/<id>/code.json, " +
      'mutate, PUT /recipes/<id>.json). Builds the canonical Workato `=_dp(...)` formula from the source ' +
      "step's `as` (line id) and `provider`, then writes it into the target path. " +
      'NESTED PATHS SUPPORTED: target_field accepts dotted paths like "parameters.sysid_param.asset_id"; ' +
      'target_step/source_step accept step numbers (0 = trigger) or `as` anchor strings, and nested ' +
      'blocks are searched recursively. LIST PILLS: a path element "list_items[]" expands to ' +
      '"list_items" + {path_element_type:"current_item"} (referencing the foreach current item, e.g. ' +
      '"f95ce216.list_items[].AssetId" → source_step:"f95ce216", path:["list_items[]","AssetId"]); ' +
      'raw path objects also pass through unchanged. Requires a logged-in Workato browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        target_step: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description:
            'Step where the field being mapped lives: numeric step number (0 = trigger) or `as` anchor string.',
        },
        target_field: {
          type: 'string',
          description:
            'Field name or nested dotted path on the target step that will hold the datapill formula, e.g. "parameters.sysid_param.asset_id".',
        },
        source_step: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description:
            'Step whose output is being referenced: numeric step number (0 = trigger) or `as` anchor string. Must already have an `as` and `provider`.',
        },
        path: {
          type: 'array',
          items: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
          description:
            'Path into the source step output, e.g. ["records"] or ["body","id"]. "name[]" expands to ' +
            'name + {path_element_type:"current_item"}; raw objects (e.g. {path_element_type:"current_item"}) ' +
            'pass through as-is. Empty array references the root output.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['recipe_id', 'target_step', 'target_field', 'source_step', 'path'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.SET_INPUT_PATH,
    description:
      "Set a nested value inside an existing Workato recipe step's input via a native-server " +
      'pull-mutate-push round trip. NESTED PATHS are first-class here: the target step may be ' +
      'identified by step number or `as` anchor (nested blocks searched), and the path may be a ' +
      'dotted string such as `records.item.items[0].amount` or an array of string/number segments. ' +
      'Creates missing intermediate objects/arrays, refuses unsafe path segments and ' +
      'non-container parents, and preserves all unrelated code-tree fields. Supports literal values, ' +
      'formula strings, interpolated strings, and datapill specs — datapill shorthand ' +
      '`datapill(provider.line.list_items[].AssetId)` expresses current-item (foreach) pills. ' +
      'THE preferred tool for one-field fixes deep inside a step (no file round-trip needed). ' +
      'Accepts restart_if_running/ensure_running/comment/expected_base_version_no, forwarded to the ' +
      'underlying save (which verifies the readback and fails when Workato silently drops input keys). ' +
      'Requires a logged-in Workato browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        step: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Target step number or `as` anchor. Use 0 for the trigger if needed.',
        },
        path: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
          ],
          description:
            'Input path to set. Dotted strings support numeric indexes, e.g. `filters[0].field_id`.',
        },
        value: {
          description:
            'Value to write. For literal, any JSON value. For formula/interpolated, a string. For datapill, either a datapill object {provider,line,path,pill_type?} or shorthand such as `datapill(provider.line.output.rows[].id)`.',
        },
        value_kind: {
          type: 'string',
          enum: ['literal', 'datapill', 'formula', 'interpolated'],
          description:
            'How to encode value. Default literal. formula prefixes `=` when absent; datapill writes a text-mode #{_dp(...)} reference.',
        },
        restart_if_running: {
          type: 'boolean',
          description:
            'Forwarded to the underlying save: stop a running recipe, save, restart — one atomic call. ' +
            'A recipe that was already stopped stays stopped; use ensure_running to start it.',
          default: false,
        },
        ensure_running: {
          type: 'boolean',
          description:
            'Forwarded to the underlying save: start the recipe afterwards even if it was already stopped.',
          default: false,
        },
        comment: {
          type: 'string',
          description: 'Forwarded to the underlying save: version comment for the new version.',
        },
        expected_base_version_no: {
          type: 'number',
          description:
            'Optimistic lock forwarded to the save. Defaults to the version_no this call just pulled, so concurrent edits are refused automatically.',
        },
        verify_readback: {
          type: 'boolean',
          description:
            'Forwarded to the underlying save: read the stored tree back and fail when Workato ' +
            'silently dropped input keys (default true). Set false only to push past a ' +
            'verification you have established is a false positive.',
          default: true,
        },
        tabId: { type: 'number', description: 'Target tab ID for the final save (optional).' },
        windowId: { type: 'number', description: 'Window ID for the final save (optional).' },
      },
      required: ['recipe_id', 'step', 'path', 'value'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.DELETE_INPUT_PATH,
    description:
      "Delete a nested leaf from an existing Workato recipe step's input via a native-server " +
      'pull-mutate-push round trip. The target step may be identified by step number or `as` anchor. ' +
      'After deleting the leaf, empty parent objects/arrays along that path are pruned. Unrelated ' +
      'input branches are preserved. Requires a logged-in Workato browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        step: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Target step number or `as` anchor. Use 0 for the trigger if needed.',
        },
        path: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
          ],
          description: 'Input path to delete, e.g. `records.tranId` or `filters[0].field_id`.',
        },
        tabId: { type: 'number', description: 'Target tab ID for the final save (optional).' },
        windowId: { type: 'number', description: 'Window ID for the final save (optional).' },
      },
      required: ['recipe_id', 'step', 'path'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.SET_PY_EVAL_CODE,
    description:
      'Replace the `input.code` body of a Python by Workato action (`py_eval / invoke_custom_py_code`). ' +
      'Accepts either inline `code` or a local `code_path`; when `code_path` is used, the native server reads ' +
      'the file before pushing the recipe so the code body does not need to enter agent context. By default, ' +
      'the tool refuses non-py_eval targets; set validate_step=false only when intentionally writing a compatible custom step.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        step: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Target py_eval step number or `as` anchor.',
        },
        code: { type: 'string', description: 'Inline Python source to write to input.code.' },
        code_path: {
          type: 'string',
          description:
            'Absolute or relative local path on the bridge host. The native server reads it as UTF-8 and sends it as code.',
        },
        validate_step: {
          type: 'boolean',
          description: 'When false, skip the default provider/name check. Default true.',
        },
        tabId: { type: 'number', description: 'Target tab ID for the final save (optional).' },
        windowId: { type: 'number', description: 'Window ID for the final save (optional).' },
      },
      required: ['recipe_id', 'step'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_RECIPE.SET_EXTENDED_SCHEMA,
    description:
      'Set an explicit `extended_input_schema` or `extended_output_schema` array on a Workato recipe step. ' +
      'This centralizes a common silent-strip risk when structured inputs or referenced outputs require schema metadata. ' +
      'This first version accepts only an explicit schema array; it does not infer schemas automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'number', description: 'Numeric Workato recipe id.' },
        step: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: 'Target step number or `as` anchor.',
        },
        kind: {
          type: 'string',
          enum: ['extended_input_schema', 'extended_output_schema'],
          description: 'Schema property to replace on the target step.',
        },
        schema: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Full Workato schema array to write. Each entry is preserved as provided.',
        },
        tabId: { type: 'number', description: 'Target tab ID for the final save (optional).' },
        windowId: { type: 'number', description: 'Window ID for the final save (optional).' },
      },
      required: ['recipe_id', 'step', 'kind', 'schema'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.TABLES_LIST,
    description:
      'List all Workato lookup tables visible to the signed-in user (GET /lookup_tables.json). ' +
      'Returns a slim shape: [{id, name, entry_count, updated_at}]. ' +
      'Requires an open logged-in Workato tab (uses the session pinned tab or first Workato app tab — never whatever tab is focused).',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.TABLE_GET,
    description:
      'Fetch a single lookup table with its columns and rows (GET /lookup_tables/<id>.json). ' +
      'Internally maps col1..col10 to the user-facing column labels, so the response is keyed by label. ' +
      'Returns {id, name, columns: [{name: label, position: 1..10}], rows: [{id, ...by-label}], total_count, page, per_page}. ' +
      'Supports pagination (page, per_page) and a server-side full-text filter (qterm). ' +
      'Lookup tables have at most 10 columns. Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        page: { type: 'number', description: 'Page number (1-based). Optional.' },
        per_page: { type: 'number', description: 'Rows per page. Optional.' },
        qterm: {
          type: 'string',
          description: 'Server-side full-text filter applied to rows. Optional.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.TABLE_CREATE,
    description:
      'Create a new lookup table (POST /lookup_tables.json), then optionally rename and apply a column schema. ' +
      'If `name` is provided, a PUT /lookup_tables/<id>.json sets the name. ' +
      'If `columns` is provided (1–10 user-facing labels), a PUT /lookup_tables/<id>/update_schema.json applies them, ' +
      'padding the remaining slots with placeholders. Returns {table_id, name, columns}. ' +
      'Lookup tables always have exactly 10 column slots internally. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'New table name. Defaults to "Untitled lookup table".',
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional initial column labels (1–10). Each becomes the user-facing name for col1..colN; remaining slots are padded with placeholders.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.TABLE_RENAME,
    description:
      'Rename an existing lookup table (PUT /lookup_tables/<id>.json with {name}). Returns {id, name}. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        name: { type: 'string', description: 'New name (non-empty).' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.TABLE_SET_COLUMNS,
    description:
      "Replace a lookup table's column schema (PUT /lookup_tables/<id>/update_schema.json). " +
      'Accepts 1–10 user-facing column labels; internally builds the full 10-slot schema by padding with ' +
      '"Untitled column N" placeholders (sticky=false). Returns {table_id, columns}. ' +
      'Lookup tables have a fixed 10-column limit. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description:
            '1–10 user-facing column labels. The first N slots are named; the rest are padded with placeholders.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'columns'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.TABLE_DELETE,
    description:
      'Delete a lookup table (DELETE /lookup_tables/<id>.json). Returns {table_id, deleted: true}. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.ROW_CREATE,
    description:
      'Add a row to a lookup table (POST /lookup_tables/<id>/add_row.json). ' +
      "Accepts `row` keyed by the table's user-facing column labels; internally fetches the table once to " +
      'learn the label→col1..col10 mapping, then builds the full 10-key data object (missing columns are null). ' +
      'Returns {table_id, row_id, row} where `row` is keyed by label. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        row: {
          type: 'object',
          description:
            'Row values keyed by user-facing column label (e.g. {"Email": "a@b", "Country": "US"}). Missing columns are sent as null. Only labels that match the table\'s schema are kept.',
          additionalProperties: true,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'row'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.ROW_UPDATE,
    description:
      'Update an existing row in a lookup table (PUT /lookup_tables/<id>/update_row.json). ' +
      'Accepts a partial `row` keyed by label; the tool fetches the existing row, merges the provided fields ' +
      'over it, and writes the full 10-key data object back (Workato requires all col1..col10 in update payloads). ' +
      'Returns {table_id, row_id, row} keyed by label. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        row_id: { type: 'number', description: 'Numeric row id (from a prior get/search).' },
        row: {
          type: 'object',
          description:
            'Partial row keyed by user-facing column label. Only provided labels are overwritten; the rest are preserved from the current row.',
          additionalProperties: true,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'row_id', 'row'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.ROW_DELETE,
    description:
      'Delete a row from a lookup table (DELETE /lookup_tables/<id>/delete_row.json?row_id=<row_id>). ' +
      'Returns {table_id, row_id, deleted: true}. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        row_id: { type: 'number', description: 'Numeric row id.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'row_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.ROW_UPSERT,
    description:
      'Create-or-update one lookup-table row, keyed by a column value. The tool for ' +
      'per-environment config: lookup tables do not carry across dev/test/prod, so the same ' +
      'keyed rows get re-applied on every deploy, and doing that with row_create plus a manual ' +
      'search is how duplicate keys appear. A duplicate is not harmless — the `lookup()` formula ' +
      'returns the FIRST match, so a stale row silently wins. ' +
      'Searches the whole table (all pages) for rows whose key_column equals key_value: none ' +
      'creates, exactly one updates (merging, so columns you do not name keep their values), ' +
      'and MORE THAN ONE IS REFUSED with the offending row ids rather than picking one. ' +
      'Returns {table_id, row_id, action:"created"|"updated", changed_columns, row}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        key_column: {
          type: 'string',
          description: 'Column LABEL whose value identifies the row, e.g. "Key".',
        },
        key_value: {
          type: ['string', 'number', 'boolean'],
          description:
            'Value to match in key_column. Compared exactly, as a string — lookup tables are ' +
            'case-sensitive.',
        },
        values: {
          type: 'object',
          description:
            'Column-label-keyed values to write, e.g. {"Value":"true","Notes":"set 2026-08-26"}. ' +
            'Columns not named here keep their current value. The key column is written for you.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'key_column', 'key_value'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.ROW_SEARCH,
    description:
      'Server-side text search across rows of a lookup table (GET /lookup_tables/<id>.json?qterm=...). ' +
      'Returns the same shape as workato_lookup_table_get: {id, name, columns, rows, total_count, page, per_page} ' +
      'with rows keyed by user-facing column label. Supports optional page / per_page pagination. ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        qterm: { type: 'string', description: 'Server-side full-text query.' },
        page: { type: 'number', description: 'Page number (1-based). Optional.' },
        per_page: { type: 'number', description: 'Rows per page. Optional.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'qterm'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LOOKUP.IMPORT_CSV,
    description:
      'Bulk-import rows into a Workato Lookup Table from a CSV file (PUT /lookup_tables/<id>/upload.json, multipart). ' +
      'TWO WAYS to provide the CSV — **prefer `csv_path` for files on disk** so the file content stays out of agent context: ' +
      '(1) `csv_path` — absolute path on the bridge host; the bridge reads the file via GET /file and streams it. ' +
      '(2) `csv_content` — inline CSV string for ad-hoc small imports. ' +
      'Two modes: ' +
      '`mode="append"` (DEFAULT, safe) preserves existing rows and adds the CSV rows after them. ' +
      '`mode="replace"` wipes all existing rows first, then inserts. ' +
      'If your CSV has a header row, set `skip_first_row=true` so it is not imported as data. ' +
      'Column order in the CSV is positional (maps to col1, col2, ...). ' +
      'Limits: up to 10 columns and 100,000 rows per table. ' +
      'Returns {table_id, name, entry_count, columns, first_rows} where first_rows is a label-keyed preview (~20 rows). ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'number', description: 'Numeric lookup-table id.' },
        csv_path: {
          type: 'string',
          description:
            'Absolute file path on the BRIDGE HOST (the machine running the native-server). The bridge reads the file via GET /file and streams content — agent never materializes it in context. Mutually exclusive with csv_content.',
        },
        csv_content: {
          type: 'string',
          description:
            'Inline CSV string (alternative to csv_path). Use only for small ad-hoc imports — large files will bloat agent context. Cells with commas/quotes must be RFC-4180-quoted.',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description:
            'Import mode. `append` (default) preserves existing rows; `replace` wipes them first. Use replace deliberately — it is destructive.',
        },
        skip_first_row: {
          type: 'boolean',
          description:
            'When true, skips the first row of the CSV (treats it as a header). Default false — every row is imported. Set to true when your CSV starts with column names like "name,color".',
        },
        filename: {
          type: 'string',
          description:
            'Optional filename to send in the multipart part. Defaults to "data.csv" or, when csv_path is used, the basename of the path.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.TABLES_LIST,
    description:
      'List Workato Data Tables in a project folder (GET /web_api/mixed_assets.json filtered to data-table assets). ' +
      'Data Tables are the newer relational store (distinct from the older Lookup Tables at /lookup_tables/). ' +
      'Returns a slim shape: [{id, name, folder_id, total_entries_count, updated_at}]. ' +
      'If folder_id is omitted, the tool falls back to the folder visible in the current Workato URL (best-effort). ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'number',
          description:
            'Numeric folder id to list data tables under. Optional — falls back to the folder in the current URL when possible.',
        },
        page: { type: 'number', description: 'Page number (1-based). Optional.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_GET,
    description:
      'Fetch a Data Table with its columns (GET /web_api/workato_db/tables/<id>.json). ' +
      'Returns {id, name, table_id_uuid, folder_id, columns: [{name, type, id, hidden, read_only}], total_entries_count}. ' +
      'System columns (Record ID, Created time, Last modified time) are hidden by default; pass include_system=true to include them.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        include_system: {
          type: 'boolean',
          description:
            'When true, also returns the 3 system columns (Record ID, Created time, Last modified time). Default false.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_CREATE,
    description:
      'Create a new Data Table (POST /web_api/workato_db/tables.json) and optionally add user columns via a follow-up schema PUT. ' +
      'The server auto-seeds 3 system columns (Record ID, Created time, Last modified time); when `columns` is provided, the tool GETs ' +
      'the new table, appends the user columns (only {type,title} needed), and PUTs the full schema back. ' +
      'Column types: short-text, long-text, integer, decimal, boolean, date, date-time, file, multi-value, link-to-table. ' +
      'Returns {table_id, name, folder_id, columns}.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'New data-table name (non-empty).' },
        folder_id: { type: 'number', description: 'Numeric folder id to create the table under.' },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Column title.' },
              type: {
                type: 'string',
                description:
                  'Column type: short-text (default), long-text, integer, decimal, boolean, date, date-time, file, multi-value, link-to-table.',
              },
            },
            required: ['name'],
          },
          description: 'Optional user columns to create after the table is provisioned.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['name', 'folder_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_RENAME,
    description:
      'Rename a Data Table (PUT /web_api/workato_db/tables/<id>.json with {name}). Returns {table_id, name}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        name: { type: 'string', description: 'New name (non-empty).' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.TABLE_DELETE,
    description:
      'Delete a Data Table (DELETE /web_api/workato_db/tables/<id>.json). Returns {table_id, deleted: true}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.ADD_COLUMN,
    description:
      'Append a column to a Data Table by GETting the current schema, appending the new entry, and PUTting the full schema back. ' +
      'Default type is short-text. Returns {table_id, column_id, name, type}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        name: { type: 'string', description: 'New column title (non-empty).' },
        type: {
          type: 'string',
          description:
            'Column type: short-text (default), long-text, integer, decimal, boolean, date, date-time, file, multi-value, link-to-table.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.UPDATE_COLUMN,
    description:
      'Rename and/or retype an existing user column (full-schema PUT). Identify the column by column_name OR column_id. ' +
      'At least one of `name` or `type` must be provided. System columns are protected. Returns {table_id, column_id, name, type}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        column_name: {
          type: 'string',
          description: 'Existing column title to update (provide this OR column_id).',
        },
        column_id: {
          type: 'string',
          description: 'Existing column UUID to update (provide this OR column_name).',
        },
        name: { type: 'string', description: 'New column title. Optional.' },
        type: {
          type: 'string',
          description:
            'New column type. Optional. Must be one of: short-text, long-text, integer, decimal, boolean, date, date-time, file, multi-value, link-to-table.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.DELETE_COLUMN,
    description:
      'Delete a user column from a Data Table (full-schema PUT omitting the column). Identify by column_name OR column_id. ' +
      'Refuses to delete the 3 system columns (Record ID, Created time, Last modified time). Returns {table_id, column_id, deleted: true}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        column_name: {
          type: 'string',
          description: 'Existing column title to delete (provide this OR column_id).',
        },
        column_id: {
          type: 'string',
          description: 'Existing column UUID to delete (provide this OR column_name).',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.ROW_LIST,
    description:
      'Query rows in a Data Table (POST /web_api/workato_db/tables/<id>/records/query.json). ' +
      'Supports order_by_column (user-facing label, default "Created time"), direction (asc|desc, default desc), ' +
      'limit (default 100), and continuation_token for pagination. Returns rows keyed by user-facing column label ' +
      '(plus a `Record ID` field carrying the row UUID).',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        order_by_column: {
          type: 'string',
          description: 'Column title to sort by. Defaults to "Created time".',
        },
        direction: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction. Default desc.',
        },
        limit: { type: 'number', description: 'Max rows to return. Default 100.' },
        continuation_token: {
          type: 'string',
          description: 'Opaque cursor returned by a prior page. Optional.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.ROW_CREATE,
    description:
      'Insert a row into a Data Table (POST /web_api/workato_db/tables/<id>/records.json). ' +
      "Accepts `row` keyed by the table's user-facing column labels; the tool fetches the schema to resolve " +
      'label->UUID, then sends a UUID-keyed body. Returns {table_id, record_id, row} where `row` is label-keyed.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        row: {
          type: 'object',
          description:
            'Row values keyed by user-facing column label. Only labels matching the table schema are sent.',
          additionalProperties: true,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'row'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.ROW_UPDATE,
    description:
      'Update a row in a Data Table (PUT /web_api/workato_db/tables/<id>/records/<record_id>.json). ' +
      'Accepts a partial label-keyed `row`; only provided fields are sent (UUID-keyed). ' +
      'Returns {table_id, record_id, row}. NOTE: endpoint is inferred — verify on smoke test.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        record_id: {
          type: 'string',
          description: 'Row UUID (the "Record ID" value of the target row).',
        },
        row: {
          type: 'object',
          description:
            'Partial row keyed by user-facing column label. Only provided labels are updated.',
          additionalProperties: true,
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'record_id', 'row'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_DATA_TABLE.ROW_DELETE,
    description:
      'Delete one or more rows from a Data Table (POST /web_api/workato_db/tables/<id>/records/delete_batch.json). ' +
      'Accepts a single record id (string) or an array of ids. Returns {table_id, record_ids, deleted: true}.',
    inputSchema: {
      type: 'object',
      properties: {
        table_id: { type: 'string', description: 'Data Table id (UUID string).' },
        record_ids: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Row UUID, or array of row UUIDs, to delete.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
      required: ['table_id', 'record_ids'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_SESSION.WHOAMI,
    description:
      'Returns who/where the active Workato tab is connected — workspace, user, role, ' +
      'available environments, teams, timezone, membership tier. Fetches /web_api/auth_user.json ' +
      'and slims it down to an agent-friendly JSON shape. ' +
      "Use this FIRST when you don't know which Workato workspace/account/environment " +
      'the agent is currently connected to (especially when the user has multiple ' +
      'Workato accounts open in different tabs). ' +
      'Prerequisite: the active tab must be a logged-in Workato page.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab.',
        },
        windowId: { type: 'number', description: 'Window ID (when tabId omitted).' },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKATO.LIST_PROFILES,
    description:
      'List all currently active/connected Chrome profiles (e.g. "prod", "staging", "dev") ' +
      'and see which one is selected for this MCP session, if any.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.SWITCH_PROFILE,
    description:
      'Switch the active profile context for this MCP session. All subsequent tool calls in ' +
      'this session will automatically route to the selected browser profile unless an individual ' +
      'call passes its own profile argument. Optionally pins subsequent Workato tools to a ' +
      'specific Workato tab id so browser focus changes do not retarget the session.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          description:
            'The name of the connected profile to switch context to (e.g. "prod", "staging", "dev").',
        },
        tabId: {
          type: 'number',
          description:
            'Optional Workato tab id to pin for this MCP session. Get it from get_windows_and_tabs.',
        },
      },
      required: ['profile'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.APPS_LIST,
    description:
      'List the Workflow Apps (LCAP) in the current workspace: id, name, project_id, unique_id, ' +
      'live. Read-only. There is no endpoint that lists the PAGES in an app - page ids come from ' +
      "the builder URL (app.workato.com/lcap/pages/<id>) or the project's asset view. Requires " +
      'an open Workato tab in the right workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.PAGE_GET,
    description:
      'Read a Workflow App page. Read-only. Returns page metadata (name, path, folder, ' +
      'updated_at, page variables, pageLoad handler) plus a widget INDEX: one row per widget ' +
      'with id, type, name, x, width, row, owning container, which handler slots are wired, the ' +
      'bound app-function recipe id, and whether `visible` is conditional. The index is the ' +
      'default because a real page is 6 KB+ of JSON and most reads only need to know what is on ' +
      "the page. Pass view:'full' for the raw `content` tree, or out_file to write " +
      '{page_id, updated_at, content} to disk and keep the tree out of the context entirely - ' +
      'edit that file and push it back with workato_lcap_page_save(content_path). Save the ' +
      'returned updated_at and pass it as expected_updated_at when you save.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: {
          type: 'number',
          description:
            'Numeric page id, from the builder URL app.workato.com/lcap/pages/<page_id>.',
        },
        view: {
          type: 'string',
          enum: ['index', 'full'],
          description:
            "'index' (default) returns metadata plus the widget index. 'full' adds the raw " +
            'content tree.',
        },
        out_file: {
          type: 'string',
          description:
            'Absolute path to write {page_id, updated_at, content} as JSON. The tree never ' +
            'enters the response; the widget index still does.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.PAGE_SAVE,
    description:
      "Replace a Workflow App page's content tree (PUT is whole-tree; there is no partial " +
      'update). WRITE. Guards, all of them earned: (1) refuses while the page builder is open ' +
      "on that page, because the builder's Save overwrites with its cached tree - the symptom " +
      'is "saved fine, changes vanished"; (2) refuses when a widget id present in the stored ' +
      'page is missing from yours (ids are the address datapills use) unless ' +
      'allow_widget_removal; (3) refuses a row collapse - removing a widget without renumbering ' +
      "the rows of what remains drops the following containers' computed `top` so they all " +
      'stack at 0, while the JSON reads back perfectly - unless allow_row_collapse; (4) allows ' +
      'moving widgets onto one row (fields side by side is ordinary layout work), warning only ' +
      'when the merged widths sum past the 12 column grid - the renderer stacks those rather ' +
      'than overlapping them, so it is a "did you mean that", not a refusal; (5) refuses ' +
      'an unknown `visible` opcode or wrong arity (opcodes are 1-14, 1-10 binary, 11-14 unary); ' +
      '(6) refuses a _dp() payload that is not valid JSON, and compacts the ones that are; ' +
      '(7) after the PUT it opens the page in a background tab and checks the RENDERED geometry, ' +
      'reporting render_check passed/failed - the JSON is valid in the stacking failure, so ' +
      'this is the only real proof. Pass expected_updated_at (from page_get) for optimistic ' +
      'locking.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Numeric page id.' },
        content: {
          type: 'object',
          description:
            'The complete replacement content tree: {type,maxWidth,spacing,background,variables,' +
            'handlers,layout}. Provide this OR content_path.',
        },
        content_path: {
          type: 'string',
          description:
            'Absolute path to a JSON file holding the tree, or a {content:...} envelope as ' +
            'written by workato_lcap_page_get(out_file). Resolved in the native-server, so the ' +
            'tree never passes through the tool call.',
        },
        expected_updated_at: {
          type: 'string',
          description:
            "Optimistic lock: refuse if the stored page's updated_at differs. Pass the value " +
            'workato_lcap_page_get returned.',
        },
        allow_widget_removal: {
          type: 'boolean',
          description:
            'Permit widgets present in the stored page to be absent from this tree. Only when ' +
            'the deletion is intended: every datapill pointing at a removed id resolves empty.',
        },
        allow_row_collapse: {
          type: 'boolean',
          description:
            "Permit a layout's row extent to shrink after a removal. Check render_check in the " +
            'response when you use this.',
        },
        force: {
          type: 'boolean',
          description: 'Save even though the page builder is open on this page.',
        },
        skip_render_check: {
          type: 'boolean',
          description:
            'Skip the post-save render probe (it opens and closes a background tab). Only for ' +
            'batched writes where a later save will be checked.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.PAGE_VALIDATE,
    description:
      'Check a Workflow App page without writing anything. Read-only. With page_id: runs the ' +
      'static checks over the stored tree AND opens the page in a background tab to check the ' +
      'rendered geometry (every top level widget must carry a `top:`; no two may share a ' +
      'bounding-box y). With content (or content_path): static checks only - layout shape, ' +
      'widget id format and duplicates, `visible` opcodes and arity, broken _dp payloads. Use ' +
      'this to diagnose "the page looks wrong but the JSON is fine", which is the signature of ' +
      'the row-collapse bug.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: {
          type: 'number',
          description: 'Validate the stored page (static checks plus the render probe).',
        },
        content: {
          type: 'object',
          description:
            'Validate a tree in hand. With page_id, also diffed against the stored page.',
        },
        content_path: { type: 'string', description: 'Path to a JSON file holding the tree.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.WIDGET_PATCH,
    description:
      'Change presentational properties of ONE widget on a Workflow App page. WRITE, but the ' +
      'safe subset: it reads the page, edits that widget, and saves through the same guards as ' +
      'workato_lcap_page_save (builder-open, id preservation, row integrity, datapills, render ' +
      'check). Allowed: label, hint, placeholder, text, alignment, color, title, description, x, ' +
      'width, displayedRowsCount, allowRowCreation, allowRowDeletion, forbidEmptyRows, ' +
      'addRowButtonText, columnsSettings, options, enabled, style, padding, margin, ' +
      'backgroundColor, borderColor, pillsSupportMarkdown, multiValue, editable, name. REFUSES ' +
      'id, type, handlers, appFunctionOptions, visible, layout, dataSource, validations - those ' +
      'carry bindings or addresses and belong in a reviewed full-tree save. Most polish work is ' +
      'exactly this list, and doing it by rewriting the whole tree is what creates the chance to ' +
      'break the layout.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Numeric page id.' },
        widget_id: {
          type: 'string',
          description: "The widget's 8-hex id, from the index workato_lcap_page_get returns.",
        },
        props: {
          type: 'object',
          description: 'Properties to overwrite, e.g. {"label":"Post to NetSuite","width":6}.',
        },
        expected_updated_at: {
          type: 'string',
          description: 'Optimistic lock, as in workato_lcap_page_save.',
        },
        force: { type: 'boolean', description: 'Patch even though the builder is open.' },
        skip_render_check: { type: 'boolean', description: 'Skip the post-save render probe.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
      required: ['page_id', 'widget_id', 'props'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.PAGE_CREATE,
    description:
      'Create a Workflow App page in a folder. WRITE. Defaults to a valid empty page ' +
      '([1] layout) when no content is given, so the usual flow is create then page_save with ' +
      'the real tree. Note Workato regenerates `path` from `name`, so the path you pass is ' +
      'advisory. Returns the new page id and its builder URL.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'number',
          description: "Numeric id of the Workflow App's folder (its project asset folder).",
        },
        name: { type: 'string', description: 'Page name. Stored verbatim, markdown included.' },
        path: { type: 'string', description: 'Advisory: Workato regenerates it from `name`.' },
        content: {
          type: 'object',
          description: 'Initial content tree. Defaults to an empty page.',
        },
        content_path: { type: 'string', description: 'Path to a JSON file holding the tree.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
      required: ['folder_id', 'name'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO_LCAP.PAGE_DELETE,
    description:
      'Permanently delete a Workflow App page. WRITE, no undo - requires confirm:true, and only ' +
      'call it when the user explicitly asked. A deleted page takes its widget ids with it, so ' +
      'anything bound to them is gone too.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Numeric page id.' },
        confirm: { type: 'boolean', description: 'Must be exactly true. There is no undo.' },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
      required: ['page_id', 'confirm'],
    },
  },
  {
    name: TOOL_NAMES.WORKATO.API_REQUEST,
    description:
      "ESCAPE HATCH: issue an arbitrary request to the Workato app host under the user's " +
      'logged-in session. Use it only for endpoints no dedicated tool covers yet - the ' +
      'dedicated tools carry guards (silent-strip detection, datapill normalization, row ' +
      'integrity, render checks) that this one has none of. Same-origin only: `path` is a path ' +
      'on the Workato host, never a URL elsewhere. Sends x-requested-with automatically and ' +
      'attaches x-csrf-token from the XSRF-TOKEN-V2 cookie on writes; the token is never ' +
      'returned. Anything other than GET/HEAD needs allow_writes:true. A 404 on a /web_api/ ' +
      'path usually means the tab is in the wrong workspace or environment, not that the object ' +
      'is missing.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
          description: 'HTTP method. Default GET.',
        },
        path: {
          type: 'string',
          description:
            'Path on the Workato app host, e.g. "/web_api/lcap/pages/61604.json" or ' +
            '"/integrations/meta". Must start with "/"; an absolute URL is refused.',
        },
        query: {
          type: 'object',
          description: 'Query parameters, appended to the path. Values are stringified.',
        },
        body: {
          description:
            'Request body. An object is JSON-serialized with content-type: application/json; a ' +
            'string is sent verbatim.',
        },
        headers: {
          type: 'object',
          description:
            'Extra request headers, merged over the defaults. x-requested-with cannot be ' +
            'removed - Workato /web_api routes require it.',
        },
        allow_writes: {
          type: 'boolean',
          description: 'Required for POST/PUT/PATCH/DELETE. No endpoint-specific guards run here.',
        },
        out_file: {
          type: 'string',
          description:
            'Absolute path to write the raw response body to. Use it for large responses ' +
            'instead of raising max_bytes.',
        },
        max_bytes: {
          type: 'number',
          description:
            'Response body cap before truncation. Default 20000, clamped 512-200000. A ' +
            'truncated body is returned as text, unparsed, with truncated:true.',
        },
        tabId: {
          type: 'number',
          description:
            'Target Workato tab ID. Omit to use the session pinned tab or first app tab. Pass ' +
            'this together with `profile` - an omitted profile resolves against the default ' +
            'Chrome profile and reports "Tab not found" for a tab that exists.',
        },
        timeout_ms: {
          type: 'number',
          description: 'In-page fetch timeout. Default 30000, clamped 10000-110000.',
        },
      },
      required: ['path'],
    },
  },
];
