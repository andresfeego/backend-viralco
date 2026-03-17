import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import express from 'express';
import { r2 } from '../r2.ts';

const router = express.Router();

router.post('/', async (req, res) => {
  const { fileType } = req.body;

  if (!fileType) {
    return res.status(400).json({ error: 'File type is required' });
  }

  const slug = crypto.randomUUID();

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: slug,
    ContentType: fileType,
  });

  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 60 });
  const url = `${process.env.R2_BUCKET_PATH}/${slug}`;

  return res.status(200).json({ signedUrl, url });
});

export default router;
