/**
 * Element actions by uid, shared by the snapshot tools, chrome_act and
 * chrome_javascript(uids).
 *
 * A click is a real mouse click (CDP Input events at the element's center)
 * after checking the element is there, enabled and not covered; a fill picks
 * the right technique for the element kind and reads the value back. The
 * page-side helpers are sent as function source strings through
 * Runtime.callFunctionOn, so none of them is serialized by the bundler.
 */

import { ensureAttached, sendCommand } from './debugger-session';
import { getAllAxNodes, getFrames, UNKNOWN_LOADER } from './capture';
import { forgetUid, lookupUid, UidError } from './uid-store';
import type { AXNode, UidNodeRef } from './types';
import { axIdentity, ROW_ROLES } from './ax-tree-formatter';

export interface ResolvedElement {
  uid: number;
  backendNodeId: number;
  objectId: string;
}

interface ElementInfo {
  tag: string;
  type: string;
  role: string;
  contentEditable: boolean;
  disabled: boolean;
  readOnly: boolean;
  /** maxlength of a text field, -1 when unlimited. */
  maxLength: number;
  multiple: boolean;
  checked: boolean | null;
  options: Array<{ text: string; value: string; selected: boolean }> | null;
  autocomplete: string;
  controls: string;
  hasList: boolean;
  pointerEvents: string;
}

const CHECKABLE_ROLES = new Set([
  'checkbox',
  'radio',
  'switch',
  'menuitemcheckbox',
  'menuitemradio',
]);
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'file',
  'image',
  'hidden',
]);
const NATIVE_VALUE_TYPES = new Set([
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'color',
  'range',
]);
const OPTION_APPEAR_WAIT_MS = 400;
const WAIT_POLL_MS = 250;

function gone(uid: number, why: string): UidError {
  return new UidError(
    `uid ${uid} no longer exists on the page (${why}); call chrome_snapshot again.`,
  );
}

async function callOn<T = any>(
  tabId: number,
  objectId: string,
  fn: string,
  args: Array<{ value?: unknown; objectId?: string }> = [],
  returnByValue = true,
  userGesture = false,
): Promise<T> {
  const res = await sendCommand<any>(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: fn,
    arguments: args,
    returnByValue,
    awaitPromise: true,
    userGesture,
  });
  if (res?.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(d.exception?.description ?? d.text ?? 'page-side error');
  }
  return (returnByValue ? res?.result?.value : res?.result) as T;
}

/** A uid's live element, or a UidError naming the next step. */
export async function resolveElement(tabId: number, uid: unknown): Promise<ResolvedElement> {
  if (typeof uid !== 'number' || !Number.isFinite(uid)) {
    throw new UidError('uid (number) is required');
  }
  await ensureAttached(tabId);
  const ref = await lookupUid(tabId, uid);
  if (ref.loaderId !== UNKNOWN_LOADER) {
    let frames: Array<{ frameId: string; loaderId: string }> = [];
    try {
      frames = await getFrames(tabId);
    } catch {
      frames = [];
    }
    if (frames.length) {
      const frame = frames.find((f) => f.frameId === ref.frameId);
      if (!frame || frame.loaderId !== ref.loaderId) {
        forgetUid(tabId, uid);
        throw gone(uid, 'the page navigated');
      }
    }
  }
  let objectId: string | undefined;
  try {
    const r = await sendCommand<any>(tabId, 'DOM.resolveNode', {
      backendNodeId: ref.backendNodeId,
    });
    objectId = r?.object?.objectId;
  } catch {
    objectId = undefined;
  }
  if (!objectId) {
    forgetUid(tabId, uid);
    throw gone(uid, 'removed or the page navigated');
  }
  const connected = await callOn<boolean>(
    tabId,
    objectId,
    'function(){ return !!this.isConnected; }',
  );
  if (!connected) {
    forgetUid(tabId, uid);
    throw gone(uid, 'removed from the page');
  }
  const drift = await identityDrift(tabId, ref);
  if (drift) {
    throw new UidError(
      `uid ${uid} changed from ${drift.from} to ${drift.to} (the page re-rendered that node for something else); ` +
        'call chrome_snapshot again. Nothing was done.',
    );
  }
  return { uid, backendNodeId: ref.backendNodeId, objectId };
}

function shownIdentity(role: string, name: string): string {
  return name ? `${role} "${name}"` : role;
}

/**
 * A node can stay connected while it now shows another record: keyed and
 * virtualized lists recycle DOM nodes. Compare the node's role and name, and
 * the name of its nearest row-like ancestor, with what the snapshot recorded.
 * A value change (text typed into a textbox) is not a drift: names come from
 * labels, not values. Returns null when unchanged or when it cannot be told.
 */
async function identityDrift(
  tabId: number,
  ref: UidNodeRef,
): Promise<{ from: string; to: string } | null> {
  if (ref.role === undefined) return null;
  let nodes: AXNode[] = [];
  try {
    const r = await sendCommand<{ nodes: AXNode[] }>(tabId, 'Accessibility.getPartialAXTree', {
      backendNodeId: ref.backendNodeId,
      fetchRelatives: Boolean(ref.row),
    });
    nodes = r?.nodes ?? [];
  } catch {
    return null;
  }
  const self = nodes.find((n) => n.backendDOMNodeId === ref.backendNodeId);
  if (!self || self.ignored) return null;
  const now = axIdentity(self);
  const was = shownIdentity(ref.role, ref.name ?? '');
  if (now.role !== ref.role || (ref.name && now.name !== ref.name)) {
    return { from: was, to: shownIdentity(now.role, now.name) };
  }
  if (ref.row) {
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    let cur = self.parentId ? byId.get(self.parentId) : undefined;
    let guard = 0;
    while (cur && guard++ < 500) {
      const id = axIdentity(cur);
      if (!cur.ignored && ROW_ROLES.has(id.role) && id.name) {
        return id.name === ref.row
          ? null
          : { from: `${was} in row "${ref.row}"`, to: `${was} in row "${id.name}"` };
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return null;
}

const DESCRIBE_FN = `function(){
  var el = this;
  var ga = function(n){ return el.getAttribute ? el.getAttribute(n) : null; };
  var info = {
    tag: el.tagName || '',
    type: (ga('type') || '').toLowerCase(),
    role: (ga('role') || '').toLowerCase(),
    contentEditable: !!el.isContentEditable,
    disabled: !!(el.disabled || ga('aria-disabled') === 'true'),
    readOnly: !!(el.readOnly || ga('aria-readonly') === 'true'),
    maxLength: (typeof el.maxLength === 'number' && el.maxLength >= 0) ? el.maxLength : -1,
    multiple: !!el.multiple,
    checked: null,
    options: null,
    autocomplete: (ga('aria-autocomplete') || '').toLowerCase(),
    controls: ga('aria-controls') || ga('aria-owns') || '',
    hasList: !!el.list,
    pointerEvents: ''
  };
  if (info.tag === 'INPUT' && (info.type === 'checkbox' || info.type === 'radio')) info.checked = !!el.checked;
  else if (ga('aria-checked') !== null) info.checked = ga('aria-checked') === 'true';
  if (info.tag === 'SELECT') {
    info.options = Array.prototype.slice.call(el.options).map(function(o){
      return { text: (o.text || '').trim(), value: String(o.value), selected: !!o.selected };
    });
  }
  try { info.pointerEvents = getComputedStyle(el).pointerEvents; } catch (e) {}
  return info;
}`;

async function describe(tabId: number, el: { objectId: string }): Promise<ElementInfo> {
  return callOn<ElementInfo>(tabId, el.objectId, DESCRIBE_FN);
}

function isCheckable(info: ElementInfo): boolean {
  if (info.tag === 'INPUT' && (info.type === 'checkbox' || info.type === 'radio')) return true;
  return CHECKABLE_ROLES.has(info.role);
}

function isTextLike(info: ElementInfo): boolean {
  if (info.tag === 'TEXTAREA') return true;
  if (info.tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has(info.type);
  return info.contentEditable;
}

function optionsPreview(options: ElementInfo['options'], max = 30): string {
  const list = (options ?? [])
    .slice(0, max)
    .map((o) => `"${o.text}"${o.selected ? ' (selected)' : ''}`);
  const more = (options?.length ?? 0) > max ? `, and ${(options?.length ?? 0) - max} more` : '';
  return list.join(', ') + more;
}

// ---------------------------------------------------------------------------
// Click
// ---------------------------------------------------------------------------

const HIT_FN = `function(hit){
  var self = this;
  var contains = function(a, b){
    var n = b; var guard = 0;
    while (n && guard++ < 1000) {
      if (n === a) return true;
      if (n.nodeType === 9) { var w = n.defaultView; n = w && w.frameElement ? w.frameElement : null; continue; }
      n = n.parentNode || n.host || null;
    }
    return false;
  };
  if (contains(self, hit)) return { ok: true };
  var pe = ''; try { pe = getComputedStyle(self).pointerEvents; } catch (e) {}
  if (pe === 'none' && contains(hit, self)) return { ok: true };
  var labels = self.labels ? Array.prototype.slice.call(self.labels) : [];
  for (var i = 0; i < labels.length; i++) { if (contains(labels[i], hit)) return { ok: true }; }
  var el = hit.nodeType === 1 ? hit : hit.parentElement;
  var d = '';
  if (el) {
    d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) d += '.' + cls.join('.');
    var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    if (t) d += ' "' + t + '"';
  }
  return { ok: false, cover: d || 'another element' };
}`;

interface ClickPoint {
  x: number;
  y: number;
  /** The whole box lies outside the viewport: a CDP click there lands on nothing. */
  offscreen?: boolean;
}

/** Visible viewport size in CSS pixels, or null when Chrome does not say. */
async function viewportSize(tabId: number): Promise<{ w: number; h: number } | null> {
  try {
    const m = await sendCommand<any>(tabId, 'Page.getLayoutMetrics');
    const vp =
      m?.cssVisualViewport ?? m?.visualViewport ?? m?.cssLayoutViewport ?? m?.layoutViewport;
    const w = Number(vp?.clientWidth);
    const h = Number(vp?.clientHeight);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

async function clickPoint(tabId: number, backendNodeId: number): Promise<ClickPoint | null> {
  let quads: number[][] = [];
  try {
    const r = await sendCommand<{ quads: number[][] }>(tabId, 'DOM.getContentQuads', {
      backendNodeId,
    });
    quads = r?.quads ?? [];
  } catch {
    quads = [];
  }
  let best: { minX: number; maxX: number; minY: number; maxY: number; area: number } | null = null;
  for (const q of quads) {
    if (!Array.isArray(q) || q.length < 8) continue;
    const xs = [q[0], q[2], q[4], q[6]];
    const ys = [q[1], q[3], q[5], q[7]];
    const box = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
    const area = (box.maxX - box.minX) * (box.maxY - box.minY);
    if (area <= 0) continue;
    if (!best || area > best.area) best = { ...box, area };
  }
  if (!best) return null;
  // Aim at the part of the box that is on screen: the center of an element
  // taller than the viewport can lie below it.
  const vp = await viewportSize(tabId);
  if (!vp) return { x: (best.minX + best.maxX) / 2, y: (best.minY + best.maxY) / 2 };
  const x0 = Math.max(best.minX, 0);
  const x1 = Math.min(best.maxX, vp.w);
  const y0 = Math.max(best.minY, 0);
  const y1 = Math.min(best.maxY, vp.h);
  if (x1 <= x0 || y1 <= y0) {
    return { x: (best.minX + best.maxX) / 2, y: (best.minY + best.maxY) / 2, offscreen: true };
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Marker: Chrome could not say what is at the point, so coverage is unknown. */
const COVER_UNKNOWN = Symbol('cover-unknown');

/** What covers the element at the point, null when the element gets the click, COVER_UNKNOWN when it cannot be told. */
async function coveredBy(
  tabId: number,
  target: { backendNodeId: number; objectId: string },
  point: { x: number; y: number },
): Promise<string | null | typeof COVER_UNKNOWN> {
  let hit: any;
  try {
    hit = await sendCommand<any>(tabId, 'DOM.getNodeForLocation', {
      x: Math.round(point.x),
      y: Math.round(point.y),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: true,
    });
  } catch {
    return COVER_UNKNOWN;
  }
  if (!hit?.backendNodeId || hit.backendNodeId === target.backendNodeId) return null;
  let hitObjectId: string | undefined;
  try {
    const r = await sendCommand<any>(tabId, 'DOM.resolveNode', {
      backendNodeId: hit.backendNodeId,
    });
    hitObjectId = r?.object?.objectId;
  } catch {
    hitObjectId = undefined;
  }
  if (!hitObjectId) return null;
  const res = await callOn<{ ok: boolean; cover?: string }>(tabId, target.objectId, HIT_FN, [
    { objectId: hitObjectId },
  ]);
  return res?.ok ? null : (res?.cover ?? 'another element');
}

/**
 * True when the page is not rendered (visibilityState hidden): a leased tab in
 * the unfocused agents window is occluded, and Chrome then drops CDP mouse and
 * key input on the floor. Such pages get DOM events instead.
 */
async function pageHidden(tabId: number): Promise<boolean> {
  try {
    const r = await sendCommand<any>(tabId, 'Runtime.evaluate', {
      expression: 'document.visibilityState',
      returnByValue: true,
    });
    return r?.result?.value === 'hidden';
  } catch {
    return false;
  }
}

/** Pointer/mouse event sequence dispatched on the element itself, then its activation (click). */
const DOM_CLICK_FN = `function(x, y, dbl){
  var el = this;
  var base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
  function fire(type, Ctor, extra){ var o = Object.assign({}, base, extra || {}); try { el.dispatchEvent(new Ctor(type, o)); } catch (e) { el.dispatchEvent(new MouseEvent(type, o)); } }
  var P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  fire('pointerover', P, { pointerType: 'mouse' }); fire('mouseover', MouseEvent);
  fire('pointerenter', P, { pointerType: 'mouse', bubbles: false }); fire('mouseenter', MouseEvent, { bubbles: false });
  fire('pointermove', P, { pointerType: 'mouse' }); fire('mousemove', MouseEvent);
  var n = dbl ? 2 : 1;
  for (var i = 1; i <= n; i++) {
    fire('pointerdown', P, { pointerType: 'mouse', buttons: 1, detail: i }); fire('mousedown', MouseEvent, { buttons: 1, detail: i });
    if (i === 1 && typeof el.focus === 'function') { try { el.focus({ preventScroll: true }); } catch (e) {} }
    fire('pointerup', P, { pointerType: 'mouse', detail: i }); fire('mouseup', MouseEvent, { detail: i });
    if (typeof el.click === 'function') el.click(); else fire('click', MouseEvent, { detail: i });
  }
  if (dbl) fire('dblclick', MouseEvent, { detail: 2 });
}`;

const DOM_HOVER_FN = `function(x, y){
  var el = this;
  var base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
  var P = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new P('pointerover', Object.assign({ pointerType: 'mouse' }, base)));
  el.dispatchEvent(new MouseEvent('mouseover', base));
  el.dispatchEvent(new P('pointerenter', Object.assign({ pointerType: 'mouse' }, base, { bubbles: false })));
  el.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, base, { bubbles: false })));
  el.dispatchEvent(new P('pointermove', Object.assign({ pointerType: 'mouse' }, base)));
  el.dispatchEvent(new MouseEvent('mousemove', base));
}`;

async function dispatchClick(
  tabId: number,
  point: { x: number; y: number },
  double: boolean,
): Promise<void> {
  const { x, y } = point;
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  });
  const clicks = double ? 2 : 1;
  for (let c = 1; c <= clicks; c++) {
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: c,
    });
    await sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: c,
    });
  }
}

/** Real click on a resolved node. Throws when it is covered. */
async function clickNode(
  tabId: number,
  target: { backendNodeId: number; objectId: string },
  label: string,
  double = false,
): Promise<string> {
  try {
    await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: target.backendNodeId });
  } catch {
    // Not scrollable into view (e.g. fixed); the quads decide.
  }
  const point = await clickPoint(tabId, target.backendNodeId);
  if (!point) {
    await callOn(
      tabId,
      target.objectId,
      'function(){ if (typeof this.click !== "function") throw new Error("not an HTML element"); this.click(); }',
    );
    return `${label} (used a JS click: the element has no visible box)`;
  }
  const domClick = async (why: string): Promise<string> => {
    await callOn(
      tabId,
      target.objectId,
      DOM_CLICK_FN,
      [{ value: point.x }, { value: point.y }, { value: double }],
      true,
      true,
    );
    return `${label} (${why}: sent DOM events)`;
  };
  if (point.offscreen) {
    // A CDP click outside the viewport lands on nothing; never report one.
    return domClick('the element is outside the viewport');
  }
  const cover = await coveredBy(tabId, target, point);
  if (cover === COVER_UNKNOWN) {
    return domClick('could not verify the element is uncovered');
  }
  if (cover) {
    throw new Error(
      `${label.replace(/^(double-)?clicked /, '')} is covered by ${cover} at (${Math.round(point.x)}, ${Math.round(point.y)}); ` +
        'nothing was clicked. Close or move what covers it, or act on that element instead.',
    );
  }
  if (await pageHidden(tabId)) {
    // Occluded page: CDP input is ignored, so fire the events on the element.
    return domClick('hidden tab');
  }
  await dispatchClick(tabId, point, double);
  return label;
}

async function readChecked(tabId: number, objectId: string): Promise<boolean | null> {
  return callOn<boolean | null>(
    tabId,
    objectId,
    'function(){ if (this.tagName === "INPUT" && (this.type === "checkbox" || this.type === "radio")) return !!this.checked; var a = this.getAttribute && this.getAttribute("aria-checked"); return a === null ? null : a === "true"; }',
  );
}

export async function clickUid(tabId: number, uid: number, double = false): Promise<string> {
  const el = await resolveElement(tabId, uid);
  const info = await describe(tabId, el);
  if (info.tag === 'SELECT') {
    return (
      `uid ${uid} is a <select>${info.multiple ? ' (multiple)' : ''}; not clicked. ` +
      `Options: ${optionsPreview(info.options)}. Pick one with chrome_snapshot_fill(uid ${uid}, "<option text>").`
    );
  }
  if (info.tag === 'INPUT' && info.type === 'file') {
    throw new Error(`uid ${uid} is a file input; use chrome_upload_file instead of clicking it.`);
  }
  if (info.disabled) throw new Error(`uid ${uid} is disabled; nothing was clicked.`);
  const before = isCheckable(info) ? info.checked : null;
  const label = `${double ? 'double-clicked' : 'clicked'} uid=${uid}`;
  let text = await clickNode(tabId, el, label, double);
  if (before !== null) {
    const after = await readChecked(tabId, el.objectId).catch(() => null);
    if (after !== null) text += `; checked: ${before} -> ${after}`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export async function hoverUid(tabId: number, uid: number): Promise<string> {
  const el = await resolveElement(tabId, uid);
  try {
    await sendCommand(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: el.backendNodeId });
  } catch {
    // The quads decide.
  }
  const point = await clickPoint(tabId, el.backendNodeId);
  if (!point) throw new Error(`uid ${uid} has no visible box to hover.`);
  if (point.offscreen || (await pageHidden(tabId))) {
    await callOn(tabId, el.objectId, DOM_HOVER_FN, [{ value: point.x }, { value: point.y }]);
    return `hovered uid=${uid} (hidden tab: sent DOM events)`;
  }
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
  });
  return `hovered uid=${uid}`;
}

// ---------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------

function parseBool(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'checked'].includes(v)) return true;
  if (['false', '0', 'no', 'off', 'unchecked'].includes(v)) return false;
  return null;
}

function detectMac(): boolean {
  try {
    const p = (navigator as any)?.userAgentData?.platform ?? navigator.platform ?? '';
    return String(p).toLowerCase().includes('mac');
  } catch {
    return false;
  }
}

/**
 * Pick one enabled option: exact text, exact value, a UNIQUE prefix, a UNIQUE
 * substring. Anything matching several options is refused with the candidates:
 * "Paid" must never land on "Unpaid" because it happens to come first.
 */
export const SELECT_FN = `function(v){
  var want = String(v).trim().toLowerCase();
  var opts = Array.prototype.slice.call(this.options).filter(function(o){ return !o.disabled; });
  var norm = function(o){ return (o.text || '').trim().toLowerCase(); };
  var names = function(list){ return list.slice(0, 30).map(function(o){ return (o.text || '').trim(); }); };
  var stages = want === ''
    ? [function(o){ return norm(o) === '' || String(o.value) === ''; }]
    : [
        function(o){ return norm(o) === want; },
        function(o){ return String(o.value).toLowerCase() === want; },
        function(o){ return norm(o).indexOf(want) === 0; },
        function(o){ return norm(o).indexOf(want) >= 0; }
      ];
  var pick = null;
  for (var i = 0; i < stages.length && !pick; i++) {
    var hits = opts.filter(stages[i]);
    if (hits.length === 1) pick = hits[0];
    else if (hits.length > 1) return { ok: false, ambiguous: true, options: names(hits) };
  }
  if (!pick) return { ok: false, options: names(opts) };
  if (this.multiple) { pick.selected = true; } else { this.value = pick.value; }
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, selected: (pick.text || '').trim() };
}`;

/**
 * Set a field's value the way a framework sees it: the native setter (so React
 * notices), input and change, framed by focus/focusin and blur/focusout so
 * models that commit on blur (Angular updateOn:'blur') update too.
 */
export const NATIVE_SET_FN = `function(v){
  var el = this;
  var fire = function(type, bubbles){ try { el.dispatchEvent(new FocusEvent(type, { bubbles: bubbles })); } catch (e) {} };
  fire('focus', false); fire('focusin', true);
  var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var d = Object.getOwnPropertyDescriptor(proto, 'value');
  if (d && d.set) d.set.call(el, v); else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  fire('blur', false); fire('focusout', true);
  return el.value;
}`;

const FIND_OPTION_FN = `function(v, scoped){
  var want = String(v).trim().toLowerCase();
  var ids = (this.getAttribute('aria-controls') || this.getAttribute('aria-owns') || '').split(/\\s+/).filter(Boolean);
  var scopes = ids.map(function(id){ return document.getElementById(id); }).filter(Boolean);
  var selector = '[role=option], mat-option, .mat-option';
  if (scoped && !scopes.length) scopes = [this];
  if (!scopes.length) scopes = [document];
  var cands = [];
  scopes.forEach(function(s){ Array.prototype.push.apply(cands, Array.prototype.slice.call(s.querySelectorAll(selector))); });
  cands = cands.filter(function(o){ var r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  cands = cands.filter(function(o){ return o.getAttribute('aria-disabled') !== 'true'; });
  var norm = function(o){ return (o.innerText || o.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase(); };
  if (!want) return null;
  var exact = cands.filter(function(o){ return norm(o) === want; });
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  var prefix = cands.filter(function(o){ return norm(o).indexOf(want) === 0; });
  return prefix.length === 1 ? prefix[0] : null;
}`;

async function findOption(
  tabId: number,
  el: ResolvedElement,
  value: string,
  scoped: boolean,
): Promise<{ backendNodeId: number; objectId: string } | null> {
  const found = await callOn<any>(
    tabId,
    el.objectId,
    FIND_OPTION_FN,
    [{ value }, { value: scoped }],
    false,
  );
  const objectId = found?.objectId;
  if (!objectId || found?.subtype === 'null') return null;
  const described = await sendCommand<any>(tabId, 'DOM.describeNode', { objectId });
  const backendNodeId = described?.node?.backendNodeId;
  return typeof backendNodeId === 'number' ? { backendNodeId, objectId } : null;
}

async function typeText(tabId: number, el: ResolvedElement, value: string): Promise<void> {
  await sendCommand(tabId, 'DOM.focus', { backendNodeId: el.backendNodeId });
  // `text` on keyDown is what makes Chrome act on a synthetic Ctrl/Cmd+A.
  const modifiers = detectMac() ? 4 : 2;
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers,
    key: 'a',
    code: 'KeyA',
    text: '\x01',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
  });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
  });
  if (value === '') {
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    });
    await sendCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    });
  } else {
    await sendCommand(tabId, 'Input.insertText', { text: value });
  }
}

function sameValue(actual: string, expected: string, type: string): boolean {
  if (actual === expected) return true;
  if (type === 'number' && actual !== '' && expected !== '')
    return Number(actual) === Number(expected);
  return false;
}

async function fillText(
  tabId: number,
  el: ResolvedElement,
  info: ElementInfo,
  value: string,
): Promise<string> {
  const uid = el.uid;
  const secret = info.type === 'password';
  const shown = (v: string) =>
    secret ? '(not echoed)' : `"${v.length > 80 ? v.slice(0, 79) + '…' : v}"`;

  if (info.contentEditable && info.tag !== 'INPUT' && info.tag !== 'TEXTAREA') {
    await sendCommand(tabId, 'DOM.focus', { backendNodeId: el.backendNodeId });
    // Input.insertText is a no-op for contenteditable; execCommand fires the
    // beforeinput/input events ProseMirror, Lexical and CodeMirror listen to.
    await callOn(
      tabId,
      el.objectId,
      'function(v){ this.focus(); var s = window.getSelection(); var r = document.createRange(); r.selectNodeContents(this); s.removeAllRanges(); s.addRange(r); document.execCommand("insertText", false, v); }',
      [{ value }],
    );
    const text = await callOn<string>(
      tabId,
      el.objectId,
      'function(){ return (this.innerText || "").replace(/\\u00a0/g, " ").trim(); }',
    );
    if (text.trim() !== value.trim())
      return `filled uid=${uid} (editor); actual text differs: ${shown(text)}`;
    return `filled uid=${uid} (editor)`;
  }

  if (NATIVE_VALUE_TYPES.has(info.type)) {
    const actual = await callOn<string>(tabId, el.objectId, NATIVE_SET_FN, [{ value }]);
    return actual === value
      ? `filled uid=${uid} (${info.type})`
      : `filled uid=${uid} (${info.type}); actual value differs: ${shown(actual)} (check the expected format)`;
  }

  if (info.maxLength >= 0 && value.length > info.maxLength) {
    throw new Error(
      `uid ${uid} accepts at most ${info.maxLength} characters; the value has ${value.length}. Nothing was written.`,
    );
  }
  const readValue = () =>
    callOn<string>(tabId, el.objectId, 'function(){ return String(this.value); }');
  const before = await readValue();
  const hidden = await pageHidden(tabId);
  let how = '';
  let rejected = false;
  if (hidden) {
    // Occluded page: key input is dropped, so set the value and fire the events.
    await callOn<string>(tabId, el.objectId, NATIVE_SET_FN, [{ value }]);
    how = ' (hidden tab: DOM value set directly, not typed)';
  } else {
    await typeText(tabId, el, value);
  }
  let actual = await readValue();
  if (!hidden && !sameValue(actual, value, info.type)) {
    // Only one failure is safe to repair: the old text was not selected, so
    // the new text landed next to it. A field that rewrote or ignored the typed
    // text (a mask, a formatter, a guard) is left alone and reported.
    const oldNotCleared =
      before !== '' &&
      value !== '' &&
      actual.length >= before.length + value.length &&
      actual.includes(value) &&
      actual.includes(before);
    if (oldNotCleared) {
      actual = await callOn<string>(tabId, el.objectId, NATIVE_SET_FN, [{ value }]);
      how = ' (the old text was not cleared; replaced it directly)';
    } else {
      rejected = true;
    }
  } else if (!hidden) {
    // Commit for frameworks that only read on change.
    await callOn(
      tabId,
      el.objectId,
      'function(){ this.dispatchEvent(new Event("change", { bubbles: true })); }',
    );
  }
  let text = `filled uid=${uid}${how}`;

  const wantsOption =
    info.role === 'combobox' ||
    info.autocomplete === 'list' ||
    info.autocomplete === 'both' ||
    info.hasList;
  if (wantsOption && value !== '') {
    await new Promise((r) => setTimeout(r, OPTION_APPEAR_WAIT_MS));
    const option = await findOption(tabId, el, value, false).catch(() => null);
    if (option) {
      await clickNode(tabId, option, 'option');
      actual = await readValue();
      text += '; picked the matching option';
    } else {
      text += '; no matching option appeared, the typed text was left as is';
    }
  }
  if (!sameValue(actual, value, info.type) && !(wantsOption && text.includes('picked'))) {
    text += `; actual value differs: ${shown(actual)}`;
    if (rejected) text += ' (the field rewrote or rejected the typed text; not overridden)';
  } else if (before === actual && before !== value) {
    text += '; the value did not change';
  }
  return text;
}

export async function fillUid(tabId: number, uid: number, rawValue: unknown): Promise<string> {
  if (rawValue === undefined || rawValue === null) throw new Error('value is required');
  const value = String(rawValue);
  const el = await resolveElement(tabId, uid);
  const info = await describe(tabId, el);
  if (info.disabled) throw new Error(`uid ${uid} is disabled; nothing was filled.`);
  if (info.readOnly) {
    // A read-only input that drives a popup list (a common custom dropdown) is
    // filled by picking an option, never by writing the input.
    if (info.role !== 'combobox' && !info.hasList) {
      throw new Error(`uid ${uid} is read-only; nothing was written.`);
    }
    await clickNode(tabId, el, `opened uid=${uid}`);
    await new Promise((r) => setTimeout(r, OPTION_APPEAR_WAIT_MS));
    const option = await findOption(tabId, el, value, false).catch(() => null);
    if (!option) {
      throw new Error(
        `uid ${uid} is a read-only dropdown; it was opened, but no single visible option matches "${value}" ` +
          '(none, or several). Take chrome_snapshot and click the option you mean.',
      );
    }
    await clickNode(tabId, option, 'option');
    return `picked "${value}" in read-only dropdown uid=${uid}`;
  }

  if (info.tag === 'SELECT') {
    const r = await callOn<{
      ok: boolean;
      selected?: string;
      options?: string[];
      ambiguous?: boolean;
    }>(tabId, el.objectId, SELECT_FN, [{ value }]);
    if (!r?.ok) {
      const list = (r?.options ?? []).map((o) => `"${o}"`).join(', ');
      if (r?.ambiguous) {
        throw new Error(
          `uid ${uid}: "${value}" matches several options (${list}); pass the exact option text or value. Nothing was selected.`,
        );
      }
      throw new Error(
        value.trim() === ''
          ? `uid ${uid}: no option has an empty text or value. Options: ${list}`
          : `uid ${uid}: no enabled option matches "${value}". Options: ${list}`,
      );
    }
    return `selected "${r.selected}" in uid=${uid}`;
  }

  if (isCheckable(info)) {
    const want = parseBool(value);
    if (want === null) {
      throw new Error(
        `uid ${uid} is a ${info.type || info.role}; pass "true" or "false" as the value.`,
      );
    }
    if (info.checked === want) return `uid=${uid} already ${want ? 'checked' : 'unchecked'}`;
    await clickNode(tabId, el, `clicked uid=${uid}`);
    const after = await readChecked(tabId, el.objectId).catch(() => null);
    if (after !== want) return `clicked uid=${uid}; actual state differs: checked=${after}`;
    return `${want ? 'checked' : 'unchecked'} uid=${uid}`;
  }

  if (info.role === 'listbox' && info.tag !== 'SELECT') {
    const option = await findOption(tabId, el, value, true);
    if (!option) {
      throw new Error(
        `uid ${uid}: no single visible option matches "${value}" (none, or several); pass the exact option text.`,
      );
    }
    await clickNode(tabId, option, 'option');
    return `picked "${value}" in uid=${uid}`;
  }

  if (isTextLike(info)) return fillText(tabId, el, info, value);

  throw new Error(
    `uid ${uid} is not fillable (${info.tag.toLowerCase()}${info.role ? ` role=${info.role}` : ''}); ` +
      'click it or pick another uid.',
  );
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const NAMED_KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
};
const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/** keydown/keypress/keyup on the focused element; returns a short description of it. */
const DOM_KEY_FN = `function(key, code, vk, mods){
  var el = document.activeElement || document.body;
  var init = { key: key, code: code, keyCode: vk, which: vk, bubbles: true, cancelable: true, composed: true,
    altKey: !!(mods & 1), ctrlKey: !!(mods & 2), metaKey: !!(mods & 4), shiftKey: !!(mods & 8) };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  if (key.length === 1 || key === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
  var d = el.tagName ? el.tagName.toLowerCase() : 'document';
  if (el.id) d += '#' + el.id;
  var n = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder'));
  if (n) d += ' "' + String(n).slice(0, 40) + '"';
  return d;
}`;

export async function pressKey(tabId: number, combo: unknown): Promise<string> {
  if (typeof combo !== 'string' || !combo.trim())
    throw new Error('key is required, e.g. "Enter" or "Control+A"');
  await ensureAttached(tabId);
  const parts = combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const main = parts.pop() as string;
  let modifiers = 0;
  for (const m of parts) {
    const bit = MODIFIER_BITS[m.toLowerCase()];
    if (bit === undefined) throw new Error(`unknown modifier "${m}" in "${combo}"`);
    modifiers |= bit;
  }
  let spec = NAMED_KEYS[main.toLowerCase()];
  if (!spec) {
    if (main.length !== 1) throw new Error(`unknown key "${main}" in "${combo}"`);
    const upper = main.toUpperCase();
    const code = /[a-z]/i.test(main) ? `Key${upper}` : /\d/.test(main) ? `Digit${main}` : '';
    spec = { key: main, code, vk: upper.charCodeAt(0), text: main };
  }
  const printable = spec.text !== undefined && (modifiers & ~8) === 0;
  if (await pageHidden(tabId)) {
    // Occluded page: CDP key input is dropped. DOM key events reach the page's
    // listeners, but the browser does not run default actions for them.
    const target = await sendCommand<any>(tabId, 'Runtime.evaluate', {
      expression: `(${DOM_KEY_FN})(${JSON.stringify(spec.key)}, ${JSON.stringify(spec.code)}, ${spec.vk}, ${modifiers})`,
      returnByValue: true,
    });
    const who = target?.result?.value ? ` to ${target.result.value}` : '';
    return (
      `pressed ${combo}${who} (hidden tab: DOM key events; browser default actions such as ` +
      'form submit on Enter may not happen)'
    );
  }
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: printable ? 'keyDown' : 'rawKeyDown',
    modifiers,
    key: spec.key,
    code: spec.code,
    text: printable ? spec.text : undefined,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk,
  });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk,
  });
  return `pressed ${combo}`;
}

// ---------------------------------------------------------------------------
// Wait for text
// ---------------------------------------------------------------------------

function axString(v: AXNode['role'] | AXNode['name']): string {
  return typeof v === 'string' ? v : ((v as any)?.value ?? '').toString();
}

export interface TextMatch {
  role: string;
  name: string;
  backendNodeId?: number;
}

/** First non-ignored node whose name contains any of `texts` (and has `role`, when given). */
export function matchNodes(nodes: AXNode[], texts: string[], role?: string): TextMatch | null {
  const wanted = texts.map((t) => t.toLowerCase()).filter(Boolean);
  const roleLower = role ? role.toLowerCase() : null;
  for (const n of nodes) {
    if (n.ignored) continue;
    const r = axString(n.role);
    const name = axString(n.name);
    if (roleLower && r.toLowerCase() !== roleLower) continue;
    const nameLower = name.toLowerCase();
    if (wanted.length && !wanted.some((w) => nameLower.includes(w))) continue;
    if (!wanted.length && !roleLower) continue;
    return { role: r, name, backendNodeId: n.backendDOMNodeId };
  }
  return null;
}

export async function waitForTexts(
  tabId: number,
  texts: string[],
  role: string | undefined,
  timeoutMs: number,
): Promise<TextMatch> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const nodes = await getAllAxNodes(tabId);
      const hit = matchNodes(nodes, texts, role);
      if (hit) return hit;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
  const what =
    `${role ? `role="${role}"` : ''}${role && texts.length ? ' + ' : ''}` +
    (texts.length ? `text~${texts.map((t) => `"${t}"`).join(' or ')}` : '');
  const reason = lastError
    ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`
    : '';
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${reason}`);
}
