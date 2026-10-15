import { BufferGeometry, Node, WebGPURenderer } from "three/webgpu";

/**
 * A TSL distance function. Receives the sample position as a `vec3` node and
 * returns the signed distance as a `float` node (negative inside).
 *
 * Both plain functions and `Fn()` wrapped functions are accepted:
 *
 * ```ts
 * const sphere: SDFDistanceFunction = (p) => length(p).sub(0.5);
 * const torus = Fn(([p]: [Node<"vec3">]) => length(vec2(length(p.xz).sub(0.6), p.y)).sub(0.2));
 * ```
 */
export type SDFDistanceFunction = (p: Node<"vec3">) => Node;

/**
 * Either a TSL distance function (works on the WebGPU backend and the WebGL 2
 * fallback), or a WGSL source string that defines
 * `fn dist( p: vec3<f32> ) -> f32` plus any helper functions it needs
 * (WebGPU backend only).
 */
export type SDFDistanceSource = SDFDistanceFunction | string;

/**
 * Generates an indexed `BufferGeometry` (with `position` and `normal`
 * attributes) from a signed distance function. The field is sampled on the GPU
 * with a TSL compute shader and polygonized with Surface Nets.
 */
export class SDFGeometryGenerator {
    /**
     * @param renderer A `WebGPURenderer` (from `three/webgpu`). It is
     * initialized automatically if needed.
     */
    constructor(renderer: WebGPURenderer);

    /** The renderer used to evaluate the distance function. */
    renderer: WebGPURenderer;

    /**
     * Upper bound for the number of samples evaluated per compute dispatch.
     * Larger volumes are processed in slabs of whole z-slices.
     * @default 4194304
     */
    maxSamplesPerPass: number;

    /**
     * Samples the SDF on a grid of `res` × `res` × `res` cells spanning
     * `[-bounds, bounds]³` and returns the zero-level surface. Shapes clipped by
     * the bounds are capped, so the result is always closed.
     *
     * Same as {@link SDFGeometryGenerator.generateAsync}; kept for API
     * compatibility with the WebGL version, but it returns a Promise.
     *
     * @param res Cells per axis, an integer >= 2. Default `64`.
     * @param distFunc The distance function. Default: a sphere of radius 0.5.
     * @param bounds Half extent of the sampled cube, centered at the origin. Default `1`.
     */
    generate(res?: number, distFunc?: SDFDistanceSource, bounds?: number): Promise<BufferGeometry>;

    /**
     * Samples the SDF on a grid of `res` × `res` × `res` cells spanning
     * `[-bounds, bounds]³` and returns the zero-level surface. Shapes clipped by
     * the bounds are capped, so the result is always closed.
     *
     * @param res Cells per axis, an integer >= 2. Default `64`.
     * @param distFunc The distance function. Default: a sphere of radius 0.5.
     * @param bounds Half extent of the sampled cube, centered at the origin. Default `1`.
     */
    generateAsync(res?: number, distFunc?: SDFDistanceSource, bounds?: number): Promise<BufferGeometry>;
}
