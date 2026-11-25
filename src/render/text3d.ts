// In-scene text for the device world (perspective camera, no bloom there), with the bundled font.
import type { Color } from 'three';
import { Text } from 'troika-three-text';
import fontUrl from '../assets/fonts/inter-latin-600-normal.woff?url';

export function text3d(content: string, size: number, color: string | Color, x: number, y: number, z: number): Text {
  const t = new Text();
  t.text = content;
  t.font = fontUrl;
  t.fontSize = size;
  t.color = color;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.position.set(x, y, z);
  t.sync();
  return t;
}
