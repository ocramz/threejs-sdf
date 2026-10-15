import { Curve, Vector3, WebGPURenderer } from "three/webgpu";
import { SplineDistanceFunction, SplineDistanceOptions } from "./splineDistance.js";

export interface SplineDistanceStorageOptions extends SplineDistanceOptions {
    /**
     * Distance up to which the field is exact; beyond it, values are clamped to
     * `margin`. Keep it at least 1.75 × the sample spacing (`2 * bounds / res`).
     * @default 0.1
     */
    margin?: number;

    /**
     * Size of the spatial grid's cells. Defaults to max radius + blend + margin.
     */
    cellSize?: number;
}

export interface SplineDistanceStorageInfo {
    curves: number;
    points: number;
    segments: number;
    /** Grid dimensions [x, y, z]. */
    gridCells: [number, number, number];
    cellSize: number;
    /** Total entries in all cell lists (a segment can be listed in several cells). */
    listedSegments: number;
    /** The longest cell list, i.e. the most segments any sample has to test. */
    maxSegmentsPerCell: number;
    /** Size of the uploaded storage buffers. */
    bytes: number;
}

export interface SplineDistanceStorageFunction extends SplineDistanceFunction {
    /** Statistics about the uploaded data and the spatial grid. */
    readonly info: SplineDistanceStorageInfo;

    /**
     * Frees the storage buffers. Pass the renderer they were used with: not every
     * three.js release frees storage buffers on `attribute.dispose()` alone.
     */
    dispose(renderer?: WebGPURenderer): void;
}

/**
 * Like `splineDistance()`, but stores the curves in storage buffers with a spatial
 * grid, so there is no 4096-point limit and each sample only tests nearby segments.
 * Requires the WebGPU backend.
 */
export function splineDistanceStorage(
    curves: Curve<Vector3> | ReadonlyArray<Curve<Vector3>>,
    options?: SplineDistanceStorageOptions,
): SplineDistanceStorageFunction;
