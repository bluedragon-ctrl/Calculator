// The library of every component in the calculator, in dependency order.
import { Library } from '../sim/library';
import { defineAdders } from './adders';
import { defineGates } from './gates';
import { definePrimitives } from './primitives';

export function createLibrary(): Library {
  const lib = new Library();
  definePrimitives(lib);
  defineGates(lib);
  defineAdders(lib);
  return lib;
}

export const library = createLibrary();
