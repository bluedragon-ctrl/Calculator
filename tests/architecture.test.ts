// Guards the rule from CLAUDE.md: src/sim must never import three.js or DOM APIs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim');
const FORBIDDEN_IMPORT = /from\s+['"](three|postprocessing|troika-three-text)(\/[^'"]*)?['"]|from\s+['"][^'"]*\/(render|ui)\//;
const FORBIDDEN_GLOBAL = /\b(document|window|requestAnimationFrame|localStorage|HTMLElement)\b/;

function tsFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('src/sim stays headless', () => {
  for (const file of tsFiles(SIM_DIR)) {
    it(`${file.slice(SIM_DIR.length + 1)} has no rendering/DOM dependencies`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(FORBIDDEN_IMPORT);
      expect(src).not.toMatch(FORBIDDEN_GLOBAL);
    });
  }
  it('check runs', () => expect(true).toBe(true));
});
