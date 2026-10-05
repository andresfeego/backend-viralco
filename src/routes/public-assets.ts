import express from 'express';
import { getPublicAsset, getPublicAssetInfo, postPublicDelivery } from '../controllers/mirror-runtime.controller.ts';

const router = express.Router();
router.get('/:publicHash', getPublicAsset);
router.get('/:publicHash/info', getPublicAssetInfo);
router.post('/:publicHash/deliveries', postPublicDelivery);

export default router;
