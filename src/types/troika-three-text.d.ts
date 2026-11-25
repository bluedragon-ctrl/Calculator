// Minimal typings for the parts of troika-three-text we use (the package ships none via "types").
declare module 'troika-three-text' {
  import { Color, Mesh } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    color: string | number | Color | null;
    anchorX: number | string;
    anchorY: number | string;
    maxWidth: number;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    outlineWidth: number | string;
    fillOpacity: number;
    outlineColor: string | number | Color;
    outlineOpacity: number;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
