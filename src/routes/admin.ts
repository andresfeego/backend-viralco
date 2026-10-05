import express from 'express';
import multer from 'multer';
import { postGlobalLibraryAsset, postGlobalLibraryImageUpload, postGlobalLibraryUpload, postGlobalPhotoLayoutTemplate, postGlobalPrintProfile } from '../controllers/library.controller.ts';
import {
  createAdmin,
  activate,
  confirmSuperAdminPassword,
  deactivate,
  getBitacora,
  getUsers,
  patchUserStatus,
  patchAccountStatus,
  postAccount,
} from '../controllers/admin.controller.ts';
import { requireAuth } from '../middlewares/require-auth.ts';
import { requireRole } from '../middlewares/require-role.ts';
import { savePrintGuide } from '../services/print-guide.service.ts';
import { sendApiError } from '../lib/api-error.ts';

const router = express.Router();
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

router.post('/confirm-password', requireAuth, requireRole('super_admin'), confirmSuperAdminPassword);
router.get('/users', requireAuth, requireRole('super_admin'), getUsers);
router.get('/bitacora', requireAuth, requireRole('super_admin'), getBitacora);
router.post('/users', requireAuth, requireRole('super_admin'), createAdmin);
router.patch('/users/:id/status', requireAuth, requireRole('super_admin'), patchUserStatus);
router.post('/accounts', requireAuth, requireRole('super_admin'), postAccount);
router.patch('/accounts/:accountId/status', requireAuth, requireRole('super_admin'), patchAccountStatus);
router.post('/library/assets/uploads', requireAuth, requireRole('super_admin'), postGlobalLibraryUpload);
router.post('/library/image-upload', requireAuth, requireRole('super_admin'), uploadImage.single('file'), postGlobalLibraryImageUpload);
router.post('/library/assets', requireAuth, requireRole('super_admin'), postGlobalLibraryAsset);
router.post('/library/layout-templates', requireAuth, requireRole('super_admin'), postGlobalPhotoLayoutTemplate);
router.post('/library/print-profiles', requireAuth, requireRole('super_admin'), postGlobalPrintProfile);
router.post('/library/print-profiles/:id/guide', requireAuth, requireRole('super_admin'), uploadImage.single('file'), async (req: any, res: any) => {
  try {
    let input;
    try { input = JSON.parse(req.body.guide || '{}'); } catch { return res.status(400).json({ error: 'Guia invalida' }); }
    res.json({ guide: await savePrintGuide(req.params.id, input, req.file, req.authUser) });
  } catch (error) { sendApiError(req, res, error, 'No se pudo guardar la guia'); }
});
router.patch(
  '/users/:id/activate',
  requireAuth,
  requireRole('super_admin'),
  activate
);
router.patch(
  '/users/:id/deactivate',
  requireAuth,
  requireRole('super_admin'),
  deactivate
);

export default router;
