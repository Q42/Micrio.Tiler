// Install all available Sharp platform binaries

const spawn = require('node:child_process');

[
	['x64', 'darwin'],
	['arm64', 'darwin'],
	['x64', 'linux'],
	['x64', 'linux', '--libc=musl'],
	['arm64', 'linux'],
	['arm64', 'linux', '--libc=musl'],
	['arm', 'linux'],
	['x64', 'win32'],
	['x86', 'win32'],
].forEach(
	p => spawn.execSync(`npm i --cpu=${p[0]} --os=${p[1]}${p[2] ? ' '+p[2]:''} sharp`)
);

console.log('Installed all Sharp libvips binaries under ./node_modules/@img/');
console.log('NEXT STEP: copy ./node_modules/@img to ../bin/@img and remove the ones in the node_packages folder that are irrelevant for your platform.');
