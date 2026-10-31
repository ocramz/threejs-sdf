// Headless WebGPU for the tests: Dawn (via the `webgpu` package) behind a
// WebGPURenderer with a stub canvas. The tests only dispatch compute shaders,
// so the canvas context is never created and no frame is presented.

import { create, globals } from 'webgpu';

Object.assign( globalThis, globals );

if ( typeof globalThis.navigator === 'undefined' ) globalThis.navigator = {};
Object.defineProperty( globalThis.navigator, 'gpu', { value: create( [] ), configurable: true } );

// init() starts three's animation loop, which schedules frames on `self`. The
// tests never render, so the scheduler simply never fires.
globalThis.self ??= { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };

const { WebGPURenderer } = await import( 'three/webgpu' );
const { SDFGeometryGenerator } = await import( '../src/SDFGeometryGenerator.js' );

let _renderer = null;

export async function getRenderer() {

	if ( _renderer === null ) {

		const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {} };
		_renderer = new WebGPURenderer( { canvas } );
		await _renderer.init();

		if ( _renderer.backend.isWebGPUBackend !== true ) throw new Error( 'test setup: no WebGPU adapter available.' );

	}

	return _renderer;

}

export async function createGenerator() {

	return new SDFGeometryGenerator( await getRenderer() );

}

// Geometry helpers

export function vertices( geometry ) {

	const position = geometry.attributes.position.array;
	const normal = geometry.attributes.normal.array;
	const list = [];

	for ( let i = 0; i < position.length; i += 3 ) {

		list.push( {
			p: [ position[ i ], position[ i + 1 ], position[ i + 2 ] ],
			n: [ normal[ i ], normal[ i + 1 ], normal[ i + 2 ] ]
		} );

	}

	return list;

}

// Named with a 3 suffix so they don't clash with the TSL functions in the tests.

export const sub3 = ( a, b ) => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
export const dot3 = ( a, b ) => a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];
export const length3 = ( a ) => Math.sqrt( dot3( a, a ) );

// Volume enclosed by the indexed triangles (positive for outward winding).

export function signedVolume( geometry ) {

	const p = geometry.attributes.position.array;
	const index = geometry.index.array;
	let volume = 0;

	for ( let i = 0; i < index.length; i += 3 ) {

		const a = index[ i ] * 3, b = index[ i + 1 ] * 3, c = index[ i + 2 ] * 3;

		volume += p[ a ] * ( p[ b + 1 ] * p[ c + 2 ] - p[ b + 2 ] * p[ c + 1 ] ) +
			p[ a + 1 ] * ( p[ b + 2 ] * p[ c ] - p[ b ] * p[ c + 2 ] ) +
			p[ a + 2 ] * ( p[ b ] * p[ c + 1 ] - p[ b + 1 ] * p[ c ] );

	}

	return volume / 6;

}

// Number of connected pieces of the mesh (vertices joined by triangles).

export function componentCount( geometry ) {

	const parent = Int32Array.from( { length: geometry.attributes.position.count }, ( _, i ) => i );
	const find = ( i ) => {

		while ( parent[ i ] !== i ) i = parent[ i ] = parent[ parent[ i ] ];
		return i;

	};

	const index = geometry.index.array;

	for ( let i = 0; i < index.length; i += 3 ) {

		const a = find( index[ i ] );
		parent[ find( index[ i + 1 ] ) ] = a;
		parent[ find( index[ i + 2 ] ) ] = a;

	}

	let count = 0;
	for ( let i = 0; i < parent.length; i ++ ) if ( find( i ) === i ) count ++;

	return count;

}

export function maxAbsDifference( a, b ) {

	if ( a.length !== b.length ) return Infinity;

	let max = 0;
	for ( let i = 0; i < a.length; i ++ ) max = Math.max( max, Math.abs( a[ i ] - b[ i ] ) );

	return max;

}
