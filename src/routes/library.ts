import express from 'express';
import { getLibraryAssets } from '../controllers/library.controller.ts';
import { requireActive } from '../middlewares/require-active.ts';
import { requireAuth } from '../middlewares/require-auth.ts';

const router = express.Router();
router.use(requireAuth, requireActive);
router.get('/assets', getLibraryAssets);
export default router;
