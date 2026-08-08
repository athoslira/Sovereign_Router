import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repository = 'athoslira/Sovereign_Router';
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
	headers: { 'User-Agent': 'Sovereign-Router-release-check' },
});

assert.equal(response.ok, true, `Could not read the latest GitHub release: ${response.status}`);
const release = await response.json();
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));

assert.equal(release.tag_name, manifest.version, 'Latest release tag must match manifest.json version');
for (const filename of ['manifest.json', 'main.js', 'styles.css']) {
	const asset = assets.get(filename);
	assert.ok(asset, `Latest release must include ${filename} for BRAT`);
	const assetResponse = await fetch(asset.browser_download_url);
	assert.equal(assetResponse.ok, true, `Could not download release asset ${filename}`);
	assert.deepEqual(
		Buffer.from(await assetResponse.arrayBuffer()),
		await readFile(new URL(`../${filename}`, import.meta.url)),
		`Release asset ${filename} must match the local build output`,
	);
}

console.log(`✓ latest release ${release.tag_name} includes the BRAT artifacts`);
