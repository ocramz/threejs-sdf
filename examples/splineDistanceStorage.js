/**
 * splineDistanceStorage: tubes around large sets of three.js curves, for use with
 * SDFGeometryGenerator. Same options as splineDistance(), but without its
 * 4096-point limit, and fast for long curves and many curves.
 *
 *   import { splineDistanceStorage } from 'three-sdf-geometry-generator/examples/splineDistanceStorage.js';
 *
 *   const sdf = splineDistanceStorage( curves, { radius: 0.02, blend: 0.02, margin: 0.06 } );
 *   const geometry = await generator.generate( 128, sdf, 1 );
 *   sdf.dispose( renderer ); // free the GPU buffers when done
 *
 * How it works: the curves are sampled into polyline segments, and the segments
 * are binned on the CPU into a uniform grid. A segment is listed in every grid
 * cell it could affect: within its radius + blend + margin. Points, per-cell
 * segment lists and cell ranges go into three read-only storage buffers. In the
 * shader, each sample loops only over its own cell's list. The lists keep curve
 * order, so the smooth union between curves behaves like splineDistance().
 *
 * Beyond `margin` the field is clamped to `margin`. That is exact where it
 * matters, because Surface Nets only reads exact values in cells touching the
 * surface. Keep margin >= 1.75 * sample spacing, i.e. 1.75 * 2 * bounds / res.
 * A smaller margin still gives a closed mesh, but vertices are placed less accurately.
 *
 * Requires the WebGPU backend; the WebGL 2 fallback has no random-access storage buffers.
 */

import { Box3, StorageBufferAttribute, Vector3 } from 'three/webgpu';
import { Fn, If, Loop, clamp, dot, float, floor, int, ivec3, length, max, min, mix, storage, vec3 } from 'three/tsl';

const MAX_GRID_CELLS = 1 << 21; // 2M cells = 16 MB of cell ranges

/**
 * @param {Curve|Array<Curve>} curves - One curve or an array of curves (any THREE.Curve returning Vector3 points).
 * @param {Object} [options]
 * @param {number|function(number, number): number} [options.radius=0.05] - Tube radius, or ( u, curveIndex ) => radius.
 * @param {number|function(Curve, number): number} [options.segments=64] - Polyline segments per curve, or ( curve, curveIndex ) => count.
 * @param {number} [options.blend=0] - Smooth-union radius between different curves (0 = hard union).
 * @param {number} [options.margin=0.1] - Distance up to which the field is exact; keep >= 1.75 * 2 * bounds / res.
 * @param {number} [options.cellSize] - Grid cell size. Defaults to max radius + blend + margin.
 * @return {function(Node): Node} A TSL distance function, plus `info` (statistics) and `dispose( renderer )`.
 */
export function splineDistanceStorage( curves, options = {} ) {

	const { radius = 0.05, segments = 64, blend = 0, margin = 0.1 } = options;
	const curveList = Array.isArray( curves ) ? curves : [ curves ];

	if ( ! ( margin > 0 ) ) throw new Error( 'splineDistanceStorage: margin must be a positive number.' );

	// 1. Sample the curves into points ( x, y, z, radius ) and segments ( first point, curve ).

	const pointArrays = [];
	const segmentList = []; // [ pointIndex, curveIndex ] pairs, in curve order
	let pointCount = 0;
	let maxRadius = 0;

	curveList.forEach( ( curve, curveIndex ) => {

		const count = Math.max( 1, Math.round( typeof segments === 'function' ? segments( curve, curveIndex ) : segments ) );
		const samples = curve.getSpacedPoints( count );
		const array = new Float32Array( samples.length * 4 );

		samples.forEach( ( point, k ) => {

			const r = typeof radius === 'function' ? radius( k / count, curveIndex ) : radius;

			array[ k * 4 ] = point.x;
			array[ k * 4 + 1 ] = point.y;
			array[ k * 4 + 2 ] = point.z;
			array[ k * 4 + 3 ] = r;
			maxRadius = Math.max( maxRadius, r );

			if ( k > 0 ) segmentList.push( pointCount + k - 1, curveIndex );

		} );

		pointArrays.push( array );
		pointCount += samples.length;

	} );

	const points = new Float32Array( pointCount * 4 );
	pointArrays.reduce( ( offset, array ) => ( points.set( array, offset ), offset + array.length ), 0 );

	const segmentCount = segmentList.length / 2;

	if ( segmentCount === 0 ) throw new Error( 'splineDistanceStorage: no curves given.' );

	// 2. Bin segments into a uniform grid. A segment goes into every cell its box,
	// grown by its radius + blend + margin, overlaps.

	const reach = ( i ) => Math.max( points[ i * 4 + 3 ], points[ i * 4 + 7 ] ) + blend + margin;

	const gridBox = new Box3();
	const segmentBox = new Box3();
	const a = new Vector3(), b = new Vector3();

	const getSegmentBox = ( s ) => {

		const i = segmentList[ s * 2 ];
		a.fromArray( points, i * 4 );
		b.fromArray( points, i * 4 + 4 );
		return segmentBox.makeEmpty().expandByPoint( a ).expandByPoint( b ).expandByScalar( reach( i ) );

	};

	for ( let s = 0; s < segmentCount; s ++ ) gridBox.union( getSegmentBox( s ) );

	const gridSize = gridBox.getSize( new Vector3() );
	let cellSize = options.cellSize ?? ( maxRadius + blend + margin );
	let dims = gridSize.clone().divideScalar( cellSize ).ceil().max( new Vector3( 1, 1, 1 ) );

	if ( dims.x * dims.y * dims.z > MAX_GRID_CELLS ) {

		cellSize *= Math.cbrt( dims.x * dims.y * dims.z / MAX_GRID_CELLS ) * 1.01;
		dims = gridSize.clone().divideScalar( cellSize ).ceil().max( new Vector3( 1, 1, 1 ) );

	}

	const cellCount = dims.x * dims.y * dims.z;
	const cellOf = ( value, axis ) => Math.min( dims[ axis ] - 1, Math.max( 0, Math.floor( ( value - gridBox.min[ axis ] ) / cellSize ) ) );

	const forEachCell = ( box, callback ) => {

		const x0 = cellOf( box.min.x, 'x' ), x1 = cellOf( box.max.x, 'x' );
		const y0 = cellOf( box.min.y, 'y' ), y1 = cellOf( box.max.y, 'y' );
		const z0 = cellOf( box.min.z, 'z' ), z1 = cellOf( box.max.z, 'z' );

		for ( let z = z0; z <= z1; z ++ ) for ( let y = y0; y <= y1; y ++ ) for ( let x = x0; x <= x1; x ++ ) callback( x + dims.x * ( y + dims.y * z ) );

	};

	// Counting sort: count, prefix-sum, fill. Filling in segment order keeps each
	// cell's list sorted by curve, which the smooth union relies on.

	const cells = new Uint32Array( cellCount * 2 ); // ( start, count ) per cell

	for ( let s = 0; s < segmentCount; s ++ ) forEachCell( getSegmentBox( s ), ( c ) => cells[ c * 2 + 1 ] ++ );

	let itemCount = 0, maxPerCell = 0;

	for ( let c = 0; c < cellCount; c ++ ) {

		cells[ c * 2 ] = itemCount;
		itemCount += cells[ c * 2 + 1 ];
		maxPerCell = Math.max( maxPerCell, cells[ c * 2 + 1 ] );
		cells[ c * 2 + 1 ] = 0;

	}

	const items = new Uint32Array( Math.max( 1, itemCount ) * 2 ); // ( pointIndex, curveIndex ) per entry

	for ( let s = 0; s < segmentCount; s ++ ) {

		forEachCell( getSegmentBox( s ), ( c ) => {

			const slot = cells[ c * 2 ] + cells[ c * 2 + 1 ] ++;
			items[ slot * 2 ] = segmentList[ s * 2 ];
			items[ slot * 2 + 1 ] = segmentList[ s * 2 + 1 ];

		} );

	}

	// 3. Upload as read-only storage buffers.

	const attributes = [
		new StorageBufferAttribute( points, 4 ),
		new StorageBufferAttribute( items, 2 ),
		new StorageBufferAttribute( cells, 2 )
	];

	const pointData = storage( attributes[ 0 ], 'vec4', pointCount ).toReadOnly();
	const itemData = storage( attributes[ 1 ], 'uvec2', items.length / 2 ).toReadOnly();
	const cellData = storage( attributes[ 2 ], 'uvec2', cellCount ).toReadOnly();

	const combine = ( x, y ) => blend > 0 ? smoothMin( x, y, blend ) : min( x, y );

	const distance = Fn( ( [ position ], builder ) => {

		if ( builder.renderer && builder.renderer.backend && builder.renderer.backend.isWebGPUBackend !== true ) {

			throw new Error( 'splineDistanceStorage: requires the WebGPU backend. Use splineDistance() for the WebGL 2 fallback.' );

		}

		const p = vec3( position ).toVar();
		const result = float( margin ).toVar();
		const cell = ivec3( floor( p.sub( gridBox.min ).div( cellSize ) ) ).toVar();

		const inside = cell.x.greaterThanEqual( 0 ).and( cell.y.greaterThanEqual( 0 ) ).and( cell.z.greaterThanEqual( 0 ) )
			.and( cell.x.lessThan( int( dims.x ) ) ).and( cell.y.lessThan( int( dims.y ) ) ).and( cell.z.lessThan( int( dims.z ) ) );

		If( inside, () => {

			const range = cellData.element( cell.x.add( cell.y.mul( int( dims.x ) ) ).add( cell.z.mul( int( dims.x * dims.y ) ) ) );
			const start = int( range.x ).toVar();
			const end = start.add( int( range.y ) ).toVar();

			const total = float( 1e10 ).toVar();
			const curveDistance = float( 1e10 ).toVar();
			const currentCurve = int( - 1 ).toVar();

			Loop( { start, end, type: 'int', condition: '<' }, ( { i } ) => {

				const item = itemData.element( i );
				const curve = int( item.y );

				If( curve.notEqual( currentCurve ), () => { // next curve: fold the previous one in

					total.assign( combine( total, curveDistance ) );
					curveDistance.assign( 1e10 );
					currentCurve.assign( curve );

				} );

				const first = int( item.x );
				const pa = pointData.element( first );
				const pb = pointData.element( first.add( 1 ) );

				const ap = p.sub( pa.xyz );
				const ab = pb.xyz.sub( pa.xyz );
				const h = clamp( dot( ap, ab ).div( max( dot( ab, ab ), 1e-12 ) ), 0.0, 1.0 );

				curveDistance.assign( min( curveDistance, length( ap.sub( ab.mul( h ) ) ).sub( mix( pa.w, pb.w, h ) ) ) );

			} );

			total.assign( combine( total, curveDistance ) );
			result.assign( min( total, margin ) );

		} );

		return result;

	} );

	const sdf = ( position ) => distance( position );

	sdf.info = {
		curves: curveList.length,
		points: pointCount,
		segments: segmentCount,
		gridCells: [ dims.x, dims.y, dims.z ],
		cellSize,
		listedSegments: itemCount,
		maxSegmentsPerCell: maxPerCell,
		bytes: points.byteLength + items.byteLength + cells.byteLength
	};

	/**
	 * Frees the storage buffers. Pass the renderer they were used with: not every
	 * three.js release frees storage buffers on attribute.dispose() alone.
	 */
	sdf.dispose = ( renderer ) => {

		for ( const attribute of attributes ) {

			if ( typeof attribute.dispose === 'function' ) attribute.dispose();

			const store = renderer && renderer._attributes;
			if ( store && typeof store.delete === 'function' ) store.delete( attribute );

		}

	};

	return sdf;

}

// Polynomial smooth minimum (Inigo Quilez), same as splineDistance().
function smoothMin( a, b, k ) {

	const h = clamp( b.sub( a ).div( k ).mul( 0.5 ).add( 0.5 ), 0.0, 1.0 );

	return mix( b, a, h ).sub( h.mul( h.oneMinus() ).mul( k ) );

}
