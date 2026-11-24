// Inner views of behavioural instances (DESIGN.md §5.2). The full machine simulates each
// D flip-flop as one behavioural node. When the student zooms into one, a small structural
// copy is simulated on its own, driven by the values seen at the instance's pins.
import { flatten, type Circuit } from './flatten';
import { inputPins, type Library } from './library';
import { Simulator, type Timeline } from './simulator';
import type { Bit, ComponentDef } from './types';

export class LocalSim {
  readonly circuit: Circuit;
  readonly sim: Simulator;

  /**
   * @param inputs current values of the instance's input pins
   * @param stored the bit the behavioural instance stores (its Q)
   */
  constructor(readonly def: ComponentDef, lib: Library, inputs: Record<string, Bit>, stored: Bit) {
    this.circuit = flatten(def, lib, { structural: true });
    this.sim = new Simulator(this.circuit);
    const clocked = def.behavior?.clocked;
    if (clocked) {
      // Bring the gates into the stored state: present it at D and clock it in. If the clock
      // is high right now, leave it high so the master stays closed (as in the real circuit).
      this.drive({ [clocked.d]: stored, [clocked.clk]: 0 });
      this.drive({ [clocked.clk]: 1 });
      if (!inputs[clocked.clk]) this.drive({ [clocked.clk]: 0 });
    }
    this.drive(inputs);
  }

  /** Apply new pin values (one settle) and return what happened inside. */
  drive(values: Record<string, Bit>): Timeline {
    const ins = new Set(inputPins(this.def));
    for (const [pin, v] of Object.entries(values)) if (ins.has(pin)) this.sim.setInput(pin, v);
    return this.sim.settle();
  }
}
