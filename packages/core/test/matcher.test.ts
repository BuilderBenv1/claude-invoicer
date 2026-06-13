import { describe, it, expect } from 'vitest';
import { normalizePath, isUnder, matchClientId, matchMapping } from '../src/matcher.js';
import type { FolderMapping } from '../src/types.js';

describe('normalizePath', () => {
  it('converts backslashes, lowercases, and strips trailing slash', () => {
    expect(normalizePath('C:\\Users\\Theka\\Project\\')).toBe('c:/users/theka/project');
  });
  it('collapses repeated slashes', () => {
    expect(normalizePath('C:\\\\Users//theka')).toBe('c:/users/theka');
  });
  it('handles empty input', () => {
    expect(normalizePath('')).toBe('');
  });
});

describe('isUnder', () => {
  it('matches the folder itself and any descendant', () => {
    expect(isUnder('C:/clients/acme', 'C:/clients/acme')).toBe(true);
    expect(isUnder('C:/clients/acme/app/src', 'C:/clients/acme')).toBe(true);
  });
  it('does not match a sibling with a shared prefix', () => {
    expect(isUnder('C:/clients/acme-2', 'C:/clients/acme')).toBe(false);
  });
});

describe('matchClientId', () => {
  const mappings: FolderMapping[] = [
    { clientId: 'broad', path: 'C:/clients' },
    { clientId: 'acme', path: 'C:/clients/acme' },
  ];

  it('matches subfolders to the owning client', () => {
    expect(matchClientId('C:/clients/other/app', mappings)).toBe('broad');
  });

  it('uses the longest (most specific) prefix when mappings nest', () => {
    expect(matchClientId('C:/clients/acme/app/src', mappings)).toBe('acme');
  });

  it('is case-insensitive and backslash-aware (Windows)', () => {
    const m: FolderMapping[] = [
      { clientId: 'bromley', path: 'C:\\Users\\theka\\OneDrive\\Desktop\\bromley-scraper' },
    ];
    const cwd = 'C:\\Users\\Theka\\ONEDRIVE\\Desktop\\Bromley-Scraper\\src';
    expect(matchClientId(cwd, m)).toBe('bromley');
  });

  it('returns null for an unmapped folder (never billed)', () => {
    expect(matchClientId('C:/my-own-stuff/hackmonty', mappings)).toBeNull();
  });
});

describe('matchMapping', () => {
  it('returns the most specific mapping object', () => {
    const mappings: FolderMapping[] = [
      { clientId: 'broad', path: 'C:/clients', label: 'All' },
      { clientId: 'acme', path: 'C:/clients/acme', label: 'Acme Corp' },
    ];
    expect(matchMapping('C:/clients/acme/x', mappings)?.label).toBe('Acme Corp');
  });
});
