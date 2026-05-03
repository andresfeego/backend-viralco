import express from 'express';
import {
  getEvent,
  getEvents,
  getOverlays,
  patchEvent,
  patchEventBranding,
  patchOverlay,
  postEvent,
  postOverlay,
} from '../controllers/events.controller.ts';
import { requireActive } from '../middlewares/require-active.ts';
import { requireAuth } from '../middlewares/require-auth.ts';
import { requireAnyRole } from '../middlewares/require-any-role.ts';

const router = express.Router();

router.get('/', requireAuth, requireActive, getEvents);
router.get('/:id', requireAuth, requireActive, getEvent);

router.post('/', requireAuth, requireAnyRole(['admin', 'super_admin']), postEvent);
router.patch('/:id', requireAuth, requireAnyRole(['admin', 'super_admin']), patchEvent);
router.patch('/:id/branding', requireAuth, requireAnyRole(['admin', 'super_admin']), patchEventBranding);

router.get('/:id/overlays', requireAuth, requireActive, getOverlays);
router.post('/:id/overlays', requireAuth, requireAnyRole(['admin', 'super_admin']), postOverlay);
router.patch('/:id/overlays/:overlayId', requireAuth, requireAnyRole(['admin', 'super_admin']), patchOverlay);

export default router;
