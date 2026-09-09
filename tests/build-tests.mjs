import esbuild from 'esbuild';

await esbuild.build({
	entryPoints: ['tests/run-tests.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node18',
	outfile: 'tests/compiled/run-tests.cjs',
	logLevel: 'silent',
});

await import('./compiled/run-tests.cjs');
