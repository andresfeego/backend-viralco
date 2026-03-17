import express from 'express';
import { db } from '../db/index.ts';
import { postTable } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { r2 } from '../r2.ts';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import path from 'node:path';

const router = express.Router();

router.get('/', async (_, res) => {
  const posts = await db.select().from(postTable);
  res.json(posts);
});

router.post('/', async (req, res) => {
  const { title, imageUrl, mediaType } = req.body;

  if (!title || !imageUrl) {
    res.status(400).json({ error: 'Title and image URL are required' });
    return;
  }

  const result = await db
    .insert(postTable)
    .values({ title, imageUrl, mediaType: mediaType ?? 'image' });

  const insertId = Number(result[0]?.insertId ?? 0);
  if (!insertId) {
    res.status(500).json({ error: 'Failed to create post' });
    return;
  }

  const [newPost] = await db
    .select()
    .from(postTable)
    .where(eq(postTable.id, insertId));

  res.status(201).json(newPost ?? { id: insertId, title, imageUrl, mediaType });
});

router.get('/:id/download', async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  if (Number.isNaN(postId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const [post] = await db
    .select()
    .from(postTable)
    .where(eq(postTable.id, postId));

  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const response = await fetch(post.imageUrl);
  if (!response.ok || !response.body) {
    res.status(502).json({ error: 'Failed to fetch file' });
    return;
  }

  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream';
  const contentLength = response.headers.get('content-length');
  const slug = post.imageUrl.split('/').pop() ?? 'file';
  const extFromType = (() => {
    const type = contentType.split(';')[0].trim().toLowerCase();
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/avif': '.avif',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
    };
    return map[type] ?? '';
  })();
  const hasExt = path.extname(slug) !== '';
  const filename = hasExt ? slug : `${slug}${extFromType || ''}`;

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/\"/g, '')}"`
  );
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  const nodeStream = Readable.fromWeb(response.body);
  nodeStream.pipe(res);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  const postId = parseInt(id, 10);
  if (Number.isNaN(postId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const [post] = await db
    .select()
    .from(postTable)
    .where(eq(postTable.id, postId));

  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  await db.delete(postTable).where(eq(postTable.id, postId));

  const slug = post.imageUrl!.split('/').pop();

  await r2.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: slug!,
    })
  );

  return res.status(200).json({ message: 'Post deleted successfully' });
});

export default router;
