// Per-object opacity for Line2 objects that share materials (used by the LOD crossfade).
// Just before an object is drawn its material's opacity uniform is scaled; right after, it is
// restored, so other objects with the same material are unaffected.
import type { Material, Object3D } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export type AlphaFn = () => number;

type Shader = Material & { uniforms?: LineMaterial['uniforms']; uniformsNeedUpdate?: boolean };

export function fadeObject(obj: Object3D, alpha: AlphaFn): void {
  const before = obj.onBeforeRender.bind(obj);
  let saved = -1;
  obj.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    before(renderer, scene, camera, geometry, material, group);
    const a = alpha();
    const m = material as Shader;
    if (a >= 0.999 || !m.uniforms?.opacity) return;
    saved = m.uniforms.opacity.value as number;
    m.uniforms.opacity.value = saved * a;
    m.uniformsNeedUpdate = true;
  };
  obj.onAfterRender = (_r, _s, _c, _g, material) => {
    if (saved < 0) return;
    const m = material as Shader;
    m.uniforms!.opacity.value = saved;
    m.uniformsNeedUpdate = true;
    saved = -1;
  };
}
