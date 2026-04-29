import express from 'express';
import {
  createAdmin,
  activate,
  confirmSuperAdminPassword,
  deactivate,
  getBitacora,
  getUsers,
} from '../controllers/admin.controller.ts';
import { requireAuth } from '../middlewares/require-auth.ts';
import { requireRole } from '../middlewares/require-role.ts';

const router = express.Router();

router.post('/confirm-password', requireAuth, requireRole('super_admin'), confirmSuperAdminPassword);
router.get('/users', requireAuth, requireRole('super_admin'), getUsers);
router.get('/bitacora', requireAuth, requireRole('super_admin'), getBitacora);
router.post('/users', requireAuth, requireRole('super_admin'), createAdmin);
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
