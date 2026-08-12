const { execFileSync } = require('node:child_process');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const input = path.join(root, 'docs/database/viralco.dbml');
const svg = path.join(root, 'docs/database/diagrama-uml-final.svg');
const png = path.resolve(root, '../../diagrama uml final.png');

execFileSync(path.join(root, 'node_modules/.bin/dbml-renderer'), ['-i', input, '-o', svg], { stdio: 'inherit' });

sharp(svg, { density: 72, limitInputPixels: false })
  .flatten({ background: '#ffffff' })
  .resize({ width: 3000, withoutEnlargement: true })
  .png({ compressionLevel: 9 })
  .toFile(png)
  .then(() => console.log(`Diagrama generado: ${png}`));
