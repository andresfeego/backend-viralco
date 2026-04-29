import express from 'express';
import { myPermissions } from '../controllers/permissions.controller.ts';
import { requireAuth } from '../middlewares/require-auth.ts';
import { requireActive } from '../middlewares/require-active.ts';

const router = express.Router();

router.get('/me', requireAuth, requireActive, myPermissions);

export default router;
