import express from 'express';
import { postGlobalLibraryAsset, postGlobalLibraryUpload } from '../controllers/library.controller.ts';
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

const router = express.Router();

router.post('/confirm-password', requireAuth, requireRole('super_admin'), confirmSuperAdminPassword);
router.get('/users', requireAuth, requireRole('super_admin'), getUsers);
router.get('/bitacora', requireAuth, requireRole('super_admin'), getBitacora);
router.post('/users', requireAuth, requireRole('super_admin'), createAdmin);
router.patch('/users/:id/status', requireAuth, requireRole('super_admin'), patchUserStatus);
router.post('/accounts', requireAuth, requireRole('super_admin'), postAccount);
router.patch('/accounts/:accountId/status', requireAuth, requireRole('super_admin'), patchAccountStatus);
router.post('/library/assets/uploads', requireAuth, requireRole('super_admin'), postGlobalLibraryUpload);
router.post('/library/assets', requireAuth, requireRole('super_admin'), postGlobalLibraryAsset);
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
