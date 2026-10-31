import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Vector3 } from 'three/webgpu';
import { Fn, dot, exp, length, vec2 } from 'three/tsl';

import { componentCount, createGenerator, dot3, length3, maxAbsDifference, signedVolume, sub3, vertices } from './setup.mjs';
import { pointDensity } from '../examples/pointDensity.js';
import { densityPresets } from '../examples/densityPresets.js';

const generator = await createGenerator();

const RES = 64;
const CELL = 2 / RES;

// A Gaussian blob: equals 0.5 on a sphere of radius SIGMA * sqrt( 2 ln 2 ).

const SIGMA = 0.3;
const RADIUS = SIGMA * Math.sqrt( 2 * Math.LN2 );
const SPHERE_VOLUME = 4 / 3 * Math.PI * RADIUS ** 3;
const gaussian = ( p ) => exp( dot( p, p ).mul( - 1 / ( 2 * SIGMA * SIGMA ) ) );

const torus = Fn( ( [ p ] ) => length( vec2( length( p.xz ).sub( 0.6 ), p.y ) ).sub( 0.2 ) );

// Largest deviation of the vertices from a sphere, and the smallest cosine
// between vertex normals and the radial direction.

function sphereFit( geometry, center, radius ) {

	let radiusError = 0, minCosine = 1;

	for ( const { p, n } of vertices( geometry ) ) {

		const d = sub3( p, center );
		const r = length3( d );

		radiusError = Math.max( radiusError, Math.abs( r - radius ) );
		minCosine = Math.min( minCosine, dot3( n, d ) / r );

	}

	return { radiusError, minCosine };

}

test( 'inside: above meshes a density level set with outward normals', async () => {

	const geometry = await generator.generate( RES, gaussian, 1, { level: 0.5, inside: 'above' } );
	const { radiusError, minCosine } = sphereFit( geometry, [ 0, 0, 0 ], RADIUS );

	assert.ok( geometry.attributes.position.count > 1000 );
	assert.ok( radiusError < 0.25 * CELL, `radius error ${ radiusError }` );
	assert.ok( minCosine > 0.95, `normals not outward: ${ minCosine }` );

	const volume = signedVolume( geometry );
	assert.ok( Math.abs( volume / SPHERE_VOLUME - 1 ) < 0.03, `volume ${ volume }, expected ${ SPHERE_VOLUME }` );

} );

test( 'inside: below keeps the low side, capped at the bounds', async () => {

	const geometry = await generator.generate( RES, gaussian, 1, { level: 0.5 } );

	// The cavity around the blob faces inwards; the rest of the mesh is the cube's cap.

	let cavityVertices = 0, maxCosine = - 1;

	for ( const { p, n } of vertices( geometry ) ) {

		const r = length3( p );
		if ( r > 2 * RADIUS ) continue;

		cavityVertices ++;
		maxCosine = Math.max( maxCosine, dot3( n, p ) / r );

	}

	assert.ok( cavityVertices > 1000 );
	assert.ok( maxCosine < - 0.95, `cavity normals not inward: ${ maxCosine }` );

	const volume = signedVolume( geometry );
	const expected = 8 - SPHERE_VOLUME;
	assert.ok( Math.abs( volume / expected - 1 ) < 0.01, `volume ${ volume }, expected ${ expected }` );

} );

test( 'level 0 and inside: below are the defaults', async () => {

	const a = await generator.generate( 48, torus, 1 );
	const b = await generator.generate( 48, torus, 1, { level: 0, inside: 'below' } );

	assert.ok( a.index.count > 0 );
	assert.deepEqual( b.attributes.position.array, a.attributes.position.array );
	assert.deepEqual( b.attributes.normal.array, a.attributes.normal.array );
	assert.deepEqual( b.index.array, a.index.array );

} );

test( 'negating the field and flipping inside gives the same mesh', async () => {

	const a = await generator.generate( 48, torus, 1 );
	const b = await generator.generate( 48, ( p ) => torus( p ).negate(), 1, { inside: 'above' } );

	assert.deepEqual( b.attributes.position.array, a.attributes.position.array );
	assert.deepEqual( b.attributes.normal.array, a.attributes.normal.array );
	assert.deepEqual( b.index.array, a.index.array );

} );

test( 'level shifts the field', async () => {

	const a = await generator.generate( 48, torus, 1 );
	const b = await generator.generate( 48, ( p ) => torus( p ).add( 0.1 ), 1, { level: 0.1 } );

	assert.equal( b.attributes.position.count, a.attributes.position.count );
	assert.ok( maxAbsDifference( b.attributes.position.array, a.attributes.position.array ) < 1e-5 );
	assert.deepEqual( b.index.array, a.index.array );

} );

test( 'invalid level and inside options are rejected', async () => {

	await assert.rejects( generator.generate( 16, gaussian, 1, { level: NaN } ), /level must be a finite number/ );
	await assert.rejects( generator.generate( 16, gaussian, 1, { level: Infinity } ), /level must be a finite number/ );
	await assert.rejects( generator.generate( 16, gaussian, 1, { inside: 'outside' } ), /inside must be 'below' or 'above'/ );

} );

test( 'WGSL strings may define fn field()', async () => {

	const wgslGaussian = /* wgsl */`
		fn field( p: vec3<f32> ) -> f32 { return exp( - dot( p, p ) / ( 2.0 * ${ SIGMA * SIGMA } ) ); }
	`;

	const a = await generator.generate( RES, gaussian, 1, { level: 0.5, inside: 'above' } );
	const b = await generator.generate( RES, wgslGaussian, 1, { level: 0.5, inside: 'above' } );

	assert.equal( b.attributes.position.count, a.attributes.position.count );
	assert.ok( maxAbsDifference( b.attributes.position.array, a.attributes.position.array ) < 1e-4 );

} );

test( 'WGSL fn dist() takes precedence over a helper named field()', async () => {

	const source = /* wgsl */`
		fn dist( p: vec3<f32> ) -> f32 { return field( p ) - 0.5; }
		fn field( p: vec3<f32> ) -> f32 { return length( p ); }
	`;

	const geometry = await generator.generate( RES, source, 1 );
	const { radiusError } = sphereFit( geometry, [ 0, 0, 0 ], 0.5 );

	assert.ok( geometry.attributes.position.count > 1000 );
	assert.ok( radiusError < 0.25 * CELL, `radius error ${ radiusError }` );

} );

test( 'WGSL and GLSL strings without an entry point are rejected', async () => {

	await assert.rejects( generator.generate( 16, 'fn density( p: vec3<f32> ) -> f32 { return 0.0; }', 1 ), /must define fn dist\( p: vec3<f32> \) -> f32 or fn field\( p: vec3<f32> \) -> f32/ );
	await assert.rejects( generator.generate( 16, 'float field( vec3 p ) { return 0.0; }', 1 ), /GLSL distance functions are not supported/ );

} );

test( 'pointDensity: an isolated point gives the analytic sphere', async () => {

	const center = [ 0.2, - 0.1, 0.15 ];
	const radius = 0.15, level = 0.3;
	const density = pointDensity( [ new Vector3( ...center ) ], { radius } );

	const geometry = await generator.generate( RES, density, 1, { level, inside: 'above' } );
	const { radiusError, minCosine } = sphereFit( geometry, center, radius * Math.sqrt( - 2 * Math.log( level ) ) );

	assert.ok( geometry.attributes.position.count > 500 );
	assert.ok( radiusError < 0.25 * CELL, `radius error ${ radiusError }` );
	assert.ok( minCosine > 0.95, `normals not outward: ${ minCosine }` );

} );

test( 'pointDensity: per-point radii and separate blobs', async () => {

	const centers = [ [ - 0.5, 0, 0 ], [ 0.5, 0, 0 ] ];
	const radii = [ 0.1, 0.15 ];
	const level = 0.5;
	const density = pointDensity( centers.map( ( c ) => new Vector3( ...c ) ), { radius: ( point, i ) => radii[ i ] } );

	const geometry = await generator.generate( RES, density, 1, { level, inside: 'above' } );

	assert.equal( componentCount( geometry ), 2 );

	let radiusError = 0;

	for ( const { p } of vertices( geometry ) ) {

		const i = p[ 0 ] < 0 ? 0 : 1;
		const expected = radii[ i ] * Math.sqrt( - 2 * Math.log( level ) );
		radiusError = Math.max( radiusError, Math.abs( length3( sub3( p, centers[ i ] ) ) - expected ) );

	}

	assert.ok( radiusError < 0.25 * CELL, `radius error ${ radiusError }` );

} );

test( 'pointDensity: argument checks', () => {

	assert.throws( () => pointDensity( [] ), /no points given/ );
	assert.throws( () => pointDensity( Array.from( { length: 4097 }, () => new Vector3() ) ), /4097 points exceed the 4096/ );
	assert.throws( () => pointDensity( [ new Vector3() ], { radius: 0 } ), /radius must be a positive number/ );

} );

test( 'density presets produce closed, finite meshes at their default level', async () => {

	for ( const [ name, preset ] of Object.entries( densityPresets ) ) {

		const { field, bounds, level, levelRange } = preset();
		const geometry = await generator.generate( 48, field, bounds, { level, inside: 'above' } );

		assert.ok( level >= levelRange[ 0 ] && level <= levelRange[ 1 ], name );
		assert.ok( geometry.index.count > 0, `${ name }: empty mesh` );
		assert.ok( geometry.attributes.position.array.every( Number.isFinite ), `${ name }: non-finite positions` );
		assert.ok( signedVolume( geometry ) > 0, `${ name }: inside-out mesh` );

	}

} );

test( 'hydrogen orbital: lobes and torus separate, torus vanishes above 0.25', async () => {

	const { field, bounds } = densityPresets[ 'Hydrogen 3d orbital' ]();

	const low = await generator.generate( RES, field, bounds, { level: 0.05, inside: 'above' } );
	const high = await generator.generate( RES, field, bounds, { level: 0.5, inside: 'above' } );

	assert.equal( componentCount( low ), 3 );
	assert.equal( componentCount( high ), 2 );

} );
