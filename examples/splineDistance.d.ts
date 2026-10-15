import { Curve, Node, Vector3 } from "three/webgpu";

/**
 * The distance function returned by `splineDistance()`. It returns a `float` node, so
 * it can be passed to `SDFGeometryGenerator.generate()` or combined with other TSL
 * math, e.g. `(p) => min(tubes(p), length(p).sub(0.3))`.
 */
export type SplineDistanceFunction = (p: Node<"vec3">) => Node<"float">;

export interface SplineDistanceOptions {
    /**
     * Tube radius, or a function `(u, curveIndex) => radius` with `u` in [0, 1]
     * along the curve's length.
     * @default 0.05
     */
    radius?: number | ((u: number, curveIndex: number) => number);

    /**
     * Polyline segments per curve, or a function `(curve, curveIndex) => count`.
     * @default 64
     */
    segments?: number | ((curve: Curve<Vector3>, curveIndex: number) => number);

    /**
     * Smooth-union radius between different curves (0 = hard union).
     * @default 0
     */
    blend?: number;
}

/**
 * Returns a TSL distance function for tubes around one or more curves, for use
 * with `SDFGeometryGenerator.generate()`. All curves together may use at most
 * 4096 points (segments + 1 per curve).
 */
export function splineDistance(
    curves: Curve<Vector3> | ReadonlyArray<Curve<Vector3>>,
    options?: SplineDistanceOptions,
): SplineDistanceFunction;
