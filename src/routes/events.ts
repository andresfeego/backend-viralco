import express from 'express';
import { deleteResource, getEvent, getResources, getTypes, patchEvent, patchEventBranding, patchResource, postResource } from '../controllers/events.controller.ts';
import { requireActive } from '../middlewares/require-active.ts';
import { requireAuth } from '../middlewares/require-auth.ts';

const router = express.Router();
router.use(requireAuth, requireActive);

router.get('/types', getTypes);
router.get('/modes', getTypes);
router.get('/:id', getEvent);
router.patch('/:id', patchEvent);
router.patch('/:id/branding', patchEventBranding);
router.get('/:id/resources', getResources);
router.post('/:id/resources', postResource);
router.patch('/:id/resources/:resourceId', patchResource);
router.delete('/:id/resources/:resourceId', deleteResource);

export default router;
