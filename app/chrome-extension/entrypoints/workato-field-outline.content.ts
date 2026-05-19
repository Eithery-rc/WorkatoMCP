/**
 * Workato Optional-Fields Outline Navigator
 *
 * The Workato recipe editor's "Show optional fields" dialog renders a deeply
 * nested, virtualized list (CDK virtual scroll) of up to a few thousand fields.
 * It has no way to collapse groups, so finding a field means scrolling blind.
 *
 * This content script adds a floating, collapsible tree panel next to that
 * dialog. It harvests the field hierarchy once (by scrolling the virtual list
 * and reading the rendered rows), then lets the user expand/collapse groups and
 * click any node to jump the real list straight to it.
 *
 * Pure DOM only — runs in the isolated world, touches no page JS. If any DOM
 * assumption fails it logs a warning and removes the panel rather than breaking
 * the dialog.
 */

interface FieldRow {
  idx: number;
  level: number;
  group: boolean;
  title: string;
  selected: boolean;
}

interface TreeNode extends FieldRow {
  /** Breadcrumb of ancestor titles (excludes this node), e.g. "Records › Allocated Work". */
  path: string;
  children: TreeNode[];
}

interface OutlineState {
  rowH: number;
  flat: FieldRow[] | null;
  tree: TreeNode | null;
  total: string | null;
  statusObs: MutationObserver | null;
  cover: HTMLElement | null;
  collapsed: boolean;
}

const PANEL_W = 340;
const ROW_H_FALLBACK = 48;

const PANEL_CSS = `
.wofo-panel{position:fixed;z-index:2147483000;width:${PANEL_W}px;display:flex;flex-direction:column;
  background:#fff;border:1px solid #d6dae0;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);
  font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2733;overflow:hidden}
.wofo-head{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid #eceef1;background:#f7f8fa}
.wofo-title{font-weight:600;flex:1}
.wofo-sub{font-weight:400;color:#8a93a0;font-size:11px}
.wofo-btn{border:1px solid #d6dae0;background:#fff;border-radius:6px;cursor:pointer;width:24px;height:24px;
  display:flex;align-items:center;justify-content:center;color:#5b6573;padding:0}
.wofo-btn:hover{background:#eef0f3}
.wofo-filter{padding:8px 10px;border-bottom:1px solid #eceef1}
.wofo-filter input{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d6dae0;
  border-radius:6px;font:inherit;outline:none}
.wofo-filter input:focus{border-color:#3b7ddd}
.wofo-body{flex:1;overflow:auto;padding:4px 0}
.wofo-row{display:flex;align-items:center;gap:4px;padding:3px 8px 3px 0;cursor:pointer;
  white-space:nowrap;border-radius:4px;min-height:24px}
.wofo-row:hover{background:#eef4ff}
.wofo-chev{width:14px;flex:none;text-align:center;color:#8a93a0;font-size:10px}
.wofo-label{overflow:hidden;text-overflow:ellipsis;flex:1}
.wofo-group>.wofo-label{font-weight:600}
.wofo-count{flex:none;background:#e7ebf0;color:#5b6573;border-radius:9px;padding:0 6px;font-size:10px}
.wofo-check{flex:none;color:#2f9e44;font-weight:700}
.wofo-jump{flex:none;color:#3b7ddd;font-size:11px;padding:0 4px;opacity:0}
.wofo-row:hover .wofo-jump{opacity:1}
.wofo-msg,.wofo-stale{padding:16px;color:#8a93a0;text-align:center}
.wofo-stale button{margin-top:8px;padding:6px 12px;border:1px solid #3b7ddd;background:#3b7ddd;
  color:#fff;border-radius:6px;cursor:pointer;font:inherit}
.wofo-cover{z-index:2147483001;background:rgba(255,255,255,.85);display:flex;align-items:center;
  justify-content:center;color:#5b6573;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif}
.wofo-flash{background:#fff3bf!important;transition:background .25s}
.wofo-collapsed .wofo-filter,.wofo-collapsed .wofo-body{display:none}
.wofo-tip{position:fixed;z-index:2147483002;max-width:460px;background:#1f2733;color:#fff;
  padding:6px 9px;border-radius:6px;font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;
  box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;word-break:break-word}
`;

export default defineContentScript({
  matches: ['https://app.workato.com/*'],
  runAt: 'document_idle',

  main() {
    // The dialog only ever lives in the top frame.
    if (window.top !== window) return;

    const warn = (...a: unknown[]) => console.warn('[FieldOutline]', ...a);

    const state: OutlineState = {
      rowH: ROW_H_FALLBACK,
      flat: null,
      tree: null,
      total: null,
      statusObs: null,
      cover: null,
      collapsed: false,
    };
    let panel: HTMLElement | null = null;
    let activeList: HTMLElement | null = null;
    let harvestToken = 0;

    // ---------- styles ----------
    const styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    document.head.appendChild(styleEl);

    // ---------- tooltip ----------
    const tip = document.createElement('div');
    tip.className = 'wofo-tip';
    tip.style.display = 'none';
    document.body.appendChild(tip);

    function showTip(text: string, anchor: HTMLElement): void {
      tip.textContent = text;
      tip.style.display = 'block';
      const r = anchor.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      let left = r.left;
      let top = r.bottom + 4;
      if (left + tr.width > window.innerWidth - 8) left = window.innerWidth - 8 - tr.width;
      if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 4;
      tip.style.left = Math.max(8, left) + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    }

    let tipTimer: ReturnType<typeof setTimeout> | undefined;
    const TIP_DELAY_MS = 400;

    function scheduleTip(text: string, anchor: HTMLElement): void {
      if (tipTimer) clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(text, anchor), TIP_DELAY_MS);
    }

    function hideTip(): void {
      if (tipTimer) {
        clearTimeout(tipTimer);
        tipTimer = undefined;
      }
      tip.style.display = 'none';
    }

    // ---------- utils ----------
    const raf2 = () =>
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const translateY = (el: HTMLElement): number => {
      const m = (el.style.transform || '').match(/translateY\(([-\d.]+)px\)/);
      return m ? parseFloat(m[1]) : 0;
    };

    function waitFor<T>(fn: () => T | null, timeout: number): Promise<T> {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          let v: T | null = null;
          try {
            v = fn();
          } catch {
            v = null;
          }
          if (v) return resolve(v);
          if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for the list'));
          requestAnimationFrame(tick);
        };
        tick();
      });
    }

    function readTotal(list: HTMLElement): string | null {
      const el = list.querySelector('.multi-select-list__status-text');
      const m = el && el.textContent && el.textContent.match(/of\s+([\d,]+)\s+results/i);
      return m ? m[1].replace(/,/g, '') : null;
    }

    // ---------- harvest ----------
    async function harvest(
      list: HTMLElement,
      token: number,
    ): Promise<{ flat: FieldRow[]; rowH: number }> {
      const vp = list.querySelector<HTMLElement>('cdk-virtual-scroll-viewport');
      const wrap = vp && vp.querySelector<HTMLElement>('.cdk-virtual-scroll-content-wrapper');
      const spacer = vp && vp.querySelector<HTMLElement>('.cdk-virtual-scroll-spacer');
      if (!vp || !wrap || !spacer) throw new Error('virtual-scroll layout not found');

      const firstLabel = wrap.querySelector<HTMLElement>('label.multi-select-list__item');
      const rowH = (firstLabel && firstLabel.offsetHeight) || ROW_H_FALLBACK;
      const spacerH = parseFloat(spacer.style.height) || vp.scrollHeight;
      const totalRows = Math.round(spacerH / rowH);
      const maxScroll = Math.max(0, spacerH - vp.clientHeight);
      const rows = new Map<number, FieldRow>();

      const read = () => {
        const base = Math.round(translateY(wrap) / rowH);
        wrap.querySelectorAll<HTMLElement>('label.multi-select-list__item').forEach((l, i) => {
          const idx = base + i;
          if (rows.has(idx)) return;
          const content = l.querySelector<HTMLElement>('.multi-select-list__item-content');
          const pad = content ? parseInt(content.style.paddingLeft, 10) || 0 : 0;
          const titleEl = l.querySelector('.multi-select-list__item-title');
          const cb = l.querySelector<HTMLInputElement>('input.multi-select-list__checkbox-input');
          rows.set(idx, {
            idx,
            level: Math.round(pad / 32),
            group: !l.classList.contains('multi-select-list__item_selectable'),
            title: ((titleEl && titleEl.textContent) || '').trim(),
            selected: !!(cb && cb.checked),
          });
        });
      };

      const step = rowH * 12;
      for (let top = 0; top <= maxScroll + step; top += step) {
        if (token !== harvestToken) throw new Error('cancelled');
        vp.scrollTop = Math.min(top, maxScroll);
        await raf2();
        read();
      }
      for (let idx = 0, guard = 0; idx < totalRows && guard < 400; idx++) {
        if (rows.has(idx)) continue;
        guard++;
        if (token !== harvestToken) throw new Error('cancelled');
        vp.scrollTop = Math.min(idx * rowH, maxScroll);
        await raf2();
        read();
      }
      vp.scrollTop = 0;
      await raf2();
      return { flat: [...rows.values()].sort((a, b) => a.idx - b.idx), rowH };
    }

    function buildTree(flat: FieldRow[]): TreeNode {
      const root: TreeNode = {
        idx: -1,
        level: -1,
        group: true,
        title: '',
        selected: false,
        path: '',
        children: [],
      };
      const stack: TreeNode[] = [root];
      for (const it of flat) {
        while (
          stack.length > 1 &&
          (stack[stack.length - 1].level >= it.level || !stack[stack.length - 1].group)
        ) {
          stack.pop();
        }
        const parent = stack[stack.length - 1];
        const parentPath =
          parent.idx < 0 ? '' : parent.path ? parent.path + ' › ' + parent.title : parent.title;
        const node: TreeNode = { ...it, path: parentPath, children: [] };
        parent.children.push(node);
        stack.push(node);
      }
      return root;
    }

    // ---------- jump ----------
    async function jumpTo(idx: number): Promise<void> {
      const list = activeList;
      if (!list) return;
      const vp = list.querySelector<HTMLElement>('cdk-virtual-scroll-viewport');
      const wrap = vp && vp.querySelector<HTMLElement>('.cdk-virtual-scroll-content-wrapper');
      const spacer = vp && vp.querySelector<HTMLElement>('.cdk-virtual-scroll-spacer');
      if (!vp || !wrap || !spacer) return;
      const maxScroll = Math.max(
        0,
        (parseFloat(spacer.style.height) || vp.scrollHeight) - vp.clientHeight,
      );
      vp.scrollTop = Math.min(idx * state.rowH, maxScroll);
      await raf2();
      const base = Math.round(translateY(wrap) / state.rowH);
      const target = wrap.querySelectorAll<HTMLElement>('label.multi-select-list__item')[
        idx - base
      ];
      if (target) {
        target.classList.add('wofo-flash');
        setTimeout(() => target.classList.remove('wofo-flash'), 1300);
      }
    }

    // ---------- rendering ----------
    function rowEl(node: TreeNode, depth: number): { row: HTMLElement; chev: HTMLElement } {
      const row = document.createElement('div');
      row.className = 'wofo-row ' + (node.group ? 'wofo-group' : 'wofo-field');
      row.style.paddingLeft = 6 + depth * 13 + 'px';

      const chev = document.createElement('span');
      chev.className = 'wofo-chev';
      row.appendChild(chev);

      const label = document.createElement('span');
      label.className = 'wofo-label';
      label.textContent = node.title || '(untitled)';
      row.appendChild(label);

      const fullPath = node.path ? node.path + ' › ' + node.title : node.title;
      row.addEventListener('mouseenter', () => scheduleTip(fullPath, row));
      row.addEventListener('mouseleave', hideTip);

      if (node.group && node.children.length) {
        const c = document.createElement('span');
        c.className = 'wofo-count';
        c.textContent = String(node.children.length);
        row.appendChild(c);
      }
      if (node.selected) {
        const s = document.createElement('span');
        s.className = 'wofo-check';
        s.textContent = '✓';
        row.appendChild(s);
      }

      const jb = document.createElement('span');
      jb.className = 'wofo-jump';
      jb.textContent = '↪';
      jb.title = 'Scroll the list to here';
      jb.addEventListener('click', (e) => {
        e.stopPropagation();
        void jumpTo(node.idx);
      });
      row.appendChild(jb);

      return { row, chev };
    }

    function appendNode(
      node: TreeNode,
      depth: number,
      container: HTMLElement,
      startExpanded: boolean,
    ): void {
      const { row, chev } = rowEl(node, depth);
      container.appendChild(row);

      if (node.group && node.children.length) {
        let childWrap: HTMLDivElement | null = null;
        let expanded = false;
        const setExpanded = (v: boolean) => {
          expanded = v;
          chev.textContent = expanded ? '▾' : '▸';
          if (expanded && !childWrap) {
            childWrap = document.createElement('div');
            node.children.forEach((c) =>
              appendNode(c, depth + 1, childWrap as HTMLDivElement, startExpanded),
            );
            row.after(childWrap);
          }
          if (childWrap) childWrap.style.display = expanded ? '' : 'none';
        };
        chev.textContent = '▸';
        chev.addEventListener('click', (e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        });
        row.addEventListener('click', () => setExpanded(!expanded));
        if (startExpanded) setExpanded(true);
      } else {
        row.addEventListener('click', () => void jumpTo(node.idx));
      }
    }

    /** Returns a pruned copy of the tree keeping only nodes matching `q` (and their ancestors). */
    function filterTree(node: TreeNode, q: string): TreeNode | null {
      const self = node.idx >= 0 && node.title.toLowerCase().includes(q);
      const kids: TreeNode[] = [];
      for (const c of node.children) {
        const fc = filterTree(c, q);
        if (fc) kids.push(fc);
      }
      if (self || kids.length) return { ...node, children: kids };
      return null;
    }

    function renderTree(): void {
      if (!panel) return;
      hideTip();
      const input = panel.querySelector<HTMLInputElement>('.wofo-filter input');
      const body = panel.querySelector<HTMLElement>('.wofo-body');
      if (!input || !body) return;
      const q = (input.value || '').trim().toLowerCase();
      body.innerHTML = '';
      if (!state.tree) {
        body.innerHTML = '<div class="wofo-msg">No data</div>';
        return;
      }
      const cont = document.createElement('div');
      if (q) {
        const froot = filterTree(state.tree, q);
        if (!froot || !froot.children.length) {
          body.innerHTML = '<div class="wofo-msg">No matches</div>';
          return;
        }
        // Filtered results render as a collapsible tree, expanded so matches stay visible.
        froot.children.forEach((n) => appendNode(n, 0, cont, true));
      } else {
        state.tree.children.forEach((n) => appendNode(n, 0, cont, false));
      }
      body.appendChild(cont);
    }

    // ---------- panel ----------
    function positionPanel(): void {
      if (!panel || !activeList) return;
      const anchor =
        activeList.closest('.cdk-overlay-pane') ||
        activeList.closest('[class*=dialog]') ||
        activeList;
      const r = anchor.getBoundingClientRect();
      let left = r.left - PANEL_W - 12;
      if (left < 8) left = Math.min(r.right + 12, window.innerWidth - PANEL_W - 8);
      panel.style.left = Math.max(8, left) + 'px';
      panel.style.top = Math.max(8, r.top) + 'px';
      panel.style.height = Math.min(Math.max(r.height, 260), window.innerHeight - 16) + 'px';
    }

    function destroyPanel(): void {
      hideTip();
      if (panel) {
        panel.remove();
        panel = null;
      }
    }

    function buildPanel(): void {
      destroyPanel();
      panel = document.createElement('div');
      panel.className = 'wofo-panel';
      panel.innerHTML =
        '<div class="wofo-head">' +
        '<span class="wofo-title">Field Outline <span class="wofo-sub"></span></span>' +
        '<button class="wofo-btn wofo-rebuild" title="Rebuild outline">↻</button>' +
        '<button class="wofo-btn wofo-toggle" title="Collapse panel">–</button>' +
        '</div>' +
        '<div class="wofo-filter"><input type="text" placeholder="Filter fields..."></div>' +
        '<div class="wofo-body"><div class="wofo-msg">Building outline...</div></div>';
      document.body.appendChild(panel);
      panel.querySelector('.wofo-body')?.addEventListener('scroll', hideTip);

      const input = panel.querySelector<HTMLInputElement>('.wofo-filter input');
      let deb: ReturnType<typeof setTimeout> | undefined;
      input?.addEventListener('input', () => {
        if (deb) clearTimeout(deb);
        deb = setTimeout(renderTree, 140);
      });
      panel.querySelector('.wofo-rebuild')?.addEventListener('click', () => {
        if (activeList) void onModalOpen(activeList);
      });
      const toggleBtn = panel.querySelector<HTMLElement>('.wofo-toggle');
      toggleBtn?.addEventListener('click', () => {
        state.collapsed = !state.collapsed;
        panel?.classList.toggle('wofo-collapsed', state.collapsed);
        toggleBtn.textContent = state.collapsed ? '+' : '–';
      });
      positionPanel();
    }

    function showCover(): void {
      hideCover();
      if (!activeList) return;
      const r = activeList.getBoundingClientRect();
      const c = document.createElement('div');
      c.className = 'wofo-cover';
      c.style.cssText =
        'position:fixed;left:' +
        r.left +
        'px;top:' +
        r.top +
        'px;width:' +
        r.width +
        'px;height:' +
        r.height +
        'px';
      c.textContent = 'Building outline...';
      document.body.appendChild(c);
      state.cover = c;
    }

    function hideCover(): void {
      if (state.cover) {
        state.cover.remove();
        state.cover = null;
      }
    }

    // ---------- staleness guard ----------
    function markStale(): void {
      if (!panel) return;
      if (state.statusObs) {
        state.statusObs.disconnect();
        state.statusObs = null;
      }
      const body = panel.querySelector<HTMLElement>('.wofo-body');
      if (!body) return;
      body.innerHTML =
        '<div class="wofo-stale">The list was filtered or changed,<br>' +
        'so the outline is out of date.<br><button>Rebuild outline</button></div>';
      body.querySelector('button')?.addEventListener('click', () => {
        if (activeList) void onModalOpen(activeList);
      });
    }

    function watchStatus(list: HTMLElement): void {
      if (state.statusObs) state.statusObs.disconnect();
      const el = list.querySelector('.multi-select-list__status');
      if (!el) return;
      state.statusObs = new MutationObserver(() => {
        const t = readTotal(list);
        if (t && state.total && t !== state.total) markStale();
      });
      state.statusObs.observe(el, { childList: true, subtree: true, characterData: true });
    }

    // ---------- lifecycle ----------
    async function onModalOpen(list: HTMLElement): Promise<void> {
      const token = ++harvestToken;
      activeList = list;
      buildPanel();
      showCover();
      try {
        await waitFor(() => {
          const vp = list.querySelector('cdk-virtual-scroll-viewport');
          return vp && vp.querySelector('label.multi-select-list__item') ? vp : null;
        }, 6000);
        if (token !== harvestToken) return;
        const result = await harvest(list, token);
        if (token !== harvestToken) return;
        state.flat = result.flat;
        state.rowH = result.rowH;
        state.tree = buildTree(result.flat);
        state.total = readTotal(list);
        const groups = result.flat.filter((r) => r.group).length;
        const sub = panel?.querySelector('.wofo-sub');
        if (sub) {
          sub.textContent = '(' + (result.flat.length - groups) + ' fields, ' + groups + ' groups)';
        }
        renderTree();
        watchStatus(list);
      } catch (e) {
        warn('harvest failed:', e);
        const body = token === harvestToken ? panel?.querySelector('.wofo-body') : null;
        if (body) {
          body.innerHTML =
            '<div class="wofo-msg">Could not read the field list.<br>' +
            ((e instanceof Error && e.message) || '') +
            '</div>';
        }
      } finally {
        hideCover();
        positionPanel();
      }
    }

    function onModalClose(): void {
      harvestToken++;
      if (state.statusObs) {
        state.statusObs.disconnect();
        state.statusObs = null;
      }
      hideCover();
      destroyPanel();
      state.flat = null;
      state.tree = null;
    }

    window.addEventListener('resize', positionPanel);

    new MutationObserver(() => {
      const list = document.querySelector<HTMLElement>('w-multi-select-list');
      if (list && list !== activeList) {
        void onModalOpen(list);
      } else if (!list && activeList) {
        activeList = null;
        onModalClose();
      }
    }).observe(document.body, { childList: true, subtree: true });

    const existing = document.querySelector<HTMLElement>('w-multi-select-list');
    if (existing) void onModalOpen(existing);
  },
});
