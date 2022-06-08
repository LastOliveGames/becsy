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

execSync(`yarn version --new-version ${version} --no-git-tag-version`);
execSync(`git commit -m "Release ${version}" package.json CHANGELOG.md`);
execSync(`git tag -a v${version} -m v${version}`);
execSync(`git push`);
execSync(`yarn publish --new-version version`);

console.log('Released!');
