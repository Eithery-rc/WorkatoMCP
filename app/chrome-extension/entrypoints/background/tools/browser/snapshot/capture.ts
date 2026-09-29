/**
 * Build a snapshot of a tab: the main frame's accessibility tree plus the
 * trees of its same-process iframes, with stable uids and element state.
 * Out-of-process iframes are listed but not expanded (their tree lives in
 * another CDP target).
 */

import { ensureAttached, sendCommand } from './debugger-session';
import { formatAxTree } from './ax-tree-formatter';
import { captureDomInfo } from './dom-info';
import { assignUid, beginSnapshot, getTabUids, persistTabUids } from './uid-store';
import type { AXNode } from './types';

const MAX_FRAMES = 20;
const MAX_FRAME_NOTES = 5;
const FALLBACK_FRAME = 'main';
const UNKNOWN_LOADER = 'unknown';

export interface FrameInfo {
  frameId: string;
  loaderId: string;
  url: string;
  depth: number;
}

/** The tab's frames, main frame first. Empty when the frame tree is unavailable. */
export async function getFrames(tabId: number): Promise<FrameInfo[]> {
  const res = await sendCommand<any>(tabId, 'Page.getFrameTree');
  const out: FrameInfo[] = [];
  const walk = (ft: any, depth: number) => {
    if (!ft?.frame) return;
    out.push({
      frameId: String(ft.frame.id),
      loaderId: String(ft.frame.loaderId ?? UNKNOWN_LOADER),
      url: String(ft.frame.url ?? ''),
      depth,
    });
    for (const c of ft.childFrames ?? []) walk(c, depth + 1);
  };
  walk(res?.frameTree, 0);
  return out;
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export interface CapturedSnapshot {
  text: string;
  uidCount: number;
  seq: number;
}

export async function captureSnapshot(tabId: number): Promise<CapturedSnapshot> {
  await ensureAttached(tabId);
  let tabUrl = '';
  let tabTitle = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = tab.url ?? '';
    tabTitle = tab.title ?? '';
  } catch {
    // The caller already validated the tab; a race with its closing surfaces below.
  }

  let frames: FrameInfo[] = [];
  try {
    frames = await getFrames(tabId);
  } catch (e) {
    console.warn('[snapshot] Page.getFrameTree failed, uids are not navigation-checked:', e);
  }
  const main: FrameInfo = frames[0] ?? {
    frameId: FALLBACK_FRAME,
    loaderId: UNKNOWN_LOADER,
    url: tabUrl,
    depth: 0,
  };
  const live = new Map<string, string>(
    (frames.length ? frames : [main]).map((f) => [f.frameId, f.loaderId]),
  );

  const state = await getTabUids(tabId);
  const seq = beginSnapshot(state, live);
  const dom = await captureDomInfo(tabId);

  const mainTree = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree');
  const mainFmt = formatAxTree(mainTree?.nodes ?? [], {
    assignUid: (id, identity) => assignUid(state, main.frameId, main.loaderId, id, identity),
    dom,
  });
  const sections = [mainFmt.text];
  let uidCount = mainFmt.uids.length;
  const seen = new Set<number>(mainFmt.backendNodeIds);

  const children = frames.slice(1);
  let notes = 0;
  let unexpanded = 0;
  for (const frame of children.slice(0, MAX_FRAMES)) {
    try {
      const tree = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree', {
        frameId: frame.frameId,
      });
      const nodes = tree?.nodes ?? [];
      const ids = nodes
        .map((n) => n.backendDOMNodeId)
        .filter((id): id is number => typeof id === 'number');
      // Already part of a tree rendered above (Chrome merged it): skip.
      if (!ids.length || ids.every((id) => seen.has(id))) continue;
      const fmt = formatAxTree(nodes, {
        assignUid: (id, identity) => assignUid(state, frame.frameId, frame.loaderId, id, identity),
        dom,
        indentBase: 1,
      });
      if (fmt.text.startsWith('(')) continue;
      fmt.backendNodeIds.forEach((id) => seen.add(id));
      sections.push(`iframe "${shorten(frame.url, 120)}":\n${fmt.text}`);
      uidCount += fmt.uids.length;
    } catch {
      unexpanded += 1;
      if (frame.url && notes < MAX_FRAME_NOTES) {
        notes += 1;
        sections.push(`[iframe ${shorten(frame.url, 120)} not expanded (out-of-process frame)]`);
      }
    }
  }
  const unlisted = unexpanded - notes + Math.max(0, children.length - MAX_FRAMES);
  if (unlisted > 0) sections.push(`[${unlisted} more iframes not expanded]`);

  void persistTabUids(tabId, state);

  const header = `Page: ${tabUrl}${tabTitle ? ` (${tabTitle})` : ''}`;
  return { text: `${header}\n\n${sections.join('\n\n')}`, uidCount, seq };
}

/** The accessibility trees of the main frame and its same-process iframes, for text searches. */
export async function getAllAxNodes(tabId: number): Promise<AXNode[]> {
  await ensureAttached(tabId);
  const all: AXNode[] = [];
  const main = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree');
  all.push(...(main?.nodes ?? []));
  let frames: FrameInfo[] = [];
  try {
    frames = await getFrames(tabId);
  } catch {
    return all;
  }
  for (const frame of frames.slice(1, 1 + MAX_FRAMES)) {
    try {
      const tree = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree', {
        frameId: frame.frameId,
      });
      all.push(...(tree?.nodes ?? []));
    } catch {
      // Out-of-process frame: not searchable from this target.
    }
  }
  return all;
}

export { UNKNOWN_LOADER };
