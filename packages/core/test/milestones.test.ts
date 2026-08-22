import { describe, it, expect } from 'vitest';
import {
  renderMilestonesFile,
  parseMilestonesFile,
  mergeMilestonesFile,
  type MilestoneFileInput,
} from '../src/milestones.js';

const fixed: MilestoneFileInput = {
  briefTitle: 'A Story To Tell — Work Estimate',
  clientName: 'Clive',
  billingMode: 'fixed',
  currency: 'GBP',
  items: [
    { key: '8f2a', idx: 0, title: 'Discovery & spec', section: '1. Setup', amount: 800 },
    { key: 'c41d', idx: 1, title: 'API integration', amount: 1200 },
  ],
};

const tm: MilestoneFileInput = {
  ...fixed,
  billingMode: 'time',
  items: [
    { key: '8f2a', idx: 0, title: 'Discovery & spec', hoursLow: 6, hoursHigh: 8 },
    { key: 'c41d', idx: 1, title: 'API integration', hoursLow: 10, hoursHigh: 10 },
  ],
};

describe('renderMilestonesFile', () => {
  it('renders a heading, the client name and one unchecked line per item', () => {
    const out = renderMilestonesFile(fixed);
    expect(out).toContain('# A Story To Tell — Work Estimate');
    expect(out).toContain('Clive');
    expect(out).toContain('- [ ] M1 · Discovery & spec — £800 <!-- id:8f2a -->');
    expect(out).toContain('- [ ] M2 · API integration — £1,200 <!-- id:c41d -->');
  });

  it('shows an hours range instead of money for a time & materials brief', () => {
    const out = renderMilestonesFile(tm);
    expect(out).toContain('- [ ] M1 · Discovery & spec — 6–8 hrs <!-- id:8f2a -->');
    expect(out).toContain('- [ ] M2 · API integration — 10 hrs <!-- id:c41d -->');
  });

  it('omits the suffix when a fixed item has no amount', () => {
    const out = renderMilestonesFile({
      ...fixed,
      items: [{ key: 'aaaa', idx: 0, title: 'Unpriced work' }],
    });
    expect(out).toContain('- [ ] M1 · Unpriced work <!-- id:aaaa -->');
  });

  it('round-trips through the parser as all-unchecked', () => {
    const entries = parseMilestonesFile(renderMilestonesFile(fixed));
    expect(entries).toEqual([
      { key: '8f2a', checked: false },
      { key: 'c41d', checked: false },
    ]);
  });
});

describe('parseMilestonesFile', () => {
  it('reads a tick in either case and ignores prose', () => {
    const text = [
      'Some heading text that is not a milestone.',
      '- [x] M1 · Done thing — £800 <!-- id:aaaa -->',
      '- [X] M2 · Also done <!-- id:bbbb -->',
      '- [ ] M3 · Not done <!-- id:cccc -->',
      '* [x] M4 · Star bullet <!-- id:dddd -->',
    ].join('\n');
    expect(parseMilestonesFile(text)).toEqual([
      { key: 'aaaa', checked: true },
      { key: 'bbbb', checked: true },
      { key: 'cccc', checked: false },
      { key: 'dddd', checked: true },
    ]);
  });

  it('ignores a checklist line with no id comment', () => {
    expect(parseMilestonesFile('- [x] I typed this myself')).toEqual([]);
  });

  it('ignores an id comment that is not on a checklist line', () => {
    expect(parseMilestonesFile('Just prose <!-- id:aaaa -->')).toEqual([]);
  });

  it('tolerates leading indentation and extra spaces', () => {
    expect(parseMilestonesFile('   -   [x]   M1 · x   <!--  id:aaaa  -->')).toEqual([
      { key: 'aaaa', checked: true },
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = '- [x] a <!-- id:aaaa -->\r\n- [ ] b <!-- id:bbbb -->\r\n';
    expect(parseMilestonesFile(text)).toEqual([
      { key: 'aaaa', checked: true },
      { key: 'bbbb', checked: false },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseMilestonesFile('')).toEqual([]);
  });

  it('keeps the first occurrence when a key is duplicated', () => {
    const text = '- [x] a <!-- id:aaaa -->\n- [ ] b <!-- id:aaaa -->';
    expect(parseMilestonesFile(text)).toEqual([{ key: 'aaaa', checked: true }]);
  });
});

describe('mergeMilestonesFile', () => {
  it('writes the full scaffold when no file exists', () => {
    expect(mergeMilestonesFile(null, fixed)).toBe(renderMilestonesFile(fixed));
  });

  it('writes the full scaffold when the file is blank', () => {
    expect(mergeMilestonesFile('   \n  ', fixed)).toBe(renderMilestonesFile(fixed));
  });

  it('preserves a tick the user made', () => {
    const existing = renderMilestonesFile(fixed).replace('- [ ] M1', '- [x] M1');
    const merged = mergeMilestonesFile(existing, fixed);
    expect(merged).toContain('- [x] M1 · Discovery & spec');
    expect(parseMilestonesFile(merged)).toEqual([
      { key: '8f2a', checked: true },
      { key: 'c41d', checked: false },
    ]);
  });

  it('preserves user prose added around the list', () => {
    const existing = renderMilestonesFile(fixed) + '\nMy own notes here.\n';
    expect(mergeMilestonesFile(existing, fixed)).toContain('My own notes here.');
  });

  it('appends only keys the file does not already have', () => {
    const existing = renderMilestonesFile(fixed);
    const grown: MilestoneFileInput = {
      ...fixed,
      items: [...fixed.items, { key: 'eeee', idx: 2, title: 'New work', amount: 300 }],
    };
    const merged = mergeMilestonesFile(existing, grown);
    expect(parseMilestonesFile(merged).map((e) => e.key)).toEqual(['8f2a', 'c41d', 'eeee']);
    expect(merged.indexOf('- [ ] M1 · Discovery & spec')).toBe(
      existing.indexOf('- [ ] M1 · Discovery & spec'),
    );
  });

  it('appends without disturbing a tick already in the file', () => {
    const existing = renderMilestonesFile(fixed).replace('- [ ] M1', '- [x] M1');
    const grown: MilestoneFileInput = {
      ...fixed,
      items: [...fixed.items, { key: 'eeee', idx: 2, title: 'New work', amount: 300 }],
    };
    expect(parseMilestonesFile(mergeMilestonesFile(existing, grown))).toEqual([
      { key: '8f2a', checked: true },
      { key: 'c41d', checked: false },
      { key: 'eeee', checked: false },
    ]);
  });

  it('does not rewrite a line whose text the user edited', () => {
    const existing = renderMilestonesFile(fixed).replace(
      'M1 · Discovery & spec — £800',
      'M1 · Discovery (renamed by me)',
    );
    const merged = mergeMilestonesFile(existing, fixed);
    expect(merged).toContain('M1 · Discovery (renamed by me)');
    expect(merged).not.toContain('M1 · Discovery & spec — £800');
  });

  it('returns the file unchanged when every key is already present', () => {
    const existing = renderMilestonesFile(fixed);
    expect(mergeMilestonesFile(existing, fixed)).toBe(existing);
  });
});

describe('mergeMilestonesFile placement and line endings', () => {
  it('inserts a new milestone beside the others, not below the user notes', () => {
    const existing = renderMilestonesFile(fixed) + '\nNotes: waiting on the client.\n';
    const grown: MilestoneFileInput = {
      ...fixed,
      items: [...fixed.items, { key: 'eeee', idx: 2, title: 'New work', amount: 300 }],
    };
    const merged = mergeMilestonesFile(existing, grown);
    const lines = merged.split('\n');
    const newIdx = lines.findIndex((l) => l.includes('id:eeee'));
    const notesIdx = lines.findIndex((l) => l.startsWith('Notes:'));
    const m2Idx = lines.findIndex((l) => l.includes('id:c41d'));
    expect(newIdx).toBe(m2Idx + 1);
    expect(newIdx).toBeLessThan(notesIdx);
  });

  it('keeps CRLF endings when the file already uses them', () => {
    const existing = renderMilestonesFile(fixed).replace(/\n/g, '\r\n');
    const grown: MilestoneFileInput = {
      ...fixed,
      items: [...fixed.items, { key: 'eeee', idx: 2, title: 'New work', amount: 300 }],
    };
    const merged = mergeMilestonesFile(existing, grown);
    expect(merged).toContain('\r\n');
    // No bare LF that isn't part of a CRLF pair.
    expect(/(^|[^\r])\n/.test(merged)).toBe(false);
    expect(parseMilestonesFile(merged).map((e) => e.key)).toEqual(['8f2a', 'c41d', 'eeee']);
  });

  it('still preserves a tick when inserting beside it', () => {
    const existing = renderMilestonesFile(fixed).replace('- [ ] M1', '- [x] M1') + '\nMy notes\n';
    const grown: MilestoneFileInput = {
      ...fixed,
      items: [...fixed.items, { key: 'eeee', idx: 2, title: 'New work', amount: 300 }],
    };
    const merged = mergeMilestonesFile(existing, grown);
    expect(parseMilestonesFile(merged)).toEqual([
      { key: '8f2a', checked: true },
      { key: 'c41d', checked: false },
      { key: 'eeee', checked: false },
    ]);
    expect(merged).toContain('My notes');
  });

  it('appends at the end when the file has no milestone lines at all', () => {
    const merged = mergeMilestonesFile('Just my own notes, no list yet.\n', fixed);
    expect(merged).toContain('Just my own notes');
    expect(parseMilestonesFile(merged).map((e) => e.key)).toEqual(['8f2a', 'c41d']);
  });
});
