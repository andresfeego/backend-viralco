import express from 'express';
import { deleteResource, getEvent, getModes, getResources, getTypes, patchEvent, patchEventBranding, patchResource, postResource } from '../controllers/events.controller.ts';
import { requireActive } from '../middlewares/require-active.ts';
import { requireAuth } from '../middlewares/require-auth.ts';
import { getConfig, getPublished, patchSession, postEndSession, postPublish, postSession, postValidate, putConfig } from '../controllers/magic-mirror.controller.ts';

const router = express.Router();
router.use(requireAuth, requireActive);

router.get('/types', getTypes);
router.get('/modes', getModes);
router.get('/:id/modes/:eventModeId/config', getConfig);
router.put('/:id/modes/:eventModeId/config', putConfig);
router.post('/:id/modes/:eventModeId/config/validate', postValidate);
router.post('/:id/modes/:eventModeId/config/publish', postPublish);
router.get('/:id/modes/:eventModeId/config/published', getPublished);
router.post('/:id/modes/:eventModeId/sessions', postSession);
router.patch('/:id/modes/:eventModeId/sessions/:sessionId', patchSession);
router.post('/:id/modes/:eventModeId/sessions/:sessionId/end', postEndSession);
router.get('/:id', getEvent);
router.patch('/:id', patchEvent);
router.patch('/:id/branding', patchEventBranding);
router.get('/:id/resources', getResources);
router.post('/:id/resources', postResource);
router.patch('/:id/resources/:resourceId', patchResource);
router.delete('/:id/resources/:resourceId', deleteResource);

export default router;
