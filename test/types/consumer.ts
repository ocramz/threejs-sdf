// Type-checks a consumer of the package against its declarations (npm run test:types).
// The package imports itself by name, so this goes through the "exports" map.

import { BufferGeometry, CatmullRomCurve3, Node, Vector3, WebGPURenderer } from "three/webgpu";
import { Fn, dot, exp, length, min, vec2 } from "three/tsl";

import {
    SDFDistanceFunction,
    SDFDistanceSource,
    SDFGenerateOptions,
    SDFGeometryGenerator,
} from "three-sdf-geometry-generator";
import { splineDistance } from "three-sdf-geometry-generator/examples/splineDistance.js";
import { splineDistanceStorage } from "three-sdf-geometry-generator/examples/splineDistanceStorage.js";
import { PointDensityFunction, pointDensity } from "three-sdf-geometry-generator/examples/pointDensity.js";

const renderer = new WebGPURenderer();
const generator = new SDFGeometryGenerator(renderer);
generator.maxSamplesPerPass = 1 << 20;

// Distance functions

const sphere: SDFDistanceFunction = (p) => length(p).sub(0.5);
const torus = Fn(([p]: [Node<"vec3">]) => length(vec2(length(p.xz).sub(0.6), p.y)).sub(0.2));
const wgsl: SDFDistanceSource = "fn dist( p: vec3<f32> ) -> f32 { return length( p ) - 0.5; }";

const a: Promise<BufferGeometry> = generator.generate();
const b: Promise<BufferGeometry> = generator.generate(64, sphere, 1);
const c: Promise<BufferGeometry> = generator.generateAsync(64, torus, 1);
const d: Promise<BufferGeometry> = generator.generate(64, wgsl);

// Level sets

const blob = (p: Node<"vec3">) => exp(dot(p, p).mul(-5));
const options: SDFGenerateOptions = { level: 0.5, inside: "above" };

const e: Promise<BufferGeometry> = generator.generate(64, blob, 1, options);
const f: Promise<BufferGeometry> = generator.generateAsync(64, "fn field( p: vec3<f32> ) -> f32 { return 1.0; }", 1, { level: 0.2 });
const g: Promise<BufferGeometry> = generator.generate(64, sphere, 1, {});

// @ts-expect-error inside is "below" or "above"
generator.generate(64, blob, 1, { inside: "outside" });

// @ts-expect-error level is a number
generator.generate(64, blob, 1, { level: "0.5" });

// Spline examples

const curve = new CatmullRomCurve3([new Vector3(-0.6, 0, 0), new Vector3(0, 0.4, 0.2), new Vector3(0.6, 0, 0)]);

const tubes = splineDistance([curve, curve], { radius: (u, i) => 0.03 + 0.01 * u * i, segments: 64, blend: 0.1 });
const combined = (p: Node<"vec3">) => min(tubes(p), length(p).sub(0.3));
const h: Promise<BufferGeometry> = generator.generate(128, combined, 1);

const storageTubes = splineDistanceStorage(curve, { radius: 0.02, margin: 0.06, cellSize: 0.1 });
const gridCells: [number, number, number] = storageTubes.info.gridCells;
storageTubes.dispose(renderer);

// Point densities

const density: PointDensityFunction = pointDensity([new Vector3(), new Vector3(0.5, 0, 0)], {
    radius: (point, index) => 0.1 + 0.05 * index + 0 * point.x,
});
const i: Promise<BufferGeometry> = generator.generate(128, density, 1, { level: 0.5, inside: "above" });
const single: PointDensityFunction = pointDensity(new Vector3(), { radius: 0.2 });

// @ts-expect-error radius is a number or a function
pointDensity([new Vector3()], { radius: "0.1" });

export { a, b, c, d, e, f, g, h, i, gridCells, single };
