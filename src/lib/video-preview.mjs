import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

const PREVIEW_SIZES = [
  { variant: 'thumb', size: 160 },
  { variant: 'card', size: 512 },
];

export async function renderVideoPreviewVariants(buffer) {
  if (!ffmpegPath) throw new Error('FFmpeg no disponible');
  const directory = mkdtempSync(join(tmpdir(), 'viralco-video-preview-'));
  const sourcePath = join(directory, 'source-video');
  try {
    writeFileSync(sourcePath, buffer);
    let poster = null;
    for (const seek of ['0.5', '0']) {
      const result = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-ss', seek, '-i', sourcePath,
        '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
      ], { encoding: null, maxBuffer: 50 * 1024 * 1024 });
      if (result.status === 0 && result.stdout?.length) {
        poster = result.stdout;
        break;
      }
    }
    if (!poster) throw new Error('El video no contiene un fotograma utilizable');
    const sourceMetadata = await sharp(poster).metadata();
    const variants = await Promise.all(PREVIEW_SIZES.map(async ({ variant, size }) => {
      const rendered = await sharp(poster).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      return { variant, buffer: rendered.data, width: rendered.info.width, height: rendered.info.height, sizeBytes: rendered.info.size };
    }));
    return {
      metadata: {
        width: sourceMetadata.width || null,
        height: sourceMetadata.height || null,
        aspectRatio: sourceMetadata.width && sourceMetadata.height ? sourceMetadata.width / sourceMetadata.height : null,
      },
      variants,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
