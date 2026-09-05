const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 18) {
  throw new Error(`Burnhop requires Node >=22.18 <23; received ${process.version}. Run nvm use.`);
}
