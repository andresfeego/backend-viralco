import express from 'express';
import { getPublicAsset, postPublicDelivery } from '../controllers/mirror-runtime.controller.ts';

const router = express.Router();
router.get('/:publicHash', getPublicAsset);
router.post('/:publicHash/deliveries', postPublicDelivery);

export default router;
