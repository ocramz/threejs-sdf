/**
 * three-sdf-geometry-generator
 *
 * Creates an indexed BufferGeometry from a signed distance function (SDF) with
 * three.js WebGPURenderer.
 *
 * Port of the WebGL SDFGeometryGenerator addon by santiago / @glitch_life
 * (three.js PR #26837) to the node-based renderer: the distance field is sampled
 * on the GPU with a TSL compute shader, read back with getArrayBufferAsync(), and
 * polygonized on the CPU with Surface Nets (S. F. Gibson, "Constrained Elastic
 * Surface Nets", 1998; edge tables after Mikola Lysenko's isosurface package).
 *
 * Usage:
 *
 *   import { Fn, length, vec2 } from 'three/tsl';
 *   import { SDFGeometryGenerator } from 'three-sdf-geometry-generator';
 *
 *   const generator = new SDFGeometryGenerator( renderer ); // a WebGPURenderer
 *
 *   const torus = Fn( ( [ p ] ) => length( vec2( length( p.xz ).sub( 0.6 ), p.y ) ).sub( 0.2 ) );
 *   const geometry = await generator.generate( 128, torus, 1 );
 *
 * See README.md for the full API and the differences from the WebGL version.
 *
 * MIT License
 */

import {
	BufferAttribute,
	BufferGeometry
} from 'three/webgpu';

import {
	Fn,
	If,
	Return,
	float,
	instanceIndex,
	instancedArray,
	length,
	max,
	uint,
	uniform,
	vec3,
	wgsl,
	wgslFn
} from 'three/tsl';

// Surface Nets lookup tables

const CUBE_EDGES = new Int32Array( 24 ); // 12 edges as pairs of corner indices (corner = x | y << 1 | z << 2)
const EDGE_TABLE = new Int32Array( 256 ); // corner sign mask -> 12-bit mask of edges crossing the surface

( function () {

	let k = 0;

	for ( let i = 0; i < 8; i ++ ) {

		for ( let j = 1; j <= 4; j <<= 1 ) {

			const p = i ^ j;

			if ( i <= p ) {

				CUBE_EDGES[ k ++ ] = i;
				CUBE_EDGES[ k ++ ] = p;

			}

		}

	}

	// The first three edges are the ones leaving corner 0 along +x, +y and +z.

	for ( let mask = 0; mask < 256; mask ++ ) {

		let edgeMask = 0;

		for ( let e = 0; e < 24; e += 2 ) {

			const a = ( mask >> CUBE_EDGES[ e ] ) & 1;
			const b = ( mask >> CUBE_EDGES[ e + 1 ] ) & 1;

			if ( a !== b ) edgeMask |= 1 << ( e >> 1 );

		}

		EDGE_TABLE[ mask ] = edgeMask;

	}

} )();

const _defaultDistance = ( p ) => length( p ).sub( 0.5 );

class SDFGeometryGenerator {

	/**
	 * @param {WebGPURenderer} renderer - The renderer used to evaluate the SDF.
	 */
	constructor( renderer ) {

		if ( ! renderer || renderer.isWebGPURenderer !== true ) {

			throw new Error( 'THREE.SDFGeometryGenerator: A WebGPURenderer (three/webgpu) is required.' );

		}

		this.renderer = renderer;

		/**
		 * Upper bound for the number of samples evaluated per compute dispatch.
		 * Larger volumes are processed in slabs of whole z-slices. The default
		 * (4M samples, 16 MB) is well below the default WebGPU storage buffer limit.
		 *
		 * @type {number}
		 */
		this.maxSamplesPerPass = 1 << 22;

	}

	/**
	 * Same as {@link SDFGeometryGenerator#generateAsync}. Kept for API compatibility
	 * with the WebGL version, but note that it returns a Promise.
	 *
	 * @param {number} [res=64]
	 * @param {Function|string} [distFunc]
	 * @param {number} [bounds=1]
	 * @return {Promise<BufferGeometry>}
	 */
	generate( res, distFunc, bounds ) {

		return this.generateAsync( res, distFunc, bounds );

	}

	/**
	 * Samples the SDF on a grid of res x res x res cells spanning
	 * [ -bounds, bounds ]^3 and returns the zero-level surface as geometry.
	 *
	 * @param {number} [res=64] - Number of cells along each axis (integer >= 2).
	 * @param {Function|string} [distFunc] - Either a TSL function receiving the sample
	 * position (vec3 node) and returning the signed distance (float node), e.g.
	 * Fn( ( [ p ] ) => length( p ).sub( 0.5 ) ), or a WGSL string that defines
	 * fn dist( p: vec3<f32> ) -> f32 (plus any helper functions it needs).
	 * Negative values are inside. Defaults to a sphere of radius 0.5.
	 * @param {number} [bounds=1] - Half extent of the sampled cube, centered at the origin.
	 * @return {Promise<BufferGeometry>} Indexed geometry with position and normal attributes.
	 */
	async generateAsync( res = 64, distFunc = _defaultDistance, bounds = 1 ) {

		if ( Number.isInteger( res ) === false || res < 2 ) {

			throw new Error( 'THREE.SDFGeometryGenerator: res must be an integer >= 2.' );

		}

		if ( ! ( bounds > 0 ) ) {

			throw new Error( 'THREE.SDFGeometryGenerator: bounds must be a positive number.' );

		}

		const renderer = this.renderer;

		// Older releases throw when init() is called on an initialized renderer.
		if ( renderer._initialized !== true ) await renderer.init();

		const distance = this._getDistanceNode( distFunc );

		const n = res + 1; // samples per axis
		const sliceSize = n * n;
		const cellSize = ( 2 * bounds ) / res;

		const slicesPerPass = Math.max( 1, Math.min( n, Math.floor( this.maxSamplesPerPass / sliceSize ) ) );
		const passCount = Math.ceil( n / slicesPerPass );
		const samplesPerPass = slicesPerPass * sliceSize;

		// GPU: one storage buffer holding a slab of z-slices, reused for every pass.

		const field = instancedArray( samplesPerPass, 'float' );
		const zOffset = uniform( 0, 'uint' );

		const kernel = Fn( () => {

			If( instanceIndex.greaterThanEqual( uint( samplesPerPass ) ), () => {

				Return();

			} );

			const nU = uint( n );
			const x = instanceIndex.mod( nU ).toVar();
			const y = instanceIndex.div( nU ).mod( nU ).toVar();
			const z = instanceIndex.div( uint( sliceSize ) ).add( zOffset ).toVar();

			const p = vec3( float( x ), float( y ), float( z ) ).mul( cellSize ).sub( bounds );
			const d = float( distance( p ) ).toVar();

			// Clamp the outer shell of samples to "outside" so shapes clipped by the bounds get capped.

			const last = uint( n - 1 );
			const zero = uint( 0 );

			If( x.equal( zero ).or( y.equal( zero ) ).or( z.equal( zero ) )
				.or( x.greaterThanEqual( last ) ).or( y.greaterThanEqual( last ) ).or( z.greaterThanEqual( last ) ), () => {

				d.assign( max( d, float( 0 ) ) );

			} );

			field.element( instanceIndex ).assign( d );

		} )().compute( samplesPerPass );

		const dispatch = ( pass ) => {

			zOffset.value = pass * slicesPerPass;
			renderer.compute( kernel );

			return renderer.getArrayBufferAsync( field.value );

		};

		// CPU: stream slabs into the mesher. While the CPU meshes slab k, the GPU
		// already evaluates slab k + 1 (the buffer is only reused after its readback resolved).

		const mesher = new SurfaceNetMesher( res, cellSize, bounds );

		try {

			let pending = dispatch( 0 );

			for ( let pass = 0; pass < passCount; pass ++ ) {

				const data = new Float32Array( await pending );

				if ( pass + 1 < passCount ) pending = dispatch( pass + 1 );

				const z0 = pass * slicesPerPass;
				const slices = Math.min( slicesPerPass, n - z0 );

				for ( let s = 0; s < slices; s ++ ) {

					mesher.addSlice( data.subarray( s * sliceSize, ( s + 1 ) * sliceSize ) );

				}

			}

		} finally {

			kernel.dispose();
			this._disposeStorage( field.value );

		}

		return mesher.toGeometry();

	}

	_getDistanceNode( distFunc ) {

		if ( typeof distFunc === 'function' ) return distFunc; // TSL Fn() or plain ( p ) => node

		if ( typeof distFunc === 'string' ) {

			if ( /\bfn\s+dist\s*\(/.test( distFunc ) ) {

				if ( this.renderer.backend.isWebGPUBackend !== true ) {

					throw new Error( 'THREE.SDFGeometryGenerator: WGSL distance functions require the WebGPU backend. Use a TSL function to also support the WebGL 2 fallback.' );

				}

				// The user code goes in as an include so it may contain helper functions in any order.

				const entry = wgslFn( 'fn sdfGeometryGeneratorDist( p: vec3<f32> ) -> f32 { return dist( p ); }', [ wgsl( distFunc ) ] );

				return ( p ) => entry( p );

			}

			if ( /\bfloat\s+dist\s*\(/.test( distFunc ) ) {

				throw new Error( 'THREE.SDFGeometryGenerator: GLSL distance functions are not supported with WebGPURenderer. Port it to TSL, or to WGSL as fn dist( p: vec3<f32> ) -> f32 { ... }.' );

			}

			throw new Error( 'THREE.SDFGeometryGenerator: The WGSL string must define fn dist( p: vec3<f32> ) -> f32.' );

		}

		throw new TypeError( 'THREE.SDFGeometryGenerator: distFunc must be a TSL function or a WGSL string.' );

	}

	_disposeStorage( attribute ) {

		if ( typeof attribute.dispose === 'function' ) attribute.dispose(); // r181+

		// Not every renderer version frees storage buffers on attribute.dispose(),
		// so release the GPU buffer explicitly when the internal store is available.

		const attributes = this.renderer._attributes;

		if ( attributes && typeof attributes.delete === 'function' ) attributes.delete( attribute );

	}

}

/**
 * Streaming Surface Nets: consumes the field one z-slice at a time and only keeps
 * two slices of samples and two layers of cell-to-vertex indices in memory.
 */
class SurfaceNetMesher {

	constructor( res, cellSize, bounds ) {

		this.cells = res;
		this.n = res + 1;
		this.cellSize = cellSize;
		this.bounds = bounds;

		this.z = 0; // number of slices consumed
		this.previousSlice = null;

		this.previousLayer = new Int32Array( res * res ).fill( - 1 );
		this.currentLayer = new Int32Array( res * res ).fill( - 1 );

		this.positions = new Float32Array( 3 * 4096 );
		this.normals = new Float32Array( 3 * 4096 );
		this.indices = new Uint32Array( 6 * 4096 );
		this.vertexCount = 0;
		this.indexCount = 0;

		this.corners = new Float64Array( 8 );

	}

	addSlice( slice ) {

		if ( this.previousSlice !== null ) this._polygonizeLayer( this.z - 1, this.previousSlice, slice );

		this.previousSlice = slice;
		this.z ++;

	}

	_polygonizeLayer( cz, s0, s1 ) {

		const { cells, n, cellSize, bounds, corners } = this;

		const swap = this.previousLayer;
		this.previousLayer = this.currentLayer;
		this.currentLayer = swap;

		const previous = this.previousLayer;
		const current = this.currentLayer;

		for ( let cy = 0; cy < cells; cy ++ ) {

			let i = cy * n; // sample index of the cell's corner 0 within a slice
			let ci = cy * cells; // cell index within the layer

			for ( let cx = 0; cx < cells; cx ++, i ++, ci ++ ) {

				const v0 = s0[ i ], v1 = s0[ i + 1 ], v2 = s0[ i + n ], v3 = s0[ i + n + 1 ];
				const v4 = s1[ i ], v5 = s1[ i + 1 ], v6 = s1[ i + n ], v7 = s1[ i + n + 1 ];

				const mask = ( v0 < 0 ? 1 : 0 ) | ( v1 < 0 ? 2 : 0 ) | ( v2 < 0 ? 4 : 0 ) | ( v3 < 0 ? 8 : 0 ) |
					( v4 < 0 ? 16 : 0 ) | ( v5 < 0 ? 32 : 0 ) | ( v6 < 0 ? 64 : 0 ) | ( v7 < 0 ? 128 : 0 );

				if ( mask === 0 || mask === 255 ) {

					current[ ci ] = - 1;
					continue;

				}

				corners[ 0 ] = v0; corners[ 1 ] = v1; corners[ 2 ] = v2; corners[ 3 ] = v3;
				corners[ 4 ] = v4; corners[ 5 ] = v5; corners[ 6 ] = v6; corners[ 7 ] = v7;

				// Vertex = average of the edge/surface intersections inside the cell.

				const edgeMask = EDGE_TABLE[ mask ];
				let fx = 0, fy = 0, fz = 0, crossings = 0;

				for ( let e = 0; e < 12; e ++ ) {

					if ( ( edgeMask & ( 1 << e ) ) === 0 ) continue;

					const a = CUBE_EDGES[ e << 1 ];
					const b = CUBE_EDGES[ ( e << 1 ) + 1 ];
					const da = corners[ a ];
					const t = da / ( da - corners[ b ] ); // signs differ, so the denominator is never 0

					const ax = a & 1, ay = ( a >> 1 ) & 1, az = ( a >> 2 ) & 1;

					fx += ax + t * ( ( b & 1 ) - ax );
					fy += ay + t * ( ( ( b >> 1 ) & 1 ) - ay );
					fz += az + t * ( ( ( b >> 2 ) & 1 ) - az );
					crossings ++;

				}

				fx /= crossings; fy /= crossings; fz /= crossings;

				// Normal = gradient of the trilinear interpolant at the vertex.

				const gx = ( 1 - fy ) * ( 1 - fz ) * ( v1 - v0 ) + fy * ( 1 - fz ) * ( v3 - v2 ) + ( 1 - fy ) * fz * ( v5 - v4 ) + fy * fz * ( v7 - v6 );
				const gy = ( 1 - fx ) * ( 1 - fz ) * ( v2 - v0 ) + fx * ( 1 - fz ) * ( v3 - v1 ) + ( 1 - fx ) * fz * ( v6 - v4 ) + fx * fz * ( v7 - v5 );
				const gz = ( 1 - fx ) * ( 1 - fy ) * ( v4 - v0 ) + fx * ( 1 - fy ) * ( v5 - v1 ) + ( 1 - fx ) * fy * ( v6 - v2 ) + fx * fy * ( v7 - v3 );

				const vertex = this._addVertex(
					( cx + fx ) * cellSize - bounds,
					( cy + fy ) * cellSize - bounds,
					( cz + fz ) * cellSize - bounds,
					gx, gy, gz
				);

				current[ ci ] = vertex;

				// Emit one quad per crossing edge leaving corner 0, connecting the four
				// cells around that edge. Corner 0 inside means the outward normal points
				// along +axis. Quads are listed as ( c, c - u, c - u - v, c - v ) with
				// ( axis, u, v ) cyclic, i.e. counter-clockwise when viewed from +axis.

				const inside = ( mask & 1 ) !== 0;

				if ( ( edgeMask & 1 ) !== 0 && cy > 0 && cz > 0 ) { // x edge: u = y, v = z

					this._addQuad( vertex, current[ ci - cells ], previous[ ci - cells ], previous[ ci ], inside );

				}

				if ( ( edgeMask & 2 ) !== 0 && cz > 0 && cx > 0 ) { // y edge: u = z, v = x

					this._addQuad( vertex, previous[ ci ], previous[ ci - 1 ], current[ ci - 1 ], inside );

				}

				if ( ( edgeMask & 4 ) !== 0 && cx > 0 && cy > 0 ) { // z edge: u = x, v = y

					this._addQuad( vertex, current[ ci - 1 ], current[ ci - 1 - cells ], current[ ci - cells ], inside );

				}

			}

		}

	}

	_addVertex( x, y, z, nx, ny, nz ) {

		if ( this.vertexCount * 3 + 3 > this.positions.length ) {

			this.positions = grow( this.positions );
			this.normals = grow( this.normals );

		}

		const o = this.vertexCount * 3;

		this.positions[ o ] = x;
		this.positions[ o + 1 ] = y;
		this.positions[ o + 2 ] = z;

		const l = Math.hypot( nx, ny, nz );

		if ( l > 0 ) {

			this.normals[ o ] = nx / l;
			this.normals[ o + 1 ] = ny / l;
			this.normals[ o + 2 ] = nz / l;

		} else {

			this.normals[ o + 1 ] = 1;

		}

		return this.vertexCount ++;

	}

	_addQuad( a, b, c, d, inside ) {

		if ( a < 0 || b < 0 || c < 0 || d < 0 ) return;

		if ( this.indexCount + 6 > this.indices.length ) this.indices = grow( this.indices );

		const indices = this.indices;
		let o = this.indexCount;

		// split along the shorter diagonal

		if ( this._distanceSq( a, c ) <= this._distanceSq( b, d ) ) {

			if ( inside ) {

				indices[ o ++ ] = a; indices[ o ++ ] = b; indices[ o ++ ] = c;
				indices[ o ++ ] = a; indices[ o ++ ] = c; indices[ o ++ ] = d;

			} else {

				indices[ o ++ ] = a; indices[ o ++ ] = c; indices[ o ++ ] = b;
				indices[ o ++ ] = a; indices[ o ++ ] = d; indices[ o ++ ] = c;

			}

		} else {

			if ( inside ) {

				indices[ o ++ ] = a; indices[ o ++ ] = b; indices[ o ++ ] = d;
				indices[ o ++ ] = b; indices[ o ++ ] = c; indices[ o ++ ] = d;

			} else {

				indices[ o ++ ] = a; indices[ o ++ ] = d; indices[ o ++ ] = b;
				indices[ o ++ ] = b; indices[ o ++ ] = d; indices[ o ++ ] = c;

			}

		}

		this.indexCount = o;

	}

	_distanceSq( a, b ) {

		const p = this.positions;
		const dx = p[ a * 3 ] - p[ b * 3 ];
		const dy = p[ a * 3 + 1 ] - p[ b * 3 + 1 ];
		const dz = p[ a * 3 + 2 ] - p[ b * 3 + 2 ];

		return dx * dx + dy * dy + dz * dz;

	}

	toGeometry() {

		const geometry = new BufferGeometry();
		const vertexCount = this.vertexCount;

		geometry.setAttribute( 'position', new BufferAttribute( this.positions.slice( 0, vertexCount * 3 ), 3 ) );
		geometry.setAttribute( 'normal', new BufferAttribute( this.normals.slice( 0, vertexCount * 3 ), 3 ) );

		const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
		geometry.setIndex( new BufferAttribute( new IndexArray( this.indices.subarray( 0, this.indexCount ) ), 1 ) );

		return geometry;

	}

}

function grow( array ) {

	const grown = new array.constructor( array.length * 2 );
	grown.set( array );

	return grown;

}

export { SDFGeometryGenerator };
