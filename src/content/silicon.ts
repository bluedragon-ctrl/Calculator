// "Real chip" view text (DESIGN.md §6.2a, Phases 4b and 4c). Plain English for ages 12+, short.

export const siliconText = {
  /** The toggle's two sides (DESIGN.md §11: "Diagram | Real chip"). */
  schematic: 'Diagram',
  silicon: 'Real chip',
  legendButton: 'Legend',
  toggleTitle: 'Show the circuit as a diagram, or as it is really built on the chip.',
  legendTitle: 'Show what the colours mean.',
  crumb: 'Real chip',
  legendHeading: 'How a gate is built',
  legendItems: [
    { swatch: 'diff', name: 'Green: diffusion', text: 'Silicon treated so it conducts. Top row P-type, bottom row N-type.' },
    { swatch: 'poly', name: 'Red: polysilicon', text: 'The gates. Where red crosses green, there is a transistor.' },
    { swatch: 'metal', name: 'Blue: metal', text: 'Wires on top, like the wires in the diagram.' },
    { swatch: 'contact', name: 'Grey squares: contacts', text: 'Holes that join metal to the layer below.' },
    { swatch: 'well', name: 'Dark green: n-well', text: 'The P-type transistors sit in this island.' },
  ],
  legendNote: 'Bright with a thick outline = 1, dim = 0. A glowing channel is a transistor that is on.',
  dieNote: 'Whole chip: each block is drawn to scale with its number of transistors. Zoom in to see its gates as cells.',
  reality: 'Real gates are about a thousand times thinner than a hair, and built in many more layers.',
};

/** The die view at chip level (Phase 4c). */
export const dieText = {
  note: 'A sketch: sizes to scale, wiring not drawn.',
  dieTitle: 'The silicon die',
  die: 'The chip itself: a thin slice of silicon. Each block takes room in proportion to its transistors, so the display table (ROM) is the biggest.',
  blockHint: 'Double-click to zoom in. The block glows while its wires are changing.',
  padTitle: (pin: string) => `Bond pad ${pin}`,
  pad: 'A square of metal on the edge of the die. A gold wire thinner than a hair joins it to a pin of the package.',
  miniTitle: (name: string) => `${name} cell`,
  mini: 'How this gate is built on the chip: green diffusion, red polysilicon, blue metal. Zoom in to see it switch.',
};

/** The LCD close-up in the device world (Phase 4c). */
export const lcdText = {
  show: 'Show LCD close-up',
  hide: 'Hide LCD close-up',
  buttonTitle: 'Take one display segment apart, layer by layer.',
  heading: 'One segment, taken apart',
  segment: 'ones digit, top segment',
  layers: {
    frontPolariser: 'front polariser',
    frontGlass: 'glass with segment electrode',
    crystal: 'liquid crystal',
    backGlass: 'glass with back electrode',
    backPolariser: 'back polariser and mirror',
  },
  stateOn: 'wire = 1: segment dark',
  stateOff: 'wire = 0: segment clear',
  tipTitle: 'LCD segment',
  tip: 'With 0 on its wire, the crystals twist light so it passes the polarisers. A 1 lines them up, light is blocked, and the segment looks dark.',
  tipNote: 'Real calculators share wires between segments and switch them very fast (multiplexing). Ours has one wire per segment.',
  glowNote: 'Our display glows so you can see it in the dark. A real LCD segment turns dark instead.',
};

/** Hover text for one layer of the silicon view. */
export const layerTips = {
  pdiff: { title: 'P-type diffusion', body: 'Silicon with a little boron added, so it conducts. It forms the P-type transistors.' },
  ndiff: { title: 'N-type diffusion', body: 'Silicon with a little phosphorus added, so it conducts. It forms the N-type transistors.' },
  poly: { title: 'Polysilicon gate', body: 'The gate wire. Where it crosses diffusion, its value switches that transistor on or off.' },
  metal: { title: 'Metal', body: 'A metal wire on top of the transistors. Power (VDD) and ground (GND) run along the edges.' },
  contact: { title: 'Contact', body: 'A small hole filled with metal. It connects a metal wire to the layer underneath.' },
  well: { title: 'N-well', body: 'An island of N-type silicon. P-type transistors only work inside one.' },
} as const;

export const layerNotes = {
  internal: 'The piece between two transistors in a chain. It has no wire of its own.',
};

/** The single-transistor bench's cross-section (a side view, cut through the transistor). */
export const crossText = {
  show: 'Show cross-section',
  hide: 'Hide cross-section',
  buttonTitle: 'Cut the transistor open and look at it from the side.',
  heading: 'Cross-section: the transistor seen from the side',
  power: 'to power (1)',
  lamp: 'to the lamp',
  gate: 'gate',
  oxide: 'thin glass (oxide)',
  channelOn: 'channel: open, current flows',
  channelOff: 'no channel: switch open',
  substrate: 'P-type silicon',
  well: 'N-well (inside P-type silicon)',
  regions: (type: 'n' | 'p') => (type === 'n' ? 'N-type islands' : 'P-type islands'),
  tipTitle: 'Cross-section',
  tip: (type: 'n' | 'p') => (type === 'n'
    ? 'A 1 on the gate pulls a thin layer of electrons to the surface. It joins the two islands, so current can flow.'
    : 'A 0 on the gate pulls a thin layer of holes to the surface. It joins the two islands, so current can flow.'),
};
