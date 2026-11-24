// Statistics (DESIGN.md §5.6): transistor counts computed from the structure.
import { cmosNetlist } from './switchLevel';
import type { Library } from './library';
import type { ComponentDef } from './types';

/**
 * Transistors in one instance of `def`: CMOS gates count their transistors, composites (also a
 * behaviourally simulated flip-flop) count their structure, and table-driven parts (ROM, PLA)
 * use their estimate.
 */
export function transistorCount(def: ComponentDef, lib: Library, cache = new Map<string, number>()): number {
  const hit = cache.get(def.name);
  if (hit !== undefined) return hit;
  let n = 0;
  if (def.cmos) n = cmosNetlist(def.cmos).transistors.length;
  else if (def.parts) {
    for (const p of Object.values(def.parts)) n += transistorCount(lib.get(p.type), lib, cache);
  } else n = def.transistors ?? 0;
  cache.set(def.name, n);
  return n;
}
