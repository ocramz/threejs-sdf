/**
 * splineDistance: a TSL signed distance function for tubes around one or more
 * three.js curves (CatmullRomCurve3, CubicBezierCurve3, CurvePath, ...), for use
 * with SDFGeometryGenerator.
 *
 *   import { splineDistance } from 'three-sdf-geometry-generator/examples/splineDistance.js';
 *
 *   const sdf = splineDistance( [ curveA, curveB ], { radius: 0.06, blend: 0.1 } );
 *   const geometry = await generator.generate( 128, sdf, 1 );
 *
 * Each curve is sampled into a polyline (arc-length spaced) and uploaded as a
 * uniform array. In the shader, the distance to a curve is the minimum distance
 * to its segments minus the (interpolated) radius; curves are combined with min()
 * or, when `blend` > 0, a smooth minimum so they fuse into one organic surface.
 *
 * Error vs. the true curve is the polyline's sagitta (~ L^2 * curvature / 8 per
 * segment of length L), so use enough segments that this stays below the cell
 * size (2 * bounds / res).
 */

import { Box3, Vector3, Vector4 } from 'three/webgpu';
import { If, Loop, abs, clamp, dot, float, length, max, min, mix, uniformArray, vec3 } from 'three/tsl';

/**
 * @param {Curve|Array<Curve>} curves - One curve or an array of curves (any THREE.Curve returning Vector3 points).
 * @param {Object} [options]
 * @param {number|function(number, number): number} [options.radius=0.05] - Tube radius, or a function
 * ( u, curveIndex ) => radius with u in [ 0, 1 ] along the curve's length.
 * @param {number|function(Curve, number): number} [options.segments=64] - Polyline segments per curve,
 * or a function ( curve, curveIndex ) => count.
 * @param {number} [options.blend=0] - Smooth-union radius between different curves (0 = hard union).
 * @return {function(Node): Node} A TSL distance function ( p: vec3 ) => float.
 */
export function splineDistance( curves, options = {} ) {

	const { radius = 0.05, segments = 64, blend = 0 } = options;
	const curveList = Array.isArray( curves ) ? curves : [ curves ];

	const points = [];
	const spans = [];

	curveList.forEach( ( curve, curveIndex ) => {

		const count = Math.max( 1, Math.round( typeof segments === 'function' ? segments( curve, curveIndex ) : segments ) );
		const start = points.length;
		const box = new Box3();
		let maxRadius = 0;

		curve.getSpacedPoints( count ).forEach( ( point, k ) => {

			const r = typeof radius === 'function' ? radius( k / count, curveIndex ) : radius;

			points.push( new Vector4( point.x, point.y, point.z, r ) );
			box.expandByPoint( point );
			maxRadius = Math.max( maxRadius, r );

		} );

		box.expandByScalar( maxRadius ); // the tube lies inside this box

		spans.push( {
			start,
			end: points.length - 1, // segments are ( i, i + 1 ) for start <= i < end
			center: box.getCenter( new Vector3() ),
			halfSize: box.getSize( new Vector3() ).multiplyScalar( 0.5 )
		} );

	} );

	if ( points.length > 4096 ) {

		throw new Error( `splineDistance: ${ points.length } points exceed the 4096 that fit in a 64 kB uniform buffer. Use fewer segments per curve, or splineDistanceStorage() for larger curve sets.` );

	}

	const pointData = uniformArray( points, 'vec4' );

	return ( position ) => {

		const p = vec3( position ).toVar();
		const result = float( 1e10 ).toVar();

		for ( const span of spans ) {

			// Skip curves whose bounding box is already farther away than the current
			// result: they cannot lower it (or affect the smooth union).

			const q = abs( p.sub( span.center ) ).sub( span.halfSize );
			const boxDistance = length( max( q, 0.0 ) ).add( min( max( q.x, max( q.y, q.z ) ), 0.0 ) );

			If( boxDistance.lessThan( result.add( blend ) ), () => {

				const curveDistance = float( 1e10 ).toVar();

				Loop( { start: span.start, end: span.end, type: 'int', condition: '<' }, ( { i } ) => {

					const a = pointData.element( i );
					const b = pointData.element( i.add( 1 ) );

					const pa = p.sub( a.xyz );
					const ba = b.xyz.sub( a.xyz );
					const h = clamp( dot( pa, ba ).div( max( dot( ba, ba ), 1e-12 ) ), 0.0, 1.0 );

					curveDistance.assign( min( curveDistance, length( pa.sub( ba.mul( h ) ) ).sub( mix( a.w, b.w, h ) ) ) );

				} );

				result.assign( blend > 0 ? smoothMin( result, curveDistance, blend ) : min( result, curveDistance ) );

			} );

		}

		return result;

	};

}

// Polynomial smooth minimum (Inigo Quilez).
function smoothMin( a, b, k ) {

	const h = clamp( b.sub( a ).div( k ).mul( 0.5 ).add( 0.5 ), 0.0, 1.0 );

	return mix( b, a, h ).sub( h.mul( h.oneMinus() ).mul( k ) );

}
