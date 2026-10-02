import {readFileSync, writeFileSync} from 'fs';
import {execSync} from 'child_process';

const version = process.argv[2];
if (!version) {
  console.error('No version specified, aborting');
  process.exit(1);
}

console.log(`Releasing version ${version}`);

let changelog = readFileSync('CHANGELOG.md', {encoding: 'utf8'});
changelog = changelog.replace('### Upcoming\n', `### Upcoming\n\n### ${version}\n`);
writeFileSync('CHANGELOG.md', changelog);

execSync(`yarn version ${version} --immediate`);
execSync(`git commit -m "Release ${version}" package.json CHANGELOG.md`);
execSync(`git tag -a v${version} -m v${version}`);
execSync('git push --follow-tags');
execSync('yarn npm publish --access public --tag latest');

console.log('Released!');
