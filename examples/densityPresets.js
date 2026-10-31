import { Quaternion, Vector3 } from 'three/webgpu';
import { Fn, exp, length } from 'three/tsl';
import { pointDensity } from './pointDensity.js';

/**
 * Density presets for density.html (also used by the tests). Each preset returns
 * { field, bounds, level, levelRange, points }, ready for
 * generator.generate( res, field, bounds, { level, inside: 'above' } ).
 * `points` is the number of kernels for point densities, 0 otherwise.
 * Everything is deterministic and stays inside the bounds at the default level.
 */

const V = ( x, y, z ) => new Vector3( x, y, z );

// Small seeded PRNG so presets look the same on every run (same as splinePresets.js).
function mulberry32( seed ) {

	return function () {

		seed |= 0;
		seed = seed + 0x6d2b79f5 | 0;
		let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

// Standard normal samples (Box-Muller).
function gaussianRandom( random ) {

	return () => Math.sqrt( - 2 * Math.log( 1 - random() ) ) * Math.cos( 2 * Math.PI * random() );

}

function metaballs() {

	const balls = [
		[ V( - 0.36, 0.04, 0.0 ), 0.2 ],
		[ V( 0.12, 0.16, 0.06 ), 0.17 ],
		[ V( 0.46, - 0.08, - 0.1 ), 0.14 ],
		[ V( - 0.06, - 0.3, 0.16 ), 0.15 ],
		[ V( 0.04, 0.44, - 0.18 ), 0.12 ],
		[ V( - 0.2, 0.1, 0.4 ), 0.11 ]
	];

	const points = balls.map( ( [ center ] ) => center );

	return {
		field: pointDensity( points, { radius: ( point, i ) => balls[ i ][ 1 ] } ),
		bounds: 1,
		level: 0.4,
		levelRange: [ 0.1, 1 ],
		points: points.length
	};

}

function spiralGalaxy() {

	const random = mulberry32( 11 );
	const normal = gaussianRandom( random );
	const points = [];

	// A flattened central bulge.

	for ( let k = 0; k < 160; k ++ ) points.push( V( 0.11 * normal(), 0.06 * normal(), 0.11 * normal() ) );

	// Two logarithmic spiral arms that widen and thin out towards the rim.

	for ( let arm = 0; arm < 2; arm ++ ) {

		for ( let k = 0; k < 400; k ++ ) {

			const t = random();
			const angle = arm * Math.PI + 2.4 * Math.PI * t;
			const r = 0.14 * Math.exp( 1.6 * t );
			const spread = 0.012 + 0.02 * t;

			points.push( V( r * Math.cos( angle ) + spread * normal(), 0.025 * normal(), r * Math.sin( angle ) + spread * normal() ) );

		}

	}

	// Tilt the disc 40 degrees towards the default camera of density.html.

	const tilt = new Quaternion().setFromAxisAngle( V( 0.69, 0, - 0.6 ).normalize(), 0.7 );
	points.forEach( ( point ) => point.applyQuaternion( tilt ) );

	return {
		field: pointDensity( points, { radius: 0.03 } ),
		bounds: 1,
		level: 1,
		levelRange: [ 0.2, 6 ],
		points: points.length
	};

}

function hydrogenOrbital() {

	// Probability density of the hydrogen 3d_z2 orbital, with the axis along y:
	// psi ~ ( 3 y^2 - r^2 ) exp( -r / 3 ), r in Bohr radii. Normalized so the peak
	// (on the axis at r = 6) is 1. The two lobes peak at 1 and the torus at 0.25, and a
	// nodal cone separates them at every level.

	const scale = 20; // Bohr radii per unit
	const peak = 4 * 6 ** 4 * Math.exp( - 4 );

	const field = Fn( ( [ p ] ) => {

		const q = p.mul( scale );
		const r = length( q );
		const psi = q.y.mul( q.y ).mul( 3 ).sub( r.mul( r ) ).mul( exp( r.div( - 3 ) ) );

		return psi.mul( psi ).div( peak );

	} );

	return { field, bounds: 1, level: 0.05, levelRange: [ 0.02, 0.9 ], points: 0 };

}

export const densityPresets = {
	'Metaballs': metaballs,
	'Spiral galaxy (point cloud)': spiralGalaxy,
	'Hydrogen 3d orbital': hydrogenOrbital
};
