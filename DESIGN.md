# Inside the Calculator — Design Document

*Working title. Version 1.0 — design only, nothing implemented yet.*

An interactive web page that lets students fly from a pocket calculator down to individual transistors and watch, step by step, how pressing `3 + 4 =` turns into lit wires, switching transistors and digits on a display.

---

## 1. Purpose and audience

**Goal:** show what *really* happens inside a digital chip — not as a metaphor, but as a working (simplified) circuit the student can poke.

**Audience**
- Students aged 12+, plus interested adults.
- They explore **on their own**, without a teacher present. The page must teach by itself.
- **Desktop/laptop only** (their own PCs). Mouse + physical keyboard. No phone/tablet support needed.
- **English only.**

**Hosting:** static site on **GitHub Pages**. No backend.

### Goals
1. One coherent, *actually simulated* machine: a tiny calculator that adds and subtracts and has a one-number memory.
2. **Continuous zoom** through levels of abstraction: device → chip blocks → buses/bits → logic gates → transistors. Values are consistent at every level.
3. **Time control:** pause, single clock tick, slow motion. Signals travel visibly as "sparks" in slowed-down time.
4. **Self-guided learning:** missions, hover explanations, "break it" and "detective" modes.
5. Attractive neon look (three.js, bloom), but readability always wins over effects.

### Non-goals (v1)
- Phones/tablets, touch input, localisation.
- Analog electronics (voltages between 0 and 1, resistance, timing violations).
- Multi-digit number entry, multiplication/division.
- A stored-program CPU (planned as optional Phase 7).
- A circuit editor for students (they can toggle inputs and sabotage, not build).

---

## 2. Experience overview

### A typical first visit
1. Page opens on a **3D calculator** floating in a dark scene. A short prompt: *"Type 2 + 3 = on your keyboard."* The calculator works normally.
2. Prompt: *"How did it know? Let's look inside."* The camera lifts the cover and **dives into the chip**.
3. The chip shows a handful of glowing **blocks** (Keyboard encoder, Registers, Adder, Control, Display). Pressing a key now sends visible sparks between blocks.
4. The student scrolls into the **Adder** and sees 8 small boxes (one per bit), then into one box to see **gates**, then into one gate to see **transistors** switching.
5. Missions on the side panel guide the way, but the student can wander freely at any time.

### Screen layout (desktop, ≥ 1280×720)

```
┌──────────────────────────────────────────────────────────────┬──────────────────┐
│ Breadcrumb: Calculator › Chip › Adder › Bit 3 › XOR › NAND   │  MISSION PANEL   │
│                                                              │  title           │
│                                                              │  short text      │
│                    MAIN VIEW (three.js canvas)               │  [Next] [Hint]   │
│                                                              │                  │
│  ┌───────────┐                                               │  Mission list    │
│  │ mini-calc │  (HUD: display + clickable keys)              │  ✓ ✓ ● ○ ○       │
│  └───────────┘                                               │                  │
├──────────────────────────────────────────────────────────────┴──────────────────┤
│ CLOCK BAR:  ⏸ ▶  ⏭ step   speed [—●——]  slow-motion [——●—]  tick #42   ⚙ quality │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Mini-calculator HUD**: always visible except at device level. It mirrors the simulated display and has clickable keys. The physical keyboard works everywhere.
- **Breadcrumb**: shows the current zoom path. Each part is clickable to fly back out.
- **Hover tooltip** on any component or wire: name, one-sentence explanation, current value (decimal + binary for buses).
- **Mission panel**: can be collapsed.

---

## 3. The machine (functional specification)

### 3.1 Keys

16 keys, which encode to exactly 4 bits:

| Code | Key | Physical keyboard |
|---|---|---|
| 0–9 | digits | `0`–`9` |
| 10 | `+` | `+` |
| 11 | `−` | `-` |
| 12 | `=` | `=` or `Enter` |
| 13 | `C` (clear all except memory) | `Esc` or `Delete` |
| 14 | `M` (store display into memory) | `m` |
| 15 | `MR` (recall memory to display) | `r` |

Note: `+` = 1010 and `−` = 1011, so **bit 0 of the key code is the "subtract" flag**. The circuit uses this directly, and it's worth pointing out to students.

### 3.2 Behaviour
- **Numbers:** 8-bit two's complement, range **−128 … 127**. Digit keys enter a single digit 0–9; larger numbers arise from results, chaining and memory.
- **Display:** 4 seven-segment positions: sign, hundreds, tens, ones. Leading zeros are blank. Example: `  -27`, `  127`, `    5`.
- **Operations:** `a + b`, `a − b`, chaining (`3 + 4 + 5 =` → 12), using the result as the next first operand.
- **Memory:** `M` stores the displayed value. `MR` recalls it. An `M` indicator lights when memory ≠ 0. To clear memory, press `C` then `M` (this stores 0).
- **Overflow:** if a result leaves −128…127, the display shows **`Err`**, and only `C` works until cleared. This is a planned teaching moment.
- Pressing `=` with no pending operation does nothing. `3 + =` computes 3 + 3 = 6 (accepted quirk, which is simple to explain).

### 3.3 Registers and flags

| Name | Width | Meaning |
|---|---|---|
| `X` | 8 | Display/entry register. **The display always shows X.** |
| `Y` | 8 | Saved first operand |
| `M` | 8 | Memory |
| `OP` | 1 | Pending operation: 0 = add, 1 = subtract |
| `PEND` | 1 | An operation is pending |
| `E` | 1 | Error (overflow) |
| `KEY` | 4 | Last key code |
| `READY` | 1 | A new key is waiting to be processed |
| `STATE` | 4 | Control unit state |

---

## 4. Hardware design (what gets simulated)

The calculator uses **hardwired control**, like early pocket-calculator chips: a small state machine that drives a datapath.

### 4.1 Block diagram

```
 keys ──► [KEYBOARD ENCODER] ──code(4), pressed──► [KEY reg + READY]
                                                        │
                                        ┌───────────────┴──────────────┐
                                        ▼                              ▼
                                [KEY CLASS DECODER]            KEY[0] ──► OP reg
                                        │
     STATE, PEND, E, READY ───► [CONTROL UNIT (PLA)] ───► control signals, next STATE
                                        │
            ┌───────────────────────────┼──────────────────────┐
            ▼                           ▼                      ▼
   KEY ─┐                                                       
   ALU ─┤ [X MUX] ──► [X reg] ──┬──► [Y reg] ──► ALU.A          
   M ───┤                       ├──► [M reg] ──► X MUX, [ZERO DETECT] ─► "M" indicator
   0 ───┘                       ├──► ALU.B
                                └──► [DISPLAY ROM] ─► [ERR MUX] ─► [7-SEG DECODERS] ─► display
   ALU = 8-bit ripple-carry adder/subtractor; SUB input = OP reg; outputs R and V (overflow)
```

### 4.2 Datapath components
- **Keyboard encoder:** 16 key lines → 4-bit priority encoder + `pressed` (OR of all lines). Built from gates.
- **KEY register + READY flag:** loaded at the clock edge when `pressed` = 1.
- **Key class decoder:** `isDigit` (KEY < 10), `isOp` (10/11), `isEq` (12), `isC` (13), `isM` (14), `isMR` (15). Gates.
- **X input mux:** 4:1 × 8 bits. Sources: `KEY` (zero-extended), `ALU.R`, `M`, constant `0`. Select = `X_SRC[1:0]`.
- **Registers X, Y, M:** 8 D flip-flops each, with load enable (implemented as a 2:1 mux in front of each DFF: hold or load).
- **ALU:** 8 full adders in ripple-carry. `B' = X XOR SUB`, `carry_in = SUB`, `V = carry_into_bit7 XOR carry_out_of_bit7`. `SUB` comes from the `OP` register.
- **Zero detect** on M: 8-input NOR → `M` indicator.
- **Display ROM:** 256 entries. Input X (8 bits) → output sign (1) + three 4-bit digit codes (hundreds, tens, ones). Code 12 = blank (used for leading zeros). Generated by a script, never hand-written.
- **Err mux:** when `E` = 1, the digit codes are replaced by constants showing `Err` (sign off, codes `E`, `r`, `r`).
- **7-segment decoders (×3):** 4-bit code → 7 segments, built from gates. Codes 0–9 = digits, 10 = `E`, 11 = `r`, 12 = blank, 13–15 = blank. The sign position is just segment g (minus).

> **Reality check card (shown to students):** "Real calculator chips often stored numbers as decimal digits (BCD) instead of binary, which avoided this lookup table. We use binary because that's how computers work."

### 4.3 Control unit

The control unit is a **PLA (programmable logic array)**: a list of rules, each one an AND of conditions, OR-ed into outputs. Real chips used PLAs, and it shows well as a **"rulebook" table where the active rule lights up**.

**States** (4-bit encoding, 8 used): `IDLE, DIGIT, OP_CALC, OP_SAVE, EQ_CALC, CLR_1, CLR_2, MEM_STORE, MEM_RECALL` (9 states; adjust the encoding as needed).

**Control signals:** `X_LOAD, X_SRC[1:0], Y_LOAD, M_LOAD, OP_LOAD, PEND_SET, PEND_CLR, E_LOAD, E_CLR, READY_CLR, NEXT[3:0]`.

| # | State | Condition | Actions | Next |
|---|---|---|---|---|
| R1 | IDLE | !READY | — | IDLE |
| R2 | IDLE | READY & E & !isC | READY_CLR (key ignored) | IDLE |
| R3 | IDLE | READY & !E & isDigit | READY_CLR | DIGIT |
| R4 | IDLE | READY & !E & isOp & PEND | READY_CLR | OP_CALC |
| R5 | IDLE | READY & !E & isOp & !PEND | READY_CLR | OP_SAVE |
| R6 | IDLE | READY & !E & isEq & PEND | READY_CLR | EQ_CALC |
| R7 | IDLE | READY & !E & isEq & !PEND | READY_CLR | IDLE |
| R8 | IDLE | READY & isC | READY_CLR | CLR_1 |
| R9 | IDLE | READY & !E & isM | READY_CLR | MEM_STORE |
| R10 | IDLE | READY & !E & isMR | READY_CLR | MEM_RECALL |
| R11 | DIGIT | — | X_LOAD, X_SRC=KEY | IDLE |
| R12 | OP_CALC | — | X_LOAD, X_SRC=ALU, E_LOAD | OP_SAVE |
| R13 | OP_SAVE | — | Y_LOAD, OP_LOAD, PEND_SET | IDLE |
| R14 | EQ_CALC | — | X_LOAD, X_SRC=ALU, E_LOAD, PEND_CLR | IDLE |
| R15 | CLR_1 | — | X_LOAD, X_SRC=ZERO, E_CLR, PEND_CLR | CLR_2 |
| R16 | CLR_2 | — | Y_LOAD | IDLE |
| R17 | MEM_STORE | — | M_LOAD | IDLE |
| R18 | MEM_RECALL | — | X_LOAD, X_SRC=M | IDLE |

`E` register input: `E_CLR ? 0 : (E_LOAD ? V : E)`. `OP_LOAD` loads `KEY[0]`.

### 4.4 Clocking and key input
- One global clock. All registers are **rising-edge D flip-flops**. One **tick** = one clock edge plus the settling of all logic after it.
- **Key press:** the UI drives that key's line high. Students immediately see the encoder react (combinational logic). At the next rising edge, `KEY` and `READY` load, and the UI releases the line.
- If a key is pressed while the control unit is not in IDLE, the **UI** queues it. The queue is not part of the hardware and is shown as a small "waiting key" badge.

### 4.5 Example timeline: `7 + 9 =`

| Tick | Event | State after edge | Visible effect |
|---|---|---|---|
| 1 | key 7 captured | IDLE, READY=1 | KEY lights 0111 |
| 2 | R3 | DIGIT | rulebook row R3 lit |
| 3 | R11: X ← 7 | IDLE | display shows 7 |
| 4–6 | key `+`, R5, R13: Y ← 7, OP ← 0, PEND ← 1 | IDLE | Y shows 7 |
| 7–9 | key 9, R3, R11: X ← 9 | IDLE | display 9 |
| 10 | key `=` captured | IDLE | |
| 11 | R6 | EQ_CALC | **carry ripples through the adder (slow motion!)** |
| 12 | R14: X ← 16, PEND ← 0 | IDLE | display 16 |

---

## 5. Simulation engine

### 5.1 Principles
- Pure TypeScript, **no rendering imports**. It runs headless in tests.
- **Gate-level, event-driven, unit delay:** every primitive gate has a delay of 1 "delta step". This makes ripple effects (like the carry) visible and gives the renderer an exact timeline for sparks.
- **Deterministic:** the same inputs always produce the same timeline.

### 5.2 Component model

Every component definition has **pins**, and either a **structure** (child parts + nets), a **behaviour** (a JS function), or both.

**Primitives** (always behavioural):
- `NOT`, `NAND2`, `NAND3`, `NAND4`, `NOR2`, `NOR3`, `NOR4`. These are the **transistor-level leaves**: each has a hand-drawn CMOS schematic.
- `DFF`: behavioural in the full machine, for robustness against feedback/initialisation issues. It also has a structural definition (master–slave latches built from NAND gates), used for zoom views and the lab bench.
- `ROM`, `PLA`: behavioural, defined by a table.
- `CONST`, `SPLIT`/`JOIN` (bus ↔ wires; zero delay, view helpers).

**Composites** are built from primitives: `AND2` = NAND2 + NOT, `OR2` = NOR2 + NOT, `XOR2` = 4 × NAND2, `MUX2`, `MUX4`, `HalfAdder`, `FullAdder`, `Adder8`, `AddSub8`, `Register8`, `PriorityEncoder16`, `SevenSegDecoder`, etc. Students can therefore discover, for example, that "AND is secretly NAND + NOT".

**Flattening:** for simulation, the hierarchy is flattened to primitives. Components marked `simulateAs: 'behavior'` (DFF in the full machine) are kept as single nodes.

**Inner views of behavioural instances:** when the student zooms into a behaviourally simulated instance (e.g., a DFF), the engine creates a **local structural sub-simulation** driven by that instance's recorded pin values. A test must ensure the behavioural and structural versions always agree.

### 5.3 Tick algorithm

```
tick():
  1. sample D inputs of all DFFs (values before the edge)
  2. apply rising edge: update Q outputs → schedule change events at delta 0
  3. process event queue in delta order:
       for each net change at delta t: re-evaluate fan-out gates;
       if a gate output changes → schedule at t + delay
  4. stop when queue empty (settled). Safety limit: 10 000 deltas → report oscillation
  5. return Timeline: list of { netId, value, delta }
```

UI inputs (key lines, lab-bench toggles) inject changes at delta 0 of an **input settle** (no clock edge). They produce a timeline in the same way.

### 5.4 Values
- Nets carry `0 | 1`. Buses are arrays of nets with a convenience decimal value for display.
- No `X`/unknown state in v1. All registers reset to 0 on load.

### 5.5 Sabotage ("break it")
- Any net can be **forced**: `stuck-at-0` (cut wire), `stuck-at-1` (short to power).
- Any transistor can be forced `always-on` / `always-off`. Its gate is then evaluated at switch level for that instance only (truth table recomputed from the transistor network). This keeps the main sim fast while allowing transistor faults.

### 5.6 Statistics
- **Transistor count**, computed from the structure (NOT = 2, NAND2/NOR2 = 4, NAND3 = 6, …; DFF from its structural definition). Shown as "Transistors in this calculator: N" and "Transistors in view: n".

---

## 6. Rendering and visual design

### 6.1 Tech
- **three.js** + **postprocessing** (pmndrs) for selective bloom.
- **Thick lines:** three.js `Line2`/`LineMaterial`, or instanced quads for many segments. Batch geometry per component definition and update colours via attributes.
- **Text:** `troika-three-text` for in-scene labels. HTML overlays for tooltips and panels.

### 6.2 Two worlds
1. **Device world:** a perspective camera showing a stylised 3D calculator (simple geometry; keys with labels; the display driven by the simulated segments). The "Look inside" button, or scrolling into the device, plays a transition: the cover lifts and the camera dives into the chip.
2. **Chip world:** a **flat 2.5D plane** viewed top-down with an orthographic camera. All schematics live here. Zoom is continuous.

### 6.2a Real parts ("how it looks in real life")
Realism is added only where it is honest. CMOS logic contains **no resistors or capacitors**, so none are drawn as parts of gates.
- **Circuit board (device world, Phase 4):** when the cover lifts, a stylised board shows the chip package, battery, display, keypad contacts, a **decoupling capacitor** beside the chip and **pull-up/pull-down resistors** on the key lines. They are props with hover explanations. They are not simulated as analog parts, and the tooltip says so. A key-line resistor may match the logic ("holds the wire at 0 when no key is pressed").
- **Load capacitance (transistor view, Phase 2):** a faint capacitor symbol at each gate's output. It fills or drains through the highlighted conducting path while the spark travels. This shows the honest reason for the gate delay: charging the tiny unwanted capacitance of the wires. It is purely visual and mapped to the 1-delta delay, with no analog simulation.
- **Standard transistor symbols (Phase 2):** MOSFET symbols closer to textbooks replace the simplified ones. The switch icons stay.
- **Silicon view (Phase 4b):** a "Schematic | Silicon" toggle at gate and transistor level. It shows a stylised top-down layout: n/p diffusion (green), polysilicon gates (red), metal (blue), contacts (grey). It is generated from the same series/parallel description as the CMOS schematics, as a standard cell: PMOS row on top, NMOS row at the bottom, inputs as vertical poly stripes. Values light up exactly as in the schematic. The single-transistor bench gets an optional cross-section. It is opt-in, with a short legend, so readability does not suffer.
- **Reality-check cards:** older logic families (RTL/TTL) did use resistors; a 7400-family chip contains exactly four NAND gates (= our XOR).

### 6.3 Semantic zoom (level of detail)
- The scene graph mirrors the instance hierarchy. Every instance has a rectangle in its parent's coordinate space and its own internal layout.
- **LOD rule:** if an instance's on-screen width < ~140 px, draw it as a **box** (glowing outline, label, pins, bus values). Above ~220 px, draw its **contents**. Crossfade between the two.
- three.js objects for expanded instances are created lazily, cached, and disposed when far away. Off-screen instances are culled.
- Leaf gates expand into **CMOS transistor schematics**: VDD rail on top, GND rail on the bottom, the PMOS pull-up network, and the NMOS pull-down network.
- **Controls:** scroll = zoom toward the cursor, drag = pan, double-click = fly to fit the component, breadcrumb/`Backspace` = zoom out one level, `Home` = back to chip overview.

### 6.4 Visual language

| Thing | Look |
|---|---|
| Background | very dark navy (#070b14) with a faint grid |
| Wire = 0 | thin, dim blue-grey (#2a3550) |
| Wire = 1 | **thicker, bright cyan neon (#3df5ff) with bloom** |
| Bus | thick ribbon showing its value as a decimal label; expands into 8 wires when zoomed |
| Signal change | **spark**: a bright particle running from the driver along each branch toward the sinks. On 1 → 0, a fading "dimming wave" travels instead |
| Transistor on | channel glows, with a small "switch closed" icon |
| Transistor off | channel dark, "switch open" icon |
| Conducting path | in a gate's transistor view, the path that currently connects the output to VDD or GND is highlighted (where current flows when the output switches) |
| VDD / GND rails | warm amber / dim grey |
| Clock | pulses on every tick |
| Active PLA rule / ROM row | highlighted row |
| Sabotaged wire | red dashed with a ✂ icon |

- **On/off is never encoded by colour alone:** thickness and brightness also change, for colour-blind users.
- Bloom only on "1" wires, sparks and active transistors. Labels are never bloomed.

### 6.5 Time and motion
- The **sim timeline** of each tick is played back. `slow-motion` sets milliseconds per delta step (e.g., 20–400 ms). A spark's travel time along a wire = one delta step.
- **Clock modes:**
  - **Pause**, plus **Step** (one tick).
  - **Play** (0.25–4 ticks/s).
  - **Auto** (default): runs while the control unit is busy and pauses in IDLE.
  - **Instant**: no animation, so the calculator can just be used.
- Honest framing on screen: *"Time slowed down about a billion times. The spark shows the signal changing, not electrons moving."*
- Respect `prefers-reduced-motion`: no sparks, instant camera cuts.

### 6.6 Quality settings
- **High:** bloom, sparks, particles.
- **Low:** no post-processing; "glow" faked by an additive wider line.
- Auto-select by measuring frame time during the first seconds. A manual toggle is in ⚙.
- **Targets:** 60 fps on High with a typical laptop's built-in graphics in normal views. Initial download < 2 MB gzipped.
- If WebGL2 is not available, show a friendly message.

---

## 7. Learning design

### 7.1 Writing rules
- Plain English for 12-year-olds. **≤ 40 words per panel step**, one idea per step.
- Glossary words are underlined and explained on hover (transistor, bit, binary, bus, register, clock, carry, overflow, …).
- Analogy first, then the real thing: a transistor is first shown as "a tap controlled by a wire", then the real symbol.
- Decimal is always shown next to binary.
- **Reality-check cards** at each level: what's simplified and how real chips differ (size, speed, billions of transistors).

### 7.2 Lab bench
An isolated mini-scene with one component and clickable input switches. Used by missions and reachable from a menu. Benches:
- single transistor (NMOS, PMOS)
- NOT
- NAND
- NOR
- XOR
- half adder
- full adder
- 8-bit adder/subtractor
- SR latch (NOR)
- D latch
- D flip-flop
- 7-segment decoder

### 7.3 Missions

Missions are defined as **data**. Each step has: text, optional camera target, highlighted elements, and a **completion condition** (a predicate on sim state, camera/zoom state or UI events). Progress is saved in `localStorage` (with try/catch).

| # | Mission | Idea / completion |
|---|---|---|
| 1 | Hello, calculator | compute 2 + 3 at device level |
| 2 | Look inside | enter the chip world |
| 3 | The switch | lab bench: turn a transistor on and off |
| 4 | Two switches make a NOT | lab bench: see the inverter's output flip |
| 5 | NAND, the Lego brick | lab bench NAND; discover AND = NAND + NOT by zooming |
| 6 | Numbers are lights | press 5, find the 4 wires of KEY, read 0101 |
| 7 | Follow the 3 | press 3, step the clock, follow the value until it reaches X and the display |
| 8 | The ripple | compute 7 + 9 in slow motion with the adder in view; watch the carry ripple |
| 9 | Subtraction is a trick | compute 3 − 5; find the XOR gates flipping the bits and the carry-in = 1 |
| 10 | Too big! | cause an overflow (e.g. chain to > 127); find the V signal |
| 11 | Where memory lives | store a number with M; zoom into the M register and find the flip-flops holding it |
| 12 | The rulebook | press = and see which control rule lights up |
| 13 | Saboteur | cut a wire so that 2 + 2 ≠ 4 |
| 14 | Detective (×3) | a hidden fault is preloaded; find and fix it by testing and zooming |

### 7.4 Free exploration
All missions are skippable. The full machine, lab benches and break-it mode are always available.

---

## 8. Technical stack and repository

- **Language/build:** TypeScript, Vite.
- **Libraries:** three, postprocessing, troika-three-text. No UI framework; plain DOM + CSS for panels.
- **Tests:** Vitest.
- **Deploy:** GitHub Actions → GitHub Pages. All dependencies are bundled (no CDN at runtime, since school networks sometimes block CDNs).
- **Browsers:** latest Chrome, Edge, Firefox (Safari on macOS best-effort).

```
/src
  /sim          engine, primitives, flatten, timeline, sabotage, stats   (no three.js imports!)
  /circuits     component definitions + layouts (gates, adders, registers, alu, encoder, pla, rom, calculator)
  /circuits/gen scripts generating ROM tables (display ROM)
  /render       three.js scenes, wire/bus renderer, LOD, sparks, bloom, cameras, device model
  /ui           panels, HUD calculator, clock bar, tooltips, breadcrumb, keyboard handling, settings
  /missions     mission definitions (data) + condition helpers
  /content      glossary, reality-check cards, all student-facing text
  main.ts
/tests
/public
DESIGN.md
CLAUDE.md
```

### 8.1 Component definition format (sketch)

```ts
export const FullAdder = defineComponent({
  name: 'FullAdder',
  title: 'Full adder',
  blurb: 'Adds three single bits and gives a sum bit and a carry bit.',
  size: [14, 10],                               // grid units, its box in the parent
  pins: {
    a:    { dir: 'in',  side: 'left',  at: 2 },
    b:    { dir: 'in',  side: 'left',  at: 4 },
    cin:  { dir: 'in',  side: 'top',   at: 7 },
    sum:  { dir: 'out', side: 'right', at: 3 },
    cout: { dir: 'out', side: 'bottom', at: 7 },
  },
  parts: {
    x1: { type: 'XOR2', at: [3, 1] },
    x2: { type: 'XOR2', at: [8, 1] },
    // ...
  },
  nets: [
    { from: 'a', to: ['x1.a', 'n1.a'], route: [[1, 2], [3, 2]] },   // route optional → auto orthogonal
    // ...
  ],
});
```

- Layouts are **hand-authored** in grid units. Nets without a `route` get simple automatic orthogonal routing, which can be overridden later.
- Pins may have a `width` (buses).
- `defineComponent` validates: all pins connected, exactly one driver per net, no unknown parts.

---

## 9. Development phases

Each phase ends with something usable and deployed. **Finish and review each phase before starting the next.**

### Phase 0: Scaffold
Vite + TS, three.js scene with bloom test lines, quality toggle, GitHub Actions deploy, Vitest set up.
**Done when:** the deployed page shows glowing lines at 60 fps; `npm test` and `npm run build` pass.

### Phase 1: Simulation core + gates + transistor view
Engine (event-driven, timeline), `defineComponent`, primitives, `AND2`/`OR2`/`XOR2` composites, CMOS views of the primitives, wire renderer with sparks, lab bench with toggles.
**Done when:** exhaustive truth-table tests pass; the NOT/NAND/NOR/XOR benches work; zooming from XOR → NAND → transistors works.

### Phase 2: Adder and semantic zoom *(main technical risk; do it early)*
HalfAdder, FullAdder, Adder8, AddSub8 with overflow. Full LOD system, breadcrumb, fly-to, tooltips. Slow-motion carry ripple. Load-capacitor animation and standard MOSFET symbols in the transistor view (§6.2a).
**Done when:** exhaustive test of all 256 × 256 × {add, sub} against JS arithmetic (result + overflow) passes; zooming is smooth from the AddSub8 box down to transistors.

### Phase 3: Memory and clock
SR latch, D latch, structural DFF and behavioural DFF (plus an equivalence test), Register8, clock bar (pause/step/play/slow-motion).
**Done when:** the latch and flip-flop benches work and the register loads only on the clock edge with load enabled.

### Phase 4: Full calculator
Encoder, key class decoder, muxes, PLA control unit with rulebook view, display ROM (generated) with table view, 7-seg decoders, Err mux, zero-detect, top-level layout, mini-calculator HUD, keyboard input, key queue, 3D device world with fly-in transition and circuit board with real-part props (§6.2a), transistor counter.
**Done when:** scenario tests pass (e.g. `7+9=` → 16, `3-5=` → −2, `9+9+9+...` overflow → Err, `C` clears, `M`/`MR` work, chaining works); the calculator is fully usable at device level and in the chip view.

### Phase 4b: Silicon view
"Schematic | Silicon" toggle with generated standard-cell layouts for the primitives (§6.2a), consistent values in both views, a legend, and the single-transistor cross-section.
**Done when:** every primitive has a silicon layout whose transistors match its CMOS netlist (test), and toggling never changes values or zoom position.

### Phase 5: Learning layer
Mission system and the 14 missions, glossary, reality-check cards, break-it mode, detective mode, progress saving, first-visit onboarding.
**Done when:** every mission is completable, and mission-condition tests pass.

### Phase 6: Polish
Performance pass, test on a weak laptop, reduced-motion support, keyboard navigation of the UI, "About / for teachers" page.

### Phase 7 (optional): Mini CPU
A tiny stored-program CPU (~8 instructions) running the calculator as a program in ROM, to show fetch → decode → execute. For adults/advanced students.

---

## 10. Testing strategy
- **Truth tables:** exhaustive for every component with ≤ 10 inputs.
- **Arithmetic:** exhaustive for AddSub8 (131 072 cases).
- **Equivalence:** behavioural vs structural DFF, and behavioural vs switch-level evaluation for each primitive gate.
- **Scenarios:** key sequences → expected display (sign + digit codes) and register values.
- **Determinism:** the same scenario produces an identical timeline.
- **ROM generator:** all 256 display ROM entries match JS formatting of the number.
- **Missions:** each completion condition is tested with a scripted run.
- **Manual visual checklist** per phase (bloom readability, labels, LOD transitions, fps).

---

## 11. Open questions / decisions log

| Topic | Current decision | Revisit? |
|---|---|---|
| Chaining semantics | `3 + 4 + 5` computes progressively; `3 + =` → 6 | if students find it confusing |
| Memory keys | `M` (store), `MR`; clear = C then M | maybe `M+` in v2 (reuses the adder) |
| Multi-digit entry | not in v1 | v2: ×10 as (x<<3)+(x<<1) using the adder; a good lesson |
| Display conversion | 256-entry ROM | maybe a "double dabble" lab bench later |
| ROM/PLA inner view | table view only | maybe a transistor-grid illustration |
| Project name | "Inside the Calculator" (working) | |
| Selective bloom (Phase 0) | Bloom by brightness: only colours pushed above 1.0 (active wires, sparks, active transistors) pass the bloom threshold; labels stay ≤ 1.0. No render layers needed | if labels ever need HDR colours |
| Low-quality glow (Phase 0) | Wider additive line behind active wires, depth-tested so overlaps don't stack into blobs | |
| Type-only dev deps | `@types/three` and `@types/node` added alongside the listed deps (types only, nothing shipped) | |
| troika-three-text | Not installed until the first in-scene label is needed (Phase 1) | |
| Base path | Vite `base: './'` so the build works under any Pages sub-path | |
| Control states (§4.3) | Text says "4-bit encoding, 8 used" but lists 9 states; 4 bits fit all 9. To confirm in Phase 4 | Phase 4 |
| Component geometry (Phase 1) | `size` is the box in the parent's units (pins use it); the inside is drawn in an inner frame of `size × innerScale` (default 6), so every zoom level has its own grid | |
| Net routing (Phase 1) | Optional waypoints are given per sink (`routes: { 'n2.a': [...] }`) instead of one `route` per net; the last leg is auto-routed orthogonally. Junction dots are computed | |
| Gate delay semantics (Phase 1) | Transport delay: every change is kept, so real glitches (e.g. XOR's n3 going 1→0→1) are simulated and shown | if glitches confuse students |
| Spark timing (Phase 1) | A change on a net travels along its wires for one delta step (new value behind the front, spark at the front; dim wave for 1→0). Gates react when it arrives | |
| CMOS views (Phase 1) | Generated from the series/parallel description of each primitive (no hand-drawn schematics). Internal nodes between series transistors are drawn and lit by switch-level evaluation; the conducting path is highlighted amber (to VDD) or violet (to GND) | |
| LOD crossfade (Phase 2) | Opening/closing still uses hysteresis (open above 220 px, close below 140 px), then box and contents crossfade over 0.3 s (instant with reduced motion). A crossfade tied to the zoom position would leave half-faded layers on screen whenever the student stops zooming. Line materials are transparent so single objects can fade (per-object opacity set just before drawing) | |
| LOD size measure (Phase 2) | The rule uses the larger on-screen side, not only the width: same result for gates (wider than tall), but the tall 8-bit adder opens once it fills the screen's height | |
| LOD memory (Phase 2) | Contents are built when an instance first opens and cached. They are disposed when the instance is closed and smaller than 50 px, or more than 1.5 view sizes off screen. Off-screen instances are hidden, snapped closed and not updated (culling) | |
| Buses (Phase 2) | Pins stay single bits. A component lists `buses` (named groups of pins, LSB first, signed by default) used for box labels, tooltips (decimal + binary) and the bench's number boxes. Bus pins with `width`, ribbons and "expand into 8 wires" come with the top-level layout in Phase 4 | Phase 4 |
| Adder structure (Phase 2) | Full adder = two half adders + OR (half adder = XOR + AND), so zooming goes AddSub8 → 8-bit adder → full adder → half adder → XOR → NAND → transistors. Bits are stacked vertically, bit 0 on top, carry flowing down (as in the §8.1 sketch: `cin` top, `cout` bottom). The 8-bit adder exposes `c7` (carry into bit 7) so AddSub8 can compute `V` with one XOR | |
| Part labels (Phase 2) | Parts may have a `label` ("bit 3"), shown on the box and in the breadcrumb as "Full adder (bit 3)" | |
| Fly-to (Phase 2) | Zoom is interpolated in log space and the pan is tied to the zoom change, so the target stays on screen during deep flights (a linear pan drifts off screen). Duration 0.6–2 s depending on the zoom change. Backspace flies to the parent of the deepest opened instance at the screen centre; the breadcrumb starts with "Lab bench" (= Home) | |
| Load capacitor (Phase 2) | Faint plates from OUT to GND plus a gauge that fills (output → 1) or drains (→ 0) with an RC-like curve while the output's spark travels; the highlighted conducting path shows where the charge flows. Its tooltip says it explains the delay and is not a real part | |
| MOSFET symbols (Phase 2) | Three-terminal enhancement symbol: gate plate, channel (broken when off, solid and glowing when on), drain/source leads joining from the side, arrow on the source (out for NMOS, in for PMOS), bubble on the PMOS gate. Switch icons and P/N tags stay. NAND4/NOR4 boxes are 4 units wide to make room | |
| Bench layout (Phase 2) | The bench scales the box so pins are at least 0.8 world units apart, and shrinks switches/lamps to the pin spacing. Top inputs get switches above, bottom outputs lamps below. Benches with buses get number boxes, single-bit toggles and presets in the panel. Max zoom-in raised (view height 0.001) so a transistor of the AddSub8 can fill the screen | |
| Slow-motion range | Slider: 0 = instant, then 20–1000 ms per delta step (§6.5 suggested 20–400) | |
| Extra benches | AND and OR benches added (needed for mission 5); NAND3/4, NOR3/4 exist and are tested but have no bench yet | Phase 5 |
| Font | Inter SemiBold (OFL licence, `src/assets/fonts`) bundled for troika; labels are kept to Latin characters so troika never fetches fallback fonts from its CDN | |
| Real parts (after Phase 1 review) | No resistors/capacitors inside logic (CMOS has none). Real parts appear where honest: board props in the device world (Phase 4), load-capacitor animation and textbook MOSFET symbols (Phase 2), opt-in silicon layout view (new Phase 4b). See §6.2a | |
