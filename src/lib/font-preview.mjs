import * as fontkit from 'fontkit';
import sharp from 'sharp';

const PREVIEW_TEXT = 'Tu evento';
const PREVIEW_SIZES = [
  { variant: 'thumb', size: 160 },
  { variant: 'card', size: 512 },
];

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

export async function renderFontPreviewVariants(buffer) {
  const font = fontkit.create(buffer);
  if (!font?.familyName) throw new Error('Archivo de fuente invalido');
  const encoded = buffer.toString('base64');
  const variants = await Promise.all(PREVIEW_SIZES.map(async ({ variant, size }) => {
    const fontSize = Math.round(size * 0.22);
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <defs><style>
          @font-face { font-family: 'ViralCoPreview'; src: url(data:font/ttf;base64,${encoded}); }
        </style></defs>
        <rect width="${size}" height="${size}" rx="${Math.round(size * 0.08)}" fill="#f7f9fc"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
          font-family="ViralCoPreview" font-size="${fontSize}" fill="#0b1320">${escapeXml(PREVIEW_TEXT)}</text>
      </svg>
    `);
    const rendered = await sharp(svg).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
    return { variant, buffer: rendered.data, width: rendered.info.width, height: rendered.info.height, sizeBytes: rendered.info.size };
  }));
  return {
    metadata: {
      familyName: font.familyName,
      fullName: font.fullName || font.familyName,
      postscriptName: font.postscriptName || null,
      previewText: PREVIEW_TEXT,
    },
    variants,
  };
}
