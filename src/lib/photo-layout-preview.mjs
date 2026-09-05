import sharp from 'sharp';

export const PHOTO_LAYOUT_PREVIEW_SIZES = [
  { variant: 'thumb', size: 160 },
  { variant: 'card', size: 512 },
];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

export function photoLayoutPreviewSvg(template, size) {
  const margin = Math.max(8, Math.round(size * 0.065));
  const available = size - margin * 2;
  const ratio = template.output.width / template.output.height;
  const canvasWidth = ratio >= 1 ? available : available * ratio;
  const canvasHeight = ratio >= 1 ? available / ratio : available;
  const originX = (size - canvasWidth) / 2;
  const originY = (size - canvasHeight) / 2;
  const stroke = Math.max(1, Math.round(size / 160));
  const order = Array.isArray(template.order) ? template.order : [];
  const renderSlots = (copyOriginX, copyWidth, copyKey = '') => template.slots.map((slot) => {
    const x = copyOriginX + copyWidth * slot.x / 100;
    const y = originY + canvasHeight * slot.y / 100;
    const width = copyWidth * slot.width / 100;
    const height = canvasHeight * slot.height / 100;
    const captureNumber = Math.max(1, order.indexOf(slot.photoNumber) + 1);
    const fontSize = Math.max(10, Math.min(width, height) * 0.32);
    const rotation = Number(slot.rotation || 0);
    return `<g data-copy="${copyKey}" transform="rotate(${rotation} ${x + width / 2} ${y + height / 2})"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${stroke * 2}" fill="#dbe9ff" stroke="#1d4ed8" stroke-width="${stroke}"/><text x="${x + width / 2}" y="${y + height / 2}" dominant-baseline="central" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#0c4db4">${escapeXml(captureNumber)}</text></g>`;
  }).join('');
  const slots = template.duplicateStrip
    ? renderSlots(originX, canvasWidth / 2, 'left') + renderSlots(originX + canvasWidth / 2, canvasWidth / 2, 'right')
    : renderSlots(originX, canvasWidth);
  const duplicate = template.duplicateStrip
    ? `<path d="M ${originX + canvasWidth / 2} ${originY} V ${originY + canvasHeight}" stroke="#9aa8bd" stroke-width="${stroke}" stroke-dasharray="${stroke * 3} ${stroke * 2}" opacity="0.8"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#f7f9fc"/><rect x="${originX}" y="${originY}" width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff" stroke="#c9d3e1" stroke-width="${stroke}"/>${slots}${duplicate}</svg>`;
}

export async function renderPhotoLayoutTemplateVariants(template) {
  return Promise.all(PHOTO_LAYOUT_PREVIEW_SIZES.map(async ({ variant, size }) => {
    const rendered = await sharp(Buffer.from(photoLayoutPreviewSvg(template, size)))
      .webp({ quality: 88, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { variant, buffer: rendered.data, width: rendered.info.width, height: rendered.info.height, sizeBytes: rendered.info.size };
  }));
}
