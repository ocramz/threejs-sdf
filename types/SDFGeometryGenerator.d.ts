import { BufferGeometry, Node, WebGPURenderer } from "three/webgpu";

/**
 * A TSL field function. Receives the sample position as a `vec3` node and
 * returns the field value as a `float` node: usually a signed distance
 * (negative inside), but any scalar field works, such as a density (see
 * {@link SDFGenerateOptions}).
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
 * Either a TSL field function (works on the WebGPU backend and the WebGL 2
 * fallback), or a WGSL source string that defines
 * `fn dist( p: vec3<f32> ) -> f32` or `fn field( p: vec3<f32> ) -> f32`, plus
 * any helper functions it needs (WebGPU backend only).
 */
export type SDFDistanceSource = SDFDistanceFunction | string;

/**
 * Selects which level set of the field becomes the surface.
 *
 * ```ts
 * // signed distance function: the zero level, negative inside (the default)
 * await generator.generate(128, sdf, 1);
 *
 * // density: the surface where it equals 0.5, inside where it is greater
 * await generator.generate(128, density, 1, { level: 0.5, inside: "above" });
 * ```
 */
export interface SDFGenerateOptions {
    /**
     * Field value on the surface.
     * @default 0
     */
    level?: number;

    /**
     * Which side of the level is inside: `"below"` for signed distances (field
     * < level), `"above"` for densities (field > level). Normals point to the
     * outside.
     * @default "below"
     */
    inside?: "below" | "above";
}

/**
 * Generates an indexed `BufferGeometry` (with `position` and `normal`
 * attributes) from a signed distance function, or from a level set of any
 * scalar field. The field is sampled on the GPU with a TSL compute shader and
 * polygonized with Surface Nets.
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
     * Samples the field on a grid of `res` × `res` × `res` cells spanning
     * `[-bounds, bounds]³` and returns the surface where it equals
     * `options.level` (by default the zero level of an SDF). Shapes clipped by
     * the bounds are capped, so the result is always closed.
     *
     * Same as {@link SDFGeometryGenerator.generateAsync}; kept for API
     * compatibility with the WebGL version, but it returns a Promise.
     *
     * @param res Cells per axis, an integer >= 2. Default `64`.
     * @param distFunc The field function. Default: a sphere of radius 0.5.
     * @param bounds Half extent of the sampled cube, centered at the origin. Default `1`.
     * @param options The level and which side of it is inside.
     */
    generate(
        res?: number,
        distFunc?: SDFDistanceSource,
        bounds?: number,
        options?: SDFGenerateOptions,
    ): Promise<BufferGeometry>;

    /**
     * Samples the field on a grid of `res` × `res` × `res` cells spanning
     * `[-bounds, bounds]³` and returns the surface where it equals
     * `options.level` (by default the zero level of an SDF). Shapes clipped by
     * the bounds are capped, so the result is always closed.
     *
     * @param res Cells per axis, an integer >= 2. Default `64`.
     * @param distFunc The field function. Default: a sphere of radius 0.5.
     * @param bounds Half extent of the sampled cube, centered at the origin. Default `1`.
     * @param options The level and which side of it is inside.
     */
    generateAsync(
        res?: number,
        distFunc?: SDFDistanceSource,
        bounds?: number,
        options?: SDFGenerateOptions,
    ): Promise<BufferGeometry>;
}
