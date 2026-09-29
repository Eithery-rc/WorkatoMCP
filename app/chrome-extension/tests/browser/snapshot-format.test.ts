import { describe, expect, it } from 'vitest';
import { formatAxTree } from '@/entrypoints/background/tools/browser/snapshot/ax-tree-formatter';
import { buildDomInfo } from '@/entrypoints/background/tools/browser/snapshot/dom-info';
import { matchNodes } from '@/entrypoints/background/tools/browser/snapshot/element-actions';

function counter() {
  let n = 0;
  const seen = new Map<number, number>();
  return (id: number) => {
    if (!seen.has(id)) seen.set(id, ++n);
    return seen.get(id) as number;
  };
}

const node = (
  nodeId: string,
  role: string,
  name: string,
  backend: number,
  childIds: string[] = [],
  extra: Record<string, unknown> = {},
) =>
  ({
    nodeId,
    role: { value: role },
    name: { value: name },
    backendDOMNodeId: backend,
    childIds,
    ...extra,
  }) as any;

describe('formatAxTree', () => {
  it('prints element state and keeps password values hidden', () => {
    const nodes = [
      node('1', 'RootWebArea', 'Form', 1, ['2', '3', '4', '5', '6']),
      node('2', 'textbox', 'Email', 2, [], {
        value: { value: 'a@b.co' },
        properties: [
          { name: 'required', value: { value: true } },
          { name: 'focused', value: { value: true } },
        ],
      }),
      node('3', 'textbox', 'Password', 3, [], { value: { value: 'secret' } }),
      node('4', 'checkbox', 'Remember', 4, [], {
        properties: [{ name: 'checked', value: { value: 'false' } }],
      }),
      node('5', 'button', 'More', 5, [], {
        properties: [
          { name: 'expanded', value: { value: false } },
          { name: 'disabled', value: { value: true } },
        ],
      }),
      node('6', 'link', 'Docs', 6, [], {
        properties: [{ name: 'url', value: { value: 'https://x.test/docs' } }],
      }),
    ];
    const dom = {
      pointerRoots: new Set<number>(),
      pointerText: new Set<number>(),
      passwordInputs: new Set([3]),
    };
    const { text, uids } = formatAxTree(nodes, { assignUid: counter(), dom });
    expect(uids).toHaveLength(5);
    expect(text).toContain('textbox "Email" [uid=1] value="a@b.co" focused required');
    expect(text).toContain('textbox "Password" [uid=2] value=(hidden)');
    expect(text).not.toContain('secret');
    expect(text).toContain('checkbox "Remember" [uid=3] checked=false');
    expect(text).toContain('button "More" [uid=4] collapsed disabled');
    expect(text).toContain('link "Docs" [uid=5] url=https://x.test/docs');
  });

  it('gives a role-less clickable div a uid named by its text, and nothing inside it', () => {
    const nodes = [
      node('1', 'RootWebArea', '', 1, ['2', '5']),
      node('2', 'generic', '', 20, ['3']),
      node('3', 'StaticText', 'Clone recipe', 30),
      node('5', 'link', 'Home', 50, ['6']),
      node('6', 'StaticText', 'Home', 60),
    ];
    const dom = {
      pointerRoots: new Set([20]),
      pointerText: new Set([30, 60]),
      passwordInputs: new Set<number>(),
    };
    const { text, uids } = formatAxTree(nodes, { assignUid: counter(), dom });
    expect(uids).toHaveLength(2);
    expect(text).toContain('generic "Clone recipe" [uid=1]');
    expect(text).not.toMatch(/StaticText "Clone recipe"/);
    expect(text).toContain('link "Home" [uid=2]');
    expect(text).toContain('StaticText "Home"');
    expect(text).not.toMatch(/StaticText "Home" \[uid/);
  });

  it('summarises the options of a select', () => {
    const nodes = [
      node('1', 'combobox', 'Country', 1, ['2']),
      node('2', 'MenuListPopup', '', 2, ['3', '4', '5', '6', '7']),
      node('3', 'MenuListOption', 'Austria', 3),
      node('4', 'MenuListOption', 'Belgium', 4),
      node('5', 'MenuListOption', 'Chile', 5),
      node('6', 'MenuListOption', 'Denmark', 6),
      node('7', 'MenuListOption', 'Egypt', 7),
    ];
    const { text } = formatAxTree(nodes, { assignUid: counter(), dom: null });
    expect(text).toContain('options(5): "Austria", "Belgium", "Chile", "Denmark", …');
  });
});

describe('buildDomInfo', () => {
  it('finds the outermost cursor:pointer element, its text and password inputs', () => {
    // strings: 0 '' 1 'DIV' 2 'SPAN' 3 '#text' 4 'pointer' 5 'auto' 6 'INPUT' 7 'type' 8 'password' 9 'BODY'
    const snap = {
      strings: ['', 'DIV', 'SPAN', '#text', 'pointer', 'auto', 'INPUT', 'type', 'password', 'BODY'],
      documents: [
        {
          nodes: {
            parentIndex: [-1, 0, 1, 2, 0],
            nodeType: [1, 1, 1, 3, 1],
            nodeName: [9, 1, 2, 3, 6],
            backendNodeId: [100, 101, 102, 103, 104],
            attributes: [[], [], [], [], [7, 8]],
          },
          layout: {
            nodeIndex: [0, 1, 2, 3, 4],
            styles: [[5], [4], [4], [4], [5]],
          },
        },
      ],
    };
    const info = buildDomInfo(snap);
    expect([...info.pointerRoots]).toEqual([101]);
    expect(info.pointerText.has(103)).toBe(true);
    expect(info.passwordInputs.has(104)).toBe(true);
  });
});

describe('matchNodes', () => {
  it('matches any of several texts, optionally by role', () => {
    const nodes = [node('1', 'heading', 'Deploy finished', 1), node('2', 'button', 'Retry', 2)];
    expect(matchNodes(nodes, ['failed', 'finished'])?.name).toBe('Deploy finished');
    expect(matchNodes(nodes, ['retry'], 'button')?.role).toBe('button');
    expect(matchNodes(nodes, ['retry'], 'link')).toBeNull();
  });
});
