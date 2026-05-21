# Universal Recipe Mutators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic Workato recipe code-tree mutator tools that remove repeated ad hoc recipe-edit scripts.

**Architecture:** Implement mutation orchestration in the native server: pull full recipe, mutate parsed code, push through the existing save tool. Keep pure mutation behavior in a small tested module and expose tool schemas through the shared package.

**Tech Stack:** TypeScript, Jest for native-server tests, Vitest for extension tests, WorkatoMCP shared tool schemas.

---

## File Structure

- Create `app/native-server/src/mcp/workato-recipe-mutators.ts`: pure mutation helpers and native orchestration.
- Create `app/native-server/src/mcp/workato-recipe-mutators.test.ts`: Jest coverage for path mutation, datapill formatting, schema setting, py_eval code, and orchestration helpers.
- Modify `app/native-server/src/mcp/register-tools.ts`: intercept new native recipe mutator tool names before forwarding to the extension.
- Modify `app/native-server/src/mcp/workato-file-io.ts`: recognize `workato_recipe_set_py_eval_code(code_path)` and replace it with inline `code`.
- Modify `app/native-server/src/mcp/workato-file-io.test.ts`: cover py_eval file loading.
- Modify `packages/shared/src/tools.ts`: add new tool names and schemas.
- Modify `app/chrome-extension/entrypoints/background/tools/workato/pull-recipe.ts`: make `step + view:"full"` return a raw step node.

## Tasks

### Task 1: Native Mutation Engine

**Files:**

- Create: `app/native-server/src/mcp/workato-recipe-mutators.ts`
- Test: `app/native-server/src/mcp/workato-recipe-mutators.test.ts`

- [ ] Write failing Jest tests for `parseInputPath`, nested set/delete, datapill conversion, py_eval validation, and schema setting.
- [ ] Run `pnpm --filter workatomcp-bridge test -- workato-recipe-mutators.test.ts` and confirm the tests fail because the module does not exist.
- [ ] Implement the pure helpers and exported `mutateRecipeCode(name, args, code)` function.
- [ ] Re-run the same Jest command and confirm the tests pass.

### Task 2: Native Orchestration

**Files:**

- Modify: `app/native-server/src/mcp/workato-recipe-mutators.ts`
- Modify: `app/native-server/src/mcp/register-tools.ts`
- Test: `app/native-server/src/mcp/workato-recipe-mutators.test.ts`

- [ ] Add failing tests for parsing pull/save `CallToolResult` payloads and formatting the final mutator result.
- [ ] Run the targeted Jest command and confirm failure.
- [ ] Implement `isWorkatoRecipeMutatorTool` and `handleWorkatoRecipeMutatorCall`.
- [ ] Wire `register-tools.ts` to call the native handler before proxying to the extension.
- [ ] Re-run the targeted Jest command and confirm pass.

### Task 3: File Preprocessing for Python Code

**Files:**

- Modify: `app/native-server/src/mcp/workato-file-io.ts`
- Modify: `app/native-server/src/mcp/workato-file-io.test.ts`

- [ ] Add a failing Jest test showing `workato_recipe_set_py_eval_code` reads `code_path`, places file contents in `code`, and removes `code_path`.
- [ ] Run `pnpm --filter workatomcp-bridge test -- workato-file-io.test.ts` and confirm failure.
- [ ] Implement the preprocessing path.
- [ ] Re-run the same Jest command and confirm pass.

### Task 4: Shared Tool Schemas

**Files:**

- Modify: `packages/shared/src/tools.ts`

- [ ] Add tool-name constants for the four new mutators.
- [ ] Add schemas with integration-neutral descriptions and JSON types.
- [ ] Run `pnpm --filter workatomcp-shared build` and confirm TypeScript compiles.

### Task 5: Raw Step Retrieval

**Files:**

- Modify: `app/chrome-extension/entrypoints/background/tools/workato/pull-recipe.ts`

- [ ] Add behavior so `workato_pull_recipe({ recipe_id, step, view:"full" })` returns `{ recipe_id, step, version }` with the raw node.
- [ ] Keep existing `step` inspection unchanged when `view` is omitted or not `full`.
- [ ] Run `pnpm --filter workatomcp-extension test -- recipe-view.test.ts` to guard existing step-view behavior.

### Task 6: Verification

**Files:** all touched code

- [ ] Run targeted native tests:
      `pnpm --filter workatomcp-bridge test -- workato-recipe-mutators.test.ts workato-file-io.test.ts`
- [ ] Run targeted extension test:
      `pnpm --filter workatomcp-extension test -- recipe-view.test.ts`
- [ ] Run shared build:
      `pnpm --filter workatomcp-shared build`
- [ ] Run native build:
      `pnpm --filter workatomcp-bridge build`
- [ ] Run extension compile:
      `pnpm --filter workatomcp-extension compile`
