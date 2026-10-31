/**
 * pointDensity: a TSL density field for a set of points, the sum of one Gaussian
 * kernel per point (a kernel density estimate, or "metaballs"), for use with the
 * level-set options of SDFGeometryGenerator.
 *
 *   import { pointDensity } from 'three-sdf-geometry-generator/examples/pointDensity.js';
 *
 *   const density = pointDensity( points, { radius: 0.1 } );
 *   const geometry = await generator.generate( 128, density, 1, { level: 0.5, inside: 'above' } );
 *
 * The density is rho( p ) = sum_i exp( -|p - c_i|^2 / ( 2 r_i^2 ) ), so every
 * kernel peaks at 1 and an isolated point gives a sphere of radius
 * r * sqrt( -2 ln level ). Nearby kernels add up and fuse smoothly.
 *
 * Points are uploaded as a uniform array (at most 4096), and every sample sums
 * over all of them, so the cost grows with res^3 * points.
 */

import { Vector4 } from 'three/webgpu';
import { Loop, dot, exp, float, uniformArray, vec3 } from 'three/tsl';

/**
 * @param {Vector3|Array<Vector3>} points - One point or an array of points (anything with x, y, z).
 * @param {Object} [options]
 * @param {number|function(Vector3, number): number} [options.radius=0.1] - Kernel radius (the Gaussian's
 * standard deviation), or a function ( point, index ) => radius.
 * @return {function(Node): Node} A TSL density function ( p: vec3 ) => float.
 */
export function pointDensity( points, options = {} ) {

	const { radius = 0.1 } = options;
	const pointList = Array.isArray( points ) ? points : [ points ];

	if ( pointList.length === 0 ) throw new Error( 'pointDensity: no points given.' );

	if ( pointList.length > 4096 ) {

		throw new Error( `pointDensity: ${ pointList.length } points exceed the 4096 that fit in a 64 kB uniform buffer.` );

	}

	// ( x, y, z, -1 / ( 2 r^2 ) ) per point, so the shader only needs exp( |p - c|^2 * w ).

	const data = pointList.map( ( point, index ) => {

		const r = typeof radius === 'function' ? radius( point, index ) : radius;

		if ( ! ( r > 0 ) ) throw new Error( 'pointDensity: radius must be a positive number.' );

		return new Vector4( point.x, point.y, point.z, - 1 / ( 2 * r * r ) );

	} );

	const pointData = uniformArray( data, 'vec4' );

	return ( position ) => {

		const p = vec3( position ).toVar();
		const density = float( 0 ).toVar();

		Loop( { start: 0, end: data.length, type: 'int', condition: '<' }, ( { i } ) => {

			const c = pointData.element( i );
			const d = p.sub( c.xyz );

			density.addAssign( exp( dot( d, d ).mul( c.w ) ) );

		} );

		return density;

	};

}
