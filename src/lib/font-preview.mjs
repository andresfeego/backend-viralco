import * as fontkit from 'fontkit';
import sharp from 'sharp';

const PREVIEW_TEXT = 'Tu evento';
const PREVIEW_RENDERER_VERSION = 4;
const PREVIEW_SIZES = [
  { variant: 'thumb', size: 160 },
  { variant: 'card', size: 512 },
];

function renderGlyphPaths(font, text, size) {
  const run = font.layout(text);
  const advanceWidth = run.positions.reduce((total, position) => total + position.xAdvance, 0);
  const fontHeight = font.ascent - font.descent;
  const scale = Math.min((size * 0.84) / advanceWidth, (size * 0.3) / fontHeight);
  const baseline = (size / 2) + (((font.ascent + font.descent) * scale) / 2);
  let cursor = (size - (advanceWidth * scale)) / 2;
  return run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const x = cursor + (position.xOffset * scale);
    const y = baseline - (position.yOffset * scale);
    cursor += position.xAdvance * scale;
    return `<path d="${glyph.path.toSVG()}" transform="translate(${x} ${y}) scale(${scale} ${-scale})"/>`;
  }).join('');
}

export async function renderFontPreviewVariants(buffer) {
  const font = fontkit.create(buffer);
  if (!font?.familyName) throw new Error('Archivo de fuente invalido');
  const variants = await Promise.all(PREVIEW_SIZES.map(async ({ variant, size }) => {
    const glyphPaths = renderGlyphPaths(font, PREVIEW_TEXT, size);
    const svg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <rect width="${size}" height="${size}" fill="#f7f9fc"/>
        <g fill="#0b1320">${glyphPaths}</g>
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
      previewRendererVersion: PREVIEW_RENDERER_VERSION,
    },
    variants,
  };
}
