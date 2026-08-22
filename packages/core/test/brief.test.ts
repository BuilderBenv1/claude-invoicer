import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBriefText } from '../src/brief.js';

describe('parseBriefText — money and ranges', () => {
  it('reads a tab-delimited row with an hours range and a cost range', () => {
    const r = parseBriefText('Build the API\t2-3 hrs\t$60-$90');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      title: 'Build the API',
      hoursLow: 2,
      hoursHigh: 3,
      amountLow: 60,
      amountHigh: 90,
    });
  });
  it('treats a single figure as both ends of the range', () => {
    const r = parseBriefText('Fixed piece\t4 hrs\t$120');
    expect(r.items[0]).toMatchObject({ hoursLow: 4, hoursHigh: 4, amountLow: 120, amountHigh: 120 });
  });
  it('accepts en dash, em dash, hyphen and "to" as range separators', () => {
    for (const sep of ['–', '—', '-', ' to ']) {
      const r = parseBriefText(`Item\t2${sep}3 hrs\t$60${sep}$90`);
      expect(r.items[0], sep).toMatchObject({ hoursLow: 2, hoursHigh: 3, amountLow: 60, amountHigh: 90 });
    }
  });
  it('reads fractional hours', () => {
    expect(parseBriefText('Small job\t0.5-1 hr\t$15-$30').items[0]).toMatchObject({ hoursLow: 0.5, hoursHigh: 1 });
  });
  it('strips thousands separators from money', () => {
    expect(parseBriefText('Big job\t40 hrs\t$1,200').items[0]!.amountLow).toBe(1200);
  });
  it('detects the currency from the first symbol seen', () => {
    expect(parseBriefText('A\t1 hr\t£50').currency).toBe('GBP');
    expect(parseBriefText('A\t1 hr\t$50').currency).toBe('USD');
    expect(parseBriefText('A\t1 hr\t€50').currency).toBe('EUR');
  });
  it('defaults the currency to GBP when no symbol appears', () => {
    expect(parseBriefText('A\t1 hr\t50').currency).toBe('GBP');
  });
});

describe('parseBriefText — structure', () => {
  it('picks up an hourly rate stated once', () => {
    expect(parseBriefText('Rate: $30/hr\nA\t1 hr\t$30').ratePerHour).toBe(30);
    expect(parseBriefText('Rate: £45 per hour\nA\t1 hr\t£45').ratePerHour).toBe(45);
  });
  it('assigns items to the numbered section above them', () => {
    const r = parseBriefText('1. Setup\nA\t1 hr\t$30\n2. Build\nB\t2 hrs\t$60');
    expect(r.items.map((i) => i.section)).toEqual(['1. Setup', '2. Build']);
  });
  it('takes the title from the first non-empty line', () => {
    expect(parseBriefText('A STORY TO TELL\nWork Estimate\nA\t1 hr\t$30').title).toBe('A STORY TO TELL');
  });
});

describe('parseBriefText — what it must NOT count', () => {
  it('skips subtotal rows and says so', () => {
    const r = parseBriefText('A\t1 hr\t$30\nSubtotal\t1 hr\t$30');
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/subtotal/i);
  });
  it('skips a table header row', () => {
    const r = parseBriefText('Work\tEstimated time\tEstimated cost\nA\t1 hr\t$30');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.title).toBe('A');
  });
  it('skips everything after an Overall Estimate heading', () => {
    const r = parseBriefText('1. Work\nA\t1 hr\t$30\nOverall Estimate\nArea\tHours\tCost\nWork\t1\t$30');
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/summary|overall/i);
  });
  it('ignores prose that merely mentions a number', () => {
    expect(parseBriefText('This estimate is valid for 30 days from 11 August 2026.').items).toHaveLength(0);
  });
  it('requires an amount or a duration, not just any text', () => {
    expect(parseBriefText('Some heading\nJust a sentence about the work.').items).toHaveLength(0);
  });
  it('returns an empty result rather than throwing on empty input', () => {
    const r = parseBriefText('');
    expect(r.items).toEqual([]);
    expect(r.title).toBe('');
  });
});

describe('parseBriefText — aggregate-word titles must survive', () => {
  it('does not drop genuine items whose titles merely start with an aggregate word', () => {
    const r = parseBriefText(
      [
        'Work on the API\t2 hrs\t$60',
        'Overall system redesign\t10 hrs\t$300',
        'Total infrastructure overhaul\t5 hrs\t$150',
        'Area of focus: mobile app\t3 hrs\t$90',
      ].join('\n'),
    );
    expect(r.items.map((i) => i.title)).toEqual([
      'Work on the API',
      'Overall system redesign',
      'Total infrastructure overhaul',
      'Area of focus: mobile app',
    ]);
  });
});

describe('parseBriefText — half-parsed rows are flagged, not silently zeroed', () => {
  it('warns when an accepted row has money but no hours unit', () => {
    const r = parseBriefText('Item\t2-3\t$60-$90');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ hoursLow: 0, hoursHigh: 0, amountLow: 60, amountHigh: 90 });
    expect(r.warnings.join(' ')).toMatch(/no hours found for "Item"/i);
  });
  it('warns when an accepted row has hours but no cost', () => {
    const r = parseBriefText('Item\t2-3 hrs');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ hoursLow: 2, hoursHigh: 3, amountLow: 0, amountHigh: 0 });
    expect(r.warnings.join(' ')).toMatch(/no cost found for "Item"/i);
  });
});

describe('parseBriefText — the skip warning names what it skipped', () => {
  it('lists the skipped row titles, not just a count', () => {
    const r = parseBriefText('A\t1 hr\t$30\nSubtotal\t1 hr\t$30\nWork\tEstimated time\tEstimated cost');
    expect(r.items).toHaveLength(1);
    const joined = r.warnings.join(' ');
    expect(joined).toMatch(/Subtotal/);
    expect(joined).toMatch(/Work/);
  });
});

describe('parseBriefText — a section costed in prose', () => {
  const doc = [
    '1. Build it',
    'A\t2 hrs\t$60',
    '4. Testing & Launch',
    "Once everything is built, I'll test the main journeys.",
    'Estimated time: 2-4 hours',
    'Estimated cost: $60-$120',
  ].join('\n');

  it('counts a prose-costed section as a work item', () => {
    const r = parseBriefText(doc);
    expect(r.items).toHaveLength(2);
  });
  it('titles it from the section heading, without the number', () => {
    const item = parseBriefText(doc).items[1]!;
    expect(item.title).toBe('Testing & Launch');
    expect(item.section).toBe('4. Testing & Launch');
  });
  it('reads both figures from the prose', () => {
    expect(parseBriefText(doc).items[1]).toMatchObject({
      hoursLow: 2, hoursHigh: 4, amountLow: 60, amountHigh: 120,
    });
  });
  it('does not invent an item from a heading with no figures', () => {
    expect(parseBriefText('1. Just a heading\nSome prose about it.').items).toHaveLength(0);
  });
  it('does not double-count a section that has BOTH a table and prose totals', () => {
    const both = ['1. Work', 'A\t2 hrs\t$60', 'Estimated time: 2 hours', 'Estimated cost: $60'].join('\n');
    const r = parseBriefText(both);
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/prose|total/i);
  });
});

describe('parseBriefText — a real client estimate', () => {
  const text = readFileSync(
    fileURLToPath(new URL('./fixtures/story-to-tell-estimate.txt', import.meta.url)),
    'utf8',
  );
  const parsed = parseBriefText(text);

  it('finds every work item and no subtotal or summary row', () => {
    expect(parsed.items).toHaveLength(13);
  });
  it('does not double-count: the money matches the sum of the sections', () => {
    expect(parsed.items.reduce((s, i) => s + i.amountLow, 0)).toBe(1425);
    expect(parsed.items.reduce((s, i) => s + i.amountHigh, 0)).toBe(2130);
  });
  it('totals the hours across all four sections', () => {
    expect(parsed.items.reduce((s, i) => s + i.hoursLow, 0)).toBeCloseTo(47.5, 5);
    expect(parsed.items.reduce((s, i) => s + i.hoursHigh, 0)).toBeCloseTo(71, 5);
  });
  it('groups the items under their four sections', () => {
    const sections = [...new Set(parsed.items.map((i) => i.section))];
    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatch(/Free \+ Pro/);
  });
  it('reads the rate and currency from the document', () => {
    expect(parsed.ratePerHour).toBe(30);
    expect(parsed.currency).toBe('USD');
  });
  it('reports what it skipped rather than dropping it silently', () => {
    expect(parsed.warnings.join(' ')).toMatch(/subtotal|summary|overall/i);
  });
  it('takes the document title from its first line', () => {
    expect(parsed.title).toBe('A STORY TO TELL');
  });
});
