// Silicon view text (DESIGN.md §6.2a, Phase 4b). Plain English for ages 12+, short.

export const siliconText = {
  schematic: 'Schematic',
  silicon: 'Silicon',
  legendButton: 'Legend',
  toggleTitle: 'Show the gate as a circuit drawing (schematic) or as it is built on the chip (silicon).',
  legendTitle: 'Show what the colours mean.',
  crumb: 'Silicon',
  legendHeading: 'How a gate is built',
  legendItems: [
    { swatch: 'diff', name: 'Green: diffusion', text: 'Silicon treated so it conducts. Top row P-type, bottom row N-type.' },
    { swatch: 'poly', name: 'Red: polysilicon', text: 'The gates. Where red crosses green, there is a transistor.' },
    { swatch: 'metal', name: 'Blue: metal', text: 'Wires on top, like the wires in the schematic.' },
    { swatch: 'contact', name: 'Grey squares: contacts', text: 'Holes that join metal to the layer below.' },
    { swatch: 'well', name: 'Dark green: n-well', text: 'The P-type transistors sit in this island.' },
  ],
  legendNote: 'Bright with a thick outline = 1, dim = 0. A glowing channel is a transistor that is on.',
  reality: 'Real gates are about a thousand times thinner than a hair, and built in many more layers.',
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
