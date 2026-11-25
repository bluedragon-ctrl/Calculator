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
│ ⤢ Fit view  Chip › Adder › Bit 3 › XOR › NAND                 │  Explore [menu▾] │
│                                                              │  MISSION PANEL   │
│                                                              │  short text      │
│                    MAIN VIEW (three.js canvas)               │  [Next] [Hint]   │
│                                                              │                  │
│  ┌───────────┐                                               │  Mission list    │
│  │ mini-calc │  (HUD: display + clickable keys)              │  ✓ ✓ ● ○ ○       │
│  └───────────┘                                               │                  │
├──────────────────────────────────────────────────────────────┴──────────────────┤
│ CLOCK BAR:  ⏸ pause  ⏭ step  ▶ run   speed [slow —●— instant]   tick #42   ⚙ quality │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Mini-calculator HUD**: always visible except at device level. It mirrors the simulated display and has clickable keys. The physical keyboard works everywhere.
- **Explore menu**: one grouped drop-down (Calculator, Transistors, Gates, Building blocks, Memory) chooses the scene. It is the only place that names the scene.
- **Breadcrumb**: shows the zoom path inside the scene. Each part is clickable to fly back out. A **Fit view** button in front of it zooms out to the whole scene.
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

**States** (4-bit binary encoding, 9 used): `IDLE`=0, `DIGIT`=1, `OP_CALC`=2, `OP_SAVE`=3, `EQ_CALC`=4, `CLR_1`=5, `CLR_2`=6, `MEM_STORE`=7, `MEM_RECALL`=8. Codes 9–15 match no rule, so every output is 0 and the next state is `IDLE`.

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
| 7–9 | key 9, R3, R11: X ← 9 | IDLE | display 9; **the adder already computes 7 + 9: the carry ripples (slow motion!)** |
| 10 | key `=` captured | IDLE | |
| 11 | R6 | EQ_CALC | rulebook row R6 lit; the X mux switches to the ALU |
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
- **Silicon view (Phase 4b):** a toggle (named "Diagram | Real chip" since Phase 4c, §11) at gate and transistor level. It shows a stylised top-down layout: n/p diffusion (green), polysilicon gates (red), metal (blue), contacts (grey). It is generated from the same series/parallel description as the CMOS schematics, as a standard cell: PMOS row on top, NMOS row at the bottom, inputs as vertical poly stripes. Values light up exactly as in the schematic. The single-transistor bench gets an optional cross-section. It is opt-in, with a short legend, so readability does not suffer.
- **Real-chip views (Phase 4c):** the toggle extends to every level inside the chip: a stylised die floorplan at chip level and cell miniatures on closed boxes. The dive into the chip takes the package lid off and shows the die with its bond wires. The device world gets an opt-in LCD-segment close-up. See Phase 4c in §9 and §11.
- **Reality-check cards:** older logic families (RTL/TTL) did use resistors; a 7400-family chip contains exactly four NAND gates (= our XOR).

### 6.3 Semantic zoom (level of detail)
- The scene graph mirrors the instance hierarchy. Every instance has a rectangle in its parent's coordinate space and its own internal layout.
- **LOD rule:** if an instance's on-screen width < ~140 px, draw it as a **box** (glowing outline, label, pins, bus values). Above ~220 px, draw its **contents**. Crossfade between the two.
- three.js objects for expanded instances are created lazily, cached, and disposed when far away. Off-screen instances are culled.
- Leaf gates expand into **CMOS transistor schematics**: VDD rail on top, GND rail on the bottom, the PMOS pull-up network, and the NMOS pull-down network.
- **Controls:** scroll = zoom toward the cursor, drag = pan, double-click = fly to fit the component, breadcrumb/`Backspace` = zoom out one level, `Home` or the **Fit view** button = zoom out to the whole scene.

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
- The **sim timeline** of each tick is played back. One **speed** slider sets milliseconds per delta step (1000 → 20 ms) and, at its right end, **Instant** (no animation, so the calculator can just be used). A spark's travel time along a wire = one delta step.
- **Clock modes:**
  - **Pause**, plus **Step** (one tick).
  - **Run** (default on the calculator): ticks at a rate tied to the speed slider (0.5–4 ticks/s), never before the last tick has finished playing. With a control unit it runs only while there is work and stops by itself in IDLE; on a bench it runs freely. Benches open paused.
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
- single transistor (NMOS, PMOS), with an optional cross-section (Phase 4b)
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

### Phase 4c: Real-chip views
Make the "real" view useful at every level inside the chip (§6.2a), not only at transistor level:
- **Die view (chip level):** the chip as a stylised silicon die. One region per block, area to scale with its transistor count; gate blocks as rows of cells, ROM and PLA as regular grids; bond pads on the edge and bond wires to the package pins. Each block's pattern is baked into one texture (performance). Blocks glow while they are switching. Labels stay on top and unbloomed. A note says "a sketch: sizes to scale, wiring not drawn".
- **Cell miniatures (gate level):** with the toggle on, closed gate boxes show a small static copy of their cell layout instead of the gate symbol.
- **Dive transition:** package lid off → die with bond wires → fade into the block diagram.
- **Display close-up (device world):** an opt-in cutaway of one LCD segment (glass, electrodes, liquid crystal, polarisers); the segment darkens when its wire is 1. The tooltip notes that real calculators multiplex segment wires and ours does not.
- **Optional, if time allows:** keypad cutaway (rubber dome, carbon pad, contacts) and package cutaway (lead frame, bond wires, die).
- **Not in scope:** composite parts drawn as placed and routed cell rows (needs a real placer and router to be honest; the cell miniatures carry the idea).

**Done when:** inside the chip the toggle is always visible and every level changes visibly when it is flipped (chip → die view, gate level → cell miniatures, transistor level → layout); die regions match block transistor counts (test); miniatures are the same layouts as the tested silicon cells (test); toggling never changes values or zoom position; 60 fps on High holds on the chip overview with the die view on.

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
| Control states (§4.3) | Binary 0–8 in the 4-bit STATE register (confirmed in Phase 4). Unused codes 9–15 match no rule, so the PLA outputs all 0 and the next state is IDLE | |
| Component geometry (Phase 1) | `size` is the box in the parent's units (pins use it); the inside is drawn in an inner frame of `size × innerScale` (default 6), so every zoom level has its own grid | |
| Net routing (Phase 1) | Optional waypoints are given per sink (`routes: { 'n2.a': [...] }`) instead of one `route` per net; the last leg is auto-routed orthogonally. Junction dots are computed | |
| Gate delay semantics (Phase 1) | Transport delay: every change is kept, so real glitches (e.g. XOR's n3 going 1→0→1) are simulated and shown | if glitches confuse students |
| Spark timing (Phase 1) | A change on a net travels along its wires for one delta step (new value behind the front, spark at the front; dim wave for 1→0). Gates react when it arrives | |
| CMOS views (Phase 1) | Generated from the series/parallel description of each primitive (no hand-drawn schematics). Internal nodes between series transistors are drawn and lit by switch-level evaluation; the conducting path is highlighted amber (to VDD) or violet (to GND) | |
| LOD crossfade (Phase 2) | Opening/closing still uses hysteresis (open above 220 px, close below 140 px), then box and contents crossfade over 0.3 s (instant with reduced motion). A crossfade tied to the zoom position would leave half-faded layers on screen whenever the student stops zooming. Line materials are transparent so single objects can fade (per-object opacity set just before drawing) | |
| LOD size measure (Phase 2) | The rule uses the larger on-screen side, not only the width: same result for gates (wider than tall), but the tall 8-bit adder opens once it fills the screen's height | |
| LOD memory (Phase 2) | Contents are built when an instance first opens and cached. They are disposed when the instance is closed and smaller than 50 px, or more than 1.5 view sizes off screen. Off-screen instances are hidden, snapped closed and not updated (culling) | |
| Buses (Phase 2) | Pins stay single bits. A component lists `buses` (named groups of pins, LSB first, signed by default) used for box labels, tooltips (decimal + binary) and the bench's number boxes. Phase 4: no bus pins with `width` were needed. The router gives the 8 wires of a bus neighbouring tracks, so at overview zoom they merge into one ribbon and separate into 8 wires as you zoom in; the decimal value is on the blocks' boxes ("Q = 16") and in tooltips | if a separate ribbon drawing is wanted |
| Adder structure (Phase 2) | Full adder = two half adders + OR (half adder = XOR + AND), so zooming goes AddSub8 → 8-bit adder → full adder → half adder → XOR → NAND → transistors. Bits are stacked vertically, bit 0 on top, carry flowing down (as in the §8.1 sketch: `cin` top, `cout` bottom). The 8-bit adder exposes `c7` (carry into bit 7) so AddSub8 can compute `V` with one XOR | |
| Part labels (Phase 2) | Parts may have a `label` ("bit 3"), shown on the box and in the breadcrumb as "Full adder (bit 3)" | |
| Fly-to (Phase 2) | Zoom is interpolated in log space and the pan is tied to the zoom change, so the target stays on screen during deep flights (a linear pan drifts off screen). Duration 0.6–2 s depending on the zoom change. Backspace flies to the parent of the deepest opened instance at the screen centre; the breadcrumb starts with "Lab bench" (= Home) | |
| Load capacitor (Phase 2) | Faint plates from OUT to GND plus a gauge that fills (output → 1) or drains (→ 0) with an RC-like curve while the output's spark travels; the highlighted conducting path shows where the charge flows. Its tooltip says it explains the delay and is not a real part | |
| MOSFET symbols (Phase 2) | Three-terminal enhancement symbol: gate plate, channel (broken when off, solid and glowing when on), drain/source leads joining from the side, arrow on the source (out for NMOS, in for PMOS), bubble on the PMOS gate. Switch icons and P/N tags stay. NAND4/NOR4 boxes are 4 units wide to make room | |
| Bench layout (Phase 2) | The bench scales the box so pins are at least 0.8 world units apart, and shrinks switches/lamps to the pin spacing. Top inputs get switches above, bottom outputs lamps below. Benches with buses get number boxes, single-bit toggles and presets in the panel. Max zoom-in raised (view height 0.001) so a transistor of the AddSub8 can fill the screen | |
| Slow-motion range | Slider: 0 = instant, then 20–1000 ms per delta step (§6.5 suggested 20–400) | superseded: "One speed control" |
| Extra benches | AND and OR benches added (needed for mission 5); NAND3/4, NOR3/4 exist and are tested but have no bench yet | Phase 5 |
| Font | Inter SemiBold (OFL licence, `src/assets/fonts`) bundled for troika; labels are kept to Latin characters so troika never fetches fallback fonts from its CDN | |
| Real parts (after Phase 1 review) | No resistors/capacitors inside logic (CMOS has none). Real parts appear where honest: board props in the device world (Phase 4), load-capacitor animation and textbook MOSFET symbols (Phase 2), opt-in silicon layout view (new Phase 4b). See §6.2a | |
| Latch power-on (Phase 3) | With every net at 0 and unit delay, a symmetric cross-coupled latch oscillates. Components can list `powerOn` values for nets (keyed by driver); every latch and flip-flop starts in a defined reset state (Q = 0, consistent internal nodes), matching §5.4. Behavioural flip-flops store 0. A test checks that every component powers on without oscillating | |
| Structural DFF (Phase 3) | Master–slave from two NAND D latches plus an inverter on the clock (as §5.2 says), not the 6-NAND edge-triggered design. D latch = 4 NAND2 (the input NANDs gate D with E; the second one takes the first one's output, so no inverter is needed). The D latch exposes only Q (Q̄ stays inside, as every part pin must be connected); the SR latch (2 NOR2) exposes Q and QN | |
| Clock signal (Phase 3) | The clock is a top-level input `clk`. `tick()` (§5.3): sample D of all behavioural DFFs, rising edge (behavioural Q and `clk` change at delta 0), settle, then the clock falls and settles again, as one timeline. The fall starts 2 delta steps after the rise has settled, so the pulse is visible. Behavioural DFFs only change in `tick()` and ignore their `clk` pin; structural ones react to `clk` itself | |
| Behavioural vs structural (Phase 3) | Register8 uses behavioural DFFs, as the full machine will. A bench of a component that is behavioural itself (the DFF) simulates its structure (`flatten(…, { structural: true })`). Tests compare both versions on every sequence of up to 7 actions (DFF) and on random register runs | |
| Inside a behavioural DFF (Phase 3) | Opening one builds a local structural copy (`LocalSim`) with its own playback. It starts by clocking in the stored bit, then follows the *displayed* values at the instance's pins (when a spark arrives). So inside, Q changes a few gate delays after the outside Q (the behavioural model changes at the edge). The tooltip explains that the inside is replayed | |
| Register layout (Phase 3) | `MUX2` = NOT + 3 NAND2, with the select pin between a and b so it needs no crossings. A `RegBit` composite (mux + DFF) gives the zoom path register → bit → flip-flop → D latch → NAND → transistors. CLK and LOAD enter Register8 at the bottom left and run up to every bit; their branches and the D lines cross (unavoidable, drawn without junction dots) | |
| Clock bar (Phase 3) | Pause / Step / (Phase 4: Auto) / Play / Instant, one mode at a time. Play (0.25–4 ticks/s) waits until the last tick has finished playing, so slow motion also slows the clock. Instant = no animation (slow-motion slider disabled); Step still works. Space = Step, also when a button has focus (students click a preset, then press Space). Step/Play are disabled for parts without a clock. The footer title was dropped to fit 1280 px | superseded: "One speed control" |
| Clock on benches (Phase 3) | A `clk` pin gets a clock source (square-wave mark) instead of a switch; clicking it is one tick. The clock bar's light pulses when the displayed clock rises | |
| Clock mode "Auto" (Phase 4) | The default. Ticks at the Play rate (and, like Play, waits for the last tick's animation) while the calculator is busy (a key line high, READY, STATE ≠ IDLE or keys queued); stops by itself in IDLE. On benches there is no control unit, so Auto just waits (like Pause). Instant on the calculator runs every pending tick at once | superseded: "One speed control" (now Run) |
| Instant playback fix (Phase 3) | Wires that already existed kept stale values when a timeline played instantly (slider at 0), because only nets mid-transition were re-synced. Now nets that settled since the last frame are re-synced too | |
| Auto layout (Phase 4) | Big schematics (encoder, decoders, muxes, control, the whole chip) are placed by a column router (`circuits/autoLayout.ts`): parts in columns, one vertical track per net in each channel between columns, feed-throughs through the gaps between parts, feedback nets along their own rows in the top margin. Own inputs/outputs sit level with their wires. The hand-authored layouts of Phases 1–3 stay. The layout tests check every generated layout | if a layout reads badly |
| Keyboard encoder (Phase 4) | A plain OR encoder (code bit i = OR of the 8 lines whose number has bit i; `pressed` = OR of all 16), not a true priority encoder: the UI never drives two lines at once (key queue). Two lines at once give the OR of their codes, which is tested and could become a detective puzzle | |
| Flag registers (Phase 4) | READY and PEND are a `SetClearBit` (next = set OR (Q AND NOT clear)), so READY = `pressed` OR (READY AND NOT READY_CLR). E is a register bit loaded when E_LOAD or E_CLR, with V AND NOT E_CLR, exactly §4.3's formula. OP is a register bit loading KEY bit 0. The STATE register is 4 plain flip-flops (loads every tick) | |
| Datapath details (Phase 4) | ALU A = Y, B = X, so `3 − 5` computes Y − X. X_SRC: KEY = 0, ALU = 1, M = 2, ZERO = 3. MUX4 = three MUX2 (students meet a part they know). The constant 0 is a `CONST0` part (a wire to GND, 0 transistors) feeding the mux's zero input and KEY's upper 4 bits | |
| ROM and PLA (Phase 4) | Behavioural, defined by a table, with a table view (`table` in the definition). Delay 2 each (decoder/AND plane, then bit lines/OR plane). The PLA ORs the outputs of every active rule; a test checks exactly one rule is active in every reachable situation | |
| Transistor estimate (Phase 4) | Gates count their CMOS transistors, flip-flops their structure (DFF = 34). ROM and PLA have no gates, so they count as a real NOR array would: ROM = 8 per row (decoder) + 1 per stored 1 + 2 per output; PLA = 1 per condition and per output a rule drives + 2 per rule and output line. A test checks the total against the fully structural netlist | |
| Err switch, 7-segment, zero detect (Phase 4) | The Err "mux" replaces bits with constants, which needs only AND with NOT E (for a 0) or OR with E (for a 1). The 7-segment decoder is generated from its truth table (Quine–McCluskey, `circuits/gen/sop.ts`) as NAND–NAND; segments with more than 4 terms use two NANDs and an OR. Zero detect = two NOR4 + AND; a NOT next to it drives the M lamp (M ≠ 0) | |
| Display sign (Phase 4) | The sign has its own fixed position on the left (§4.2: it is only segment g), so −2 shows as `-  2`, not `  -2` | if students find it odd |
| Carry ripple timing (Phase 4) | The ALU adds Y and X all the time, so in `7 + 9 =` the carry ripples when X becomes 9 (tick 9), not at tick 11 as §4.5 first said. §4.5 updated; mission 8 still works | |
| Key input (Phase 4) | A pressed key's line goes high at once (input settle); the next tick captures it and the UI releases it right after the edge. A key pressed while a line is held, READY = 1, STATE ≠ IDLE or the queue is not empty waits in the queue; the next queued line goes high once the calculator is free. `circuits/machine.ts` is the headless driver used by tests and the UI | |
| Clock at device level (Phase 4) | The device world always runs Instant (keys are processed at once, no animation). Inside the chip the clock bar's mode applies, Auto by default | |
| Chip view (Phase 4) | The chip world shows the calculator chip (0.25 world units per chip unit), a column of 16 key buttons on the left whose wires are the key lines, a clickable clock source, and a 4-digit display on the right wired to the segment outputs. Captions above the blocks ("ALU", "X register") make the overview read like §4.1's block diagram; they fade once a block opens. The panel's "Calculator" button sits beside the benches. When it is first shown, slow motion is set to about 30 ms per step (a tick of the whole machine is ~40 delta steps) unless the student already moved the slider | |
| ROM/PLA table view (Phase 4) | Drawn once into a canvas texture (256 ROM rows would be far too many text meshes), split into side-by-side blocks to fit the box. The active rows get a bright outline and a ▶ marker (shape and brightness, not colour alone). Tooltips name the active rule/row. Blank digit codes show as `·` | |
| HUD and keyboard (Phase 4) | The HUD (bottom left of the chip world) shows the displayed values of the chip's segment wires, the M lamp, 16 keys (they never take keyboard focus, so Space/Enter keep their meaning), the key whose line is high, and a "Waiting:" badge for the queue. On a bench the HUD stays and the calculator runs instantly in the background; the bench's own input letters (e.g. R of the SR latch) win over calculator keys | |
| Transistor counter (Phase 4) | In the calculator panel: "Transistors in this calculator" (6,998) and "Transistors in view" (closed blocks on screen count whole; opened ones count their visible parts) | |
| Router outputs (Phase 4) | `outputGap` spreads a component's outputs evenly in declared order (used by the 7-segment decoder, so its bench lamps are usable) | |
| Device world (Phase 4) | The page opens on a stylised 3D calculator (perspective camera, simple rounded boxes, no bloom, so the display segments stay ≤ 1.0 like labels). Its display module sits on the board and shows the simulated segments through a window in the cover. Two stages: "Look inside" (or scrolling in) lifts the cover off and shows the circuit board; "Into the chip" (scrolling in again, or clicking the chip) dives into the chip package, fades through dark and pulls back over the chip world. Breadcrumb "Calculator" returns to the board, Backspace closes the cover. The panel has "Pocket calculator" and "Inside the chip" beside the benches. The HUD is hidden at device level (§2) | |
| Board props (Phase 4) | Chip package (QFP, "CALC-8"), a decoupling capacitor beside it, 8 banded pull-down resistors on the key lines, keypad contacts (two combs per key), copper traces, a coin cell and the display module. Each has a hover text; the capacitor, resistors and battery say they are props and not simulated (§6.2a) | |
| Silicon layout (Phase 4b) | `circuits/siliconLayout.ts` builds a standard cell from each primitive's series/parallel description: VDD/GND metal rails, a PMOS diffusion row (in an n-well) on top and an NMOS row below, one vertical poly stripe per input crossing both rows. Series transistors share diffusion (the internal node has no contact); parallel ones alternate rail and output pieces. Metal stays planar: output runners in the channel between the rows plus a connector right of the cell, inputs via left-margin tracks and their own lanes to a poly contact, rails strapped straight up/down. Only flat networks (all our primitives); the stripe order follows the series chain | if nested networks are ever needed |
| Silicon test (Phase 4b) | A layout-versus-schematic check: the netlist is extracted from the masks alone (poly crossing diffusion = transistor; diffusion pieces, poly and metal joined by overlap and contacts; ports name the groups) and must equal `cmosNetlist` up to renaming internal nodes. Also: the drawing's tags agree with the extraction, unconnected shapes on a layer are ≥ 0.2 apart, everything fits the frame | |
| Silicon view (Phase 4b) | "Schematic \| Silicon" toggle at the top right, shown at gate level (an opened part with gates inside) and transistor level; one mode for every view, kept between scenes, reset on reload. Closed gate boxes keep their symbols. Switching rebuilds only the primitive's inside drawing; nets, playback and camera are untouched (tested headless on real benches). Fills stay ≤ 1.0 (no bloom): a piece at 1 is full brightness with a bright outline, at 0 dimmed with a thin one; channels glow solid when on, dashed when off; the conducting path is highlighted as in the schematic. Metal paths carry ordinary signal wires on their centre lines, so sparks match the schematic. No load capacitor in silicon (it is not a drawn part); hover explains each layer. Breadcrumb ends in "Silicon" | |
| Legend (Phase 4b) | Opt-in: a "Legend" button appears next to the toggle in Silicon mode and opens a short HTML key (layer colours, 1 vs 0, a reality-check line). Closed by default | |
| Single-transistor bench (Phase 4b) | New `NMOS` and `PMOS` parts (not used in the calculator): one transistor between power and a lamp, `out` = conducts (gate 1 for N, 0 for P), else 0 (at switch level the lamp wire floats). `CmosDef` gained an optional `pullDown` and `upType` for this. Benches "N transistor" and "P transistor" (needed by mission 3) | |
| Cross-section (Phase 4b) | On the transistor benches only, behind a "Show cross-section" panel button: a side view below the bench (substrate, n-well for PMOS, source/drain islands, oxide, poly gate, contacts, metal) with callout labels on the right. Gate, power and lamp sides light with their values; a glowing channel joins the islands when the transistor conducts. Labelled "to power"/"to the lamp" instead of source/drain | |
| One speed control (UI review) | The Instant mode, the clock-rate slider and the slow-motion slider were one control too many. Now one **Speed** slider: positions 0–99 = 1000 → 20 ms per delta step (log scale) and 0.5 → 4 ticks/s; 100 = Instant. Clock buttons are Pause / Step / Run. Run = the old Auto on the calculator and the old Play on benches. Benches open paused (as Auto did there), the calculator opens running. At Instant with the clock paused, key presses wait for Step | |
| Explore menu and breadcrumb (UI review) | The panel's row of scene buttons became one grouped `<select>` ("Explore"), which also replaces the "Lab bench" heading and the calculator/device panel titles (bench lesson titles such as "NAND: the Lego brick" stay). The breadcrumb now shows only the zoom path inside the scene (no "Calculator" / "Lab bench" root); its first item zooms out to the whole scene. The device world keeps "Calculator › Circuit board". After choosing, the menu loses focus so letters and digits keep driving the bench and calculator | |
| Fit view (UI review) | The footer's "⌂ Home" button looked like "back to the start screen" but only reset the zoom. It is now a "⤢ Fit view" button in front of the breadcrumb (hidden in the device world); the Home key does the same | |
| Silicon toggle visibility (UI review) | Shown only when an opened gate (a transistor view) is on screen, the only case where switching changes the picture. Before, it showed whenever the zoomed part contained gates, e.g. on the chip overview (the M-lamp NOT sits directly in the chip), where nothing visibly changed | superseded by Phase 4c: always shown inside the chip world (calculator and benches), hidden in the device world |
| Real-chip views (after UI review) | New Phase 4c before Phase 5: die view at chip level, cell miniatures on closed gates, die step in the dive transition, LCD-segment cutaway; keypad/package cutaways optional; placed-and-routed composite parts out of scope. Reason: the silicon toggle only changed something at transistor level, so it felt broken elsewhere, and students never saw how the blocks sit on a real die | Toggle name decided (next row) |
| Toggle name (Phase 4c) | **"Diagram \| Real chip"** (owner's decision at the start of Phase 4c). Plainer for ages 12+ and true at every level: the die is more than "silicon" layers. The breadcrumb ends in "Real chip" at transistor level; the legend explains the colours | |
| Die floorplan (Phase 4c) | `circuits/dieLayout.ts`, pure and tested. Inside a pad ring, the core is sliced into the block diagram's columns left → right (column width ∝ the column's transistors), then each column into its blocks top → bottom (height ∝ the block's transistors), so every region's area is exactly ∝ its transistor count. CONST0 (0 transistors, a wire to GND) has no region. Inside a block: its ROM/PLA arrays on top (height ∝ their transistors, drawn as the grid of their real stored bits, the ROM folded into wider rows as real ROMs are), then every primitive gate (flip-flops by their structure) as its generated silicon cell, in structure order, in rows with a routing channel between them. Wiring is not drawn. The ROM is about half the die, which is honest: it holds 3,417 of 6,998 transistors. One pad per chip pin, spread along the die edge nearest to the pin, with a bond wire to the package pin | |
| Die view (Phase 4c) | At chip level, "Real chip" shows the die over the chip box (`render/die.ts`). Each block's pattern is baked by a small software rasterizer (`render/raster.ts`, rectangles only, anti-aliased) into one texture, so the die costs few draw calls: about 235 per frame at the overview against 435 for the block diagram (the covered diagram is not drawn). Bond wires are ordinary signal wires (they light and carry sparks). The die stands in for the block diagram until a block opens: its opacity is the toggle's fade times (1 − the most opened block's fade), so zooming in crossfades into the diagram, then the block's gates (as cells). Labels are written along tall narrow blocks, have a dark outline and are never bloomed. Hovering a block describes that block; double-clicking flies to its box in the diagram. Note under the die: "A sketch: sizes to scale, wiring not drawn." | if a die region should map 1:1 onto its block's box |
| Block glow (Phase 4c) | A block glows while nets it drives (by the driving gate's top-level block) change, and fades over 0.5 s: a faint cyan wash plus a thick bright outline (brightness and thickness, not colour alone). Kept ≤ 1.0, so it does not bloom: CLAUDE.md allows bloom only on active wires, sparks and transistors | if a stronger glow is wanted |
| Cell miniatures (Phase 4c) | In "Real chip" mode every closed box shows a static miniature baked once per component type (`render/dieArt.ts`). A primitive gate shows its silicon cell exactly: the cell's frame is the gate's inner frame, so it fills the box, and it replaces the gate symbol and pin stubs. **Extension of §9:** composite boxes also show a miniature, their gates as the same cells in rows (like their block on the die). Without it the toggle changed nothing at levels whose closed parts are all composites (e.g. the ALU: XOR = 4 NAND cells, full adders), which would break "every level changes visibly". Composite gate symbols (XOR, AND, OR) are replaced too; other boxes keep their outline and outlined title over a dimmed miniature. This is not a placed-and-routed layout (still out of scope): no wiring is drawn. Miniatures show layers, not values; zooming in shows the live layout | |
| Dive transition (Phase 4c) | "Into the chip" now takes 2.6 s: the camera moves over the package, the lid (with its label) lifts, slides off and fades, then the camera descends until the die fills the view. Under the lid: the cavity, the die (the same floorplan baked into one texture at page load, ~30 ms) and gold bond wires to lead fingers. Then the chip world fades in with the chip box filling the screen and pulls back to the overview. Reduced motion: instant | |
| LCD close-up (Phase 4c) | A "Show LCD close-up" button in the device world shows one segment (ones digit, top) taken apart beside the calculator, linked to it by a thin line: the segment as seen, front polariser, glass with segment electrode, liquid crystal, glass with back electrode, back polariser with mirror (reflective twisted-nematic LCD). Wire 0: rods lie flat, twisting 0°/45°/90° front to back, segment clear. Wire 1: rods stand up, segment dark. A text line says which, so state is never colour alone. The tooltip notes that real calculators multiplex segment wires and ours does not, and that our display glows where a real LCD darkens. The camera shifts right to make room | |
| Optional cutaways (Phase 4c) | Keypad cutaway (rubber dome, carbon pad, contacts) not done. A separate package cutaway was not added: the dive already shows the lid off, the die, bond wires and lead fingers | Phase 6 if wanted |
