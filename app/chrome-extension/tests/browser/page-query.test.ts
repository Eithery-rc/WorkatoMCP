/**
 * The in-page halves of chrome_search_page and chrome_find_elements, run
 * against a jsdom document the way chrome.scripting runs them in a tab.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findElementsInPage,
  searchPageInPage,
} from '@/entrypoints/background/tools/browser/page-query';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="jobs" class="list main">
      <span class="row">Job 101 failed: NetSuite timeout</span>
      <span class="row">Job 102 succeeded</span>
      <span class="row" style="display:none">Job 103 failed hidden</span>
    </div>
    <form>
      <input name="email" value="a@b.c" type="text">
      <input name="pw" value="secret" type="password">
      <a href="/next" aria-label="Next page">Next</a>
    </form>
    <div id="host"></div>`;
  const host = document.getElementById('host')!;
  host.attachShadow({ mode: 'open' }).innerHTML = '<p class="shadow">Job 104 failed in shadow</p>';
});

describe('searchPageInPage', () => {
  it('returns visible matches with context and the holding element', () => {
    const r = searchPageInPage('failed', false, false, 12, null, 20);
    expect(r.ok).toBe(true);
    // The hidden row is skipped; the open shadow root is searched.
    expect(r.total_matches).toBe(2);
    expect(r.matches![0]).toMatchObject({
      text: 'failed',
      element: 'div#jobs.list.main > span.row',
    });
    expect(r.matches![0].context_before).toContain('Job 101');
    expect(r.matches!.map((m) => m.element)).toContain('p.shadow');
  });

  it('supports regex, case sensitivity, cssScope and caps the results', () => {
    expect(searchPageInPage('job 10[12]', true, false, 5, null, 20).total_matches).toBe(2);
    expect(searchPageInPage('job', false, true, 5, null, 20).total_matches).toBe(0);
    const scoped = searchPageInPage('Job', false, true, 5, 'form', 20);
    expect(scoped.total_matches).toBe(0);
    const capped = searchPageInPage('Job', false, true, 5, null, 1);
    expect(capped.matches).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it('names a bad regex or selector instead of throwing', () => {
    expect(searchPageInPage('(', true, false, 5, null, 20)).toMatchObject({ ok: false });
    expect(searchPageInPage('x', false, false, 5, '[[', 20).error).toContain('cssScope');
  });
});

describe('findElementsInPage', () => {
  it('returns the chosen attributes, text and masks passwords', () => {
    const r = findElementsInPage('input, a', ['name', 'value', 'href', 'aria-label'], true, 30);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(3);
    expect(r.items![0]).toMatchObject({ tag: 'input', attrs: { name: 'email', value: 'a@b.c' } });
    expect(r.items![1].attrs.value).toBe('***');
    expect(r.items![2]).toMatchObject({
      tag: 'a',
      attrs: { href: '/next', 'aria-label': 'Next page' },
      text: 'Next',
    });
  });

  it('looks into open shadow roots, caps results and reports a bad selector', () => {
    expect(findElementsInPage('p.shadow', ['class'], true, 30).total).toBe(1);
    const capped = findElementsInPage('span.row', ['class'], false, 2);
    expect(capped).toMatchObject({ total: 3, truncated: true });
    expect(capped.items![0].text).toBeUndefined();
    expect(findElementsInPage('[[', [], true, 30).error).toContain('Invalid selector');
  });
});
