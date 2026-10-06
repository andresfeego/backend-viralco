import express from 'express';
import multer from 'multer';
import { assertEventAccess } from '../services/event-access.service.ts';
import { parseEntityId } from '../lib/ids.ts';
import { sendApiError } from '../lib/api-error.ts';
import { getAccountLibrary, getAccountPhotoLayoutTemplate, getAccountPrintProfile, patchAccountLibraryFavorite, postAccountLibraryAsset, postAccountLibraryClone, postAccountLibraryEntry, postAccountLibraryImageUpload, postAccountLibraryUpload, postAccountPhotoLayoutTemplate, postAccountPrintProfile } from '../controllers/library.controller.ts';

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const scoped = (handler: any) => async (req: any, res: any) => {
  try {
    const eventId = parseEntityId(req.params.id);
    const event = await assertEventAccess(eventId, req.authUser, req.method === 'GET' ? 'read' : 'write', 'events.resources.manage');
    req.params.accountId = String(event.accountId);
    req.authUser = { ...req.authUser, libraryEventId: String(eventId) };
    return handler(req, res);
  } catch (error) { sendApiError(req, res, error, 'No se pudo acceder a los recursos del evento'); }
};
router.get('/', scoped(getAccountLibrary));
router.post('/uploads', scoped(postAccountLibraryUpload));
router.post('/image-upload', upload.single('file'), scoped(postAccountLibraryImageUpload));
router.post('/assets', scoped(postAccountLibraryAsset));
router.post('/layout-templates', scoped(postAccountPhotoLayoutTemplate));
router.get('/:libraryAssetId/layout-template', scoped(getAccountPhotoLayoutTemplate));
router.post('/print-profiles', scoped(postAccountPrintProfile));
router.get('/:libraryAssetId/print-profile', scoped(getAccountPrintProfile));
router.post('/', scoped(postAccountLibraryEntry));
router.post('/:libraryAssetId/clone', scoped(postAccountLibraryClone));
router.patch('/:libraryAssetId/favorite', scoped(patchAccountLibraryFavorite));
export default router;
