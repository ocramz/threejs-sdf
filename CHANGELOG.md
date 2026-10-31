# Changelog

## 1.3.0

- Level sets: `generate()` takes a fourth argument, `{ level, inside }`, and meshes the surface where any scalar field equals `level`. With `inside: 'above'`, values above the level are inside, as for densities. The defaults (`level: 0`, `inside: 'below'`) give the same meshes as before.
- WGSL strings may define `fn field( p )` instead of `fn dist( p )`.
- New example `examples/pointDensity.js`: a TSL density field with one Gaussian kernel per point, for metaballs and kernel density estimates. It includes TypeScript declarations.
- New demo `examples/density.html` with three presets (`examples/densityPresets.js`): metaballs, a spiral galaxy point cloud and a hydrogen orbital.
- Headless WebGPU tests for level sets and `pointDensity()` (`npm test`), and a type-check of the declarations (`npm run test:types`).

## 1.2.0

- New example `examples/splineDistanceStorage.js` for large curve sets. Curves go into storage buffers instead of a uniform buffer, so there is no 4096-point limit, and a spatial grid means each sample only tests nearby segments. Where both examples can run, the meshes are identical. It includes TypeScript declarations, statistics (`info`) and `dispose( renderer )`.
- Two large demo presets: a yarn ball (180 curves) and a toroidal coil (one 6,000-segment curve).
- The spline demo's segment slider is now a "detail" multiplier, since presets range from 32 to 6,000 segments per curve.
- `splineDistance()`'s point-limit error now points to the storage version.

## 1.1.0

- New example `examples/splineDistance.js`: a TSL distance function for tubes around one or more three.js curves, with variable radius, smooth blending between curves and bounding-box culling. It includes TypeScript declarations.
- New demo `examples/splines.html` with four spline presets (`examples/splinePresets.js`).
- Examples can now be imported from the package: `three-sdf-geometry-generator/examples/*`.
- Tests for the spline example, checked against an independent CPU implementation of the same distance field.

## 1.0.0

- First release: `SDFGeometryGenerator` for `WebGPURenderer`, ported from the WebGL addon in three.js PR #26837.
