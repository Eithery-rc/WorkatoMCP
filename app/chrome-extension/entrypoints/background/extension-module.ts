/**
 * The extension side of a module.
 *
 * Core never imports a module: the installed modules come from
 * ./modules/index.ts (the one wiring point) and core uses them only through
 * this interface. Every module's executors are compiled into the extension.
 */

import type { ToolResult } from '@/common/tool-handler';

export interface ModuleToolExecutor {
  name: string;
  execute(args: any): Promise<ToolResult>;
}

export interface ExtensionModule {
  /** Same id as the shared module descriptor and the bridge module. */
  id: string;
  title: string;
  executors: ModuleToolExecutor[];
  /**
   * Runs on the result of each of this module's tools before it goes back to
   * the bridge (Workato: append the tab's workspace context block). Must
   * never turn a successful call into a failure.
   */
  afterCall?(name: string, args: any, result: ToolResult): Promise<ToolResult>;
}
