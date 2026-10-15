import { CatmullRomCurve3, Vector3 } from 'three/webgpu';

/**
 * Spline presets for splines.html (also used by the tests). Each preset returns
 * { curves, radius, blend, segments }, ready for splineDistance( curves, options ).
 * Presets with `storage: true` exceed splineDistance()'s 4096-point limit and are
 * meant for splineDistanceStorage( curves, options ), which also reads `margin`.
 * Everything is deterministic and stays inside bounds = 1.
 */

const V = ( x, y, z ) => new Vector3( x, y, z );

// Small seeded PRNG so presets look the same on every run.
function mulberry32( seed ) {

	return function () {

		seed |= 0;
		seed = seed + 0x6d2b79f5 | 0;
		let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

function braid() {

	const strand = ( phase ) => new CatmullRomCurve3( Array.from( { length: 24 }, ( _, k ) => {

		const t = k / 23;
		return V( 0.19 * Math.cos( 6 * t + phase ), - 0.75 + 1.5 * t, 0.19 * Math.sin( 6 * t + phase ) );

	} ) );

	const curves = [ strand( 0 ), strand( 2 * Math.PI / 3 ), strand( 4 * Math.PI / 3 ), new CatmullRomCurve3( [ V( 0, - 0.8, 0 ), V( 0, 0.8, 0 ) ] ) ];

	return { curves, radius: 0.07, blend: 0.12, segments: 80 };

}

function trefoilKnot() {

	const points = Array.from( { length: 60 }, ( _, k ) => {

		const t = k / 60 * Math.PI * 2;
		return V( Math.sin( t ) + 2 * Math.sin( 2 * t ), Math.cos( t ) - 2 * Math.cos( 2 * t ), - Math.sin( 3 * t ) ).multiplyScalar( 0.27 );

	} );

	return { curves: [ new CatmullRomCurve3( points, true, 'centripetal' ) ], radius: 0.08, blend: 0, segments: 160 };

}

function tree() {

	const random = mulberry32( 7 );
	const curves = [];
	const radii = []; // [ start, end ] radius per curve

	const trunk = new CatmullRomCurve3( [ V( 0, - 0.85, 0 ), V( 0.05, - 0.5, 0.02 ), V( - 0.04, - 0.1, - 0.03 ), V( 0.02, 0.2, 0.01 ) ] );
	curves.push( trunk );
	radii.push( [ 0.1, 0.05 ] );

	const addBranch = ( parent, parentRadius, u, direction, length, depth ) => {

		const startRadius = parentRadius * 0.85;
		const points = [ parent.getPointAt( u ) ];
		const heading = direction.clone().normalize();

		for ( let k = 1; k <= 3; k ++ ) {

			heading.add( V( ( random() - 0.5 ) * 0.6, 0.3, ( random() - 0.5 ) * 0.6 ) ).normalize();
			points.push( points[ k - 1 ].clone().addScaledVector( heading, length / 3 ) );

		}

		const branch = new CatmullRomCurve3( points );
		curves.push( branch );
		radii.push( [ startRadius, startRadius * 0.45 ] );

		if ( depth > 0 ) {

			for ( let b = 0; b < 2; b ++ ) {

				const angle = random() * Math.PI * 2;
				const at = 0.45 + 0.4 * random();
				addBranch( branch, startRadius * ( 1 - 0.55 * at ), at, V( Math.cos( angle ), 0.7, Math.sin( angle ) ), length * 0.6, depth - 1 );

			}

		}

	};

	for ( let b = 0; b < 4; b ++ ) {

		const angle = b * Math.PI / 2 + random();
		const at = 0.5 + 0.45 * random();
		addBranch( trunk, 0.1 - 0.05 * at, at, V( Math.cos( angle ), 0.45, Math.sin( angle ) ), 0.6, 1 );

	}

	return {
		curves,
		radius: ( u, i ) => radii[ i ][ 0 ] + ( radii[ i ][ 1 ] - radii[ i ][ 0 ] ) * u,
		blend: 0.05,
		segments: 32
	};

}

function tangle() {

	const random = mulberry32( 42 );

	const curves = Array.from( { length: 16 }, () => {

		const points = Array.from( { length: 6 }, () => {

			const direction = V( random() - 0.5, random() - 0.5, random() - 0.5 ).normalize();
			return direction.multiplyScalar( 0.15 + 0.55 * Math.cbrt( random() ) );

		} );

		return new CatmullRomCurve3( points, false, 'centripetal' );

	} );

	return { curves, radius: 0.045, blend: 0.05, segments: 48 };

}

// Large presets (storage buffers)

function yarnBall() {

	const random = mulberry32( 3 );

	const curves = Array.from( { length: 180 }, () => {

		// A wandering arc on a sphere: rotate around a random axis, with a little radial wobble.
		const axis = V( random() - 0.5, random() - 0.5, random() - 0.5 ).normalize();
		const u = V( 1, 0, 0 ).cross( axis ).lengthSq() > 0.01 ? V( 1, 0, 0 ).cross( axis ).normalize() : V( 0, 1, 0 ).cross( axis ).normalize();
		const v = axis.clone().cross( u );
		const start = random() * Math.PI * 2;
		const span = ( 0.6 + 0.6 * random() ) * Math.PI;

		const points = Array.from( { length: 8 }, ( _, k ) => {

			const angle = start + span * k / 7;
			const r = 0.62 + 0.05 * ( random() - 0.5 );
			return u.clone().multiplyScalar( Math.cos( angle ) * r ).addScaledVector( v, Math.sin( angle ) * r );

		} );

		return new CatmullRomCurve3( points, false, 'centripetal' );

	} );

	return { curves, radius: 0.018, blend: 0.015, segments: 48, storage: true, margin: 0.06 };

}

function toroidalCoil() {

	// One long closed curve winding 30 times around a torus.
	const turns = 30, R = 0.55, r = 0.2, count = turns * 16;

	const points = Array.from( { length: count }, ( _, k ) => {

		const t = k / count * Math.PI * 2, a = turns * t;
		return V( ( R + r * Math.cos( a ) ) * Math.cos( t ), r * Math.sin( a ), ( R + r * Math.cos( a ) ) * Math.sin( t ) );

	} );

	return { curves: [ new CatmullRomCurve3( points, true ) ], radius: 0.024, blend: 0, segments: 6000, storage: true, margin: 0.06 };

}

export const splinePresets = {
	'Braid': braid,
	'Trefoil knot': trefoilKnot,
	'Tree': tree,
	'Tangle': tangle,
	'Yarn ball (storage)': yarnBall,
	'Toroidal coil (storage)': toroidalCoil
};
