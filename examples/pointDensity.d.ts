import { Node, Vector3 } from "three/webgpu";

/**
 * The density function returned by `pointDensity()`. It returns a `float` node, so
 * it can be passed to `SDFGeometryGenerator.generate()` with
 * `{ level, inside: "above" }`, or combined with other TSL math.
 */
export type PointDensityFunction = (p: Node<"vec3">) => Node<"float">;

export interface PointDensityOptions {
    /**
     * Kernel radius (the Gaussian's standard deviation), or a function
     * `(point, index) => radius`.
     * @default 0.1
     */
    radius?: number | ((point: Vector3, index: number) => number);
}

/**
 * Returns a TSL density field for a set of points: the sum of one Gaussian kernel
 * per point, each peaking at 1. An isolated point gives a sphere of radius
 * `radius * sqrt(-2 ln level)`. At most 4096 points.
 */
export function pointDensity(
    points: Vector3 | ReadonlyArray<Vector3>,
    options?: PointDensityOptions,
): PointDensityFunction;
