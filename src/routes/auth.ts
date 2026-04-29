import express from 'express';
import { forgot, getMe, login, logout, refresh, register, reset, updateMyTheme } from '../controllers/auth.controller.ts';
import { requireAuth } from '../middlewares/require-auth.ts';
import { requireActive } from '../middlewares/require-active.ts';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', requireAuth, logout);
router.post('/forgot-password', forgot);
router.post('/reset-password', reset);
router.get('/me', requireAuth, getMe);
router.patch('/me/theme', requireAuth, requireActive, updateMyTheme);

export default router;
