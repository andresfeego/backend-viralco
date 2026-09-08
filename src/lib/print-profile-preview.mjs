import sharp from 'sharp';

const escapeXml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

export async function renderPrintProfileVariants(profile) {
  const title = escapeXml(`${profile.manufacturer} ${profile.model}`);
  const paper = escapeXml(`${profile.paper.widthMm} × ${profile.paper.heightMm} mm`);
  const detail = escapeXml(`${profile.output.dpi} DPI · ${profile.output.fit}`);
  return Promise.all([{ variant: 'thumb', size: 160 }, { variant: 'card', size: 512 }].map(async ({ variant, size }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" rx="32" fill="#eef2ff"/><rect x="112" y="82" width="288" height="220" rx="24" fill="#1e293b"/><rect x="148" y="38" width="216" height="132" rx="12" fill="#ffffff" stroke="#2563eb" stroke-width="8"/><rect x="146" y="250" width="220" height="154" rx="10" fill="#ffffff" stroke="#2563eb" stroke-width="8"/><circle cx="350" cy="202" r="14" fill="#22c55e"/><text x="256" y="438" text-anchor="middle" font-family="Arial, sans-serif" font-size="29" font-weight="700" fill="#0f172a">${title}</text><text x="256" y="471" text-anchor="middle" font-family="Arial, sans-serif" font-size="23" fill="#334155">${paper}</text><text x="256" y="498" text-anchor="middle" font-family="Arial, sans-serif" font-size="19" fill="#475569">${detail}</text></svg>`;
    const buffer = await sharp(Buffer.from(svg)).webp({ quality: 84 }).toBuffer();
    return { variant, buffer, width: size, height: size, sizeBytes: buffer.byteLength };
  }));
}
