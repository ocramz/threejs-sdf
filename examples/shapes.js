import { Fn, abs, clamp, cos, length, max, min, mix, sin, vec2, vec3 } from 'three/tsl';

// Polynomial smooth minimum (smooth union of two distances).
const smin = ( a, b, k ) => {

	const h = clamp( b.sub( a ).div( k ).mul( 0.5 ).add( 0.5 ), 0, 1 );
	return mix( b, a, h ).sub( h.mul( h.oneMinus() ).mul( k ) );

};

const roundBox = ( p, size, radius ) => {

	const q = abs( p ).sub( size );
	return length( max( q, 0.0 ) ).add( min( max( q.x, max( q.y, q.z ) ), 0.0 ) ).sub( radius );

};

export const shapes = {

	'Torus': {
		bounds: 1,
		sdf: Fn( ( [ p ] ) => length( vec2( length( p.xz ).sub( 0.6 ), p.y ) ).sub( 0.2 ) )
	},

	'Blobs (smooth union)': {
		bounds: 1,
		sdf: Fn( ( [ p ] ) => {

			const a = length( p.sub( vec3( - 0.3, 0.0, 0.0 ) ) ).sub( 0.35 );
			const b = length( p.sub( vec3( 0.32, 0.15, 0.0 ) ) ).sub( 0.3 );
			const c = length( p.sub( vec3( 0.0, - 0.3, 0.28 ) ) ).sub( 0.25 );

			return smin( smin( a, b, 0.25 ), c, 0.25 );

		} )
	},

	'Displaced box': {
		bounds: 1,
		sdf: Fn( ( [ p ] ) => {

			const box = roundBox( p, vec3( 0.5, 0.3, 0.4 ), 0.05 );
			const bumps = sin( p.x.mul( 20 ) ).mul( sin( p.y.mul( 20 ) ) ).mul( sin( p.z.mul( 20 ) ) ).mul( 0.02 );

			return box.add( bumps );

		} )
	},

	'Gyroid ball': {
		bounds: 1,
		sdf: Fn( ( [ p ] ) => {

			const s = p.mul( 10 );
			const gyroid = sin( s.x ).mul( cos( s.y ) ).add( sin( s.y ).mul( cos( s.z ) ) ).add( sin( s.z ).mul( cos( s.x ) ) );

			return max( abs( gyroid ).div( 10 ).sub( 0.025 ), length( p ).sub( 0.85 ) );

		} )
	},

	// WGSL source: needs the WebGPU backend (not the WebGL 2 fallback).
	'Twisted box (WGSL)': {
		bounds: 1,
		sdf: /* wgsl */`
			fn dist( p: vec3<f32> ) -> f32 {
				let a = 2.5 * p.y;
				let q = vec3<f32>( cos( a ) * p.x - sin( a ) * p.z, p.y, sin( a ) * p.x + cos( a ) * p.z );
				return 0.7 * roundBox( q, vec3<f32>( 0.3, 0.7, 0.3 ), 0.05 );
			}

			fn roundBox( p: vec3<f32>, b: vec3<f32>, r: f32 ) -> f32 {
				let q = abs( p ) - b;
				return length( max( q, vec3<f32>( 0.0 ) ) ) + min( max( q.x, max( q.y, q.z ) ), 0.0 ) - r;
			}
		`
	}

};
