import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/require-auth.ts';
import { requireActive } from '../middlewares/require-active.ts';
import { isSuperAdmin } from '../services/account-access.service.ts';
import { ServiceError } from '../lib/service-error.ts';
import { sendApiError } from '../lib/api-error.ts';
import { MAX_RECEIPT_BYTES } from '../services/billing-receipt-storage.ts';
import { catalogModeImpact, removeCatalogMode, restoreCatalogMode } from '../services/billing-catalog-lifecycle.service.ts';
import { createBankOption, listBankOptions, updateBankOption } from '../services/billing-bank.service.ts';
import { accountBilling, bankSettings, cancelBillingOrder, createBillingOrder, createCommercialMode, listBillingCatalog, listTransferReports, receiptLink, reviewTransfer, saveBankSettings, saveBillingCatalog, submitTransfer } from '../services/billing.service.ts';

const router = express.Router();
router.use(requireAuth, requireActive);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
const handle = (fn: (req: any) => Promise<any>) => async (req: any, res: any) => {
  try { res.json(await fn(req)); } catch (error) { sendApiError(req, res, error, 'No se pudo completar la operacion de suscripcion'); }
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECEIPT_BYTES, files: 1, fields: 4 } });
router.get('/catalog', handle(async () => ({ catalog: await listBillingCatalog() })));
router.get('/accounts/:accountId', handle(req => accountBilling(req.params.accountId, req.authUser)));
router.post('/accounts/:accountId/orders', handle(req => createBillingOrder(req.params.accountId, req.body, req.authUser)));
router.post('/accounts/:accountId/orders/:orderId/cancel', handle(req => cancelBillingOrder(req.params.accountId, req.params.orderId, req.authUser)));
router.post('/accounts/:accountId/orders/:orderId/reports', upload.single('receipt'), handle(req => submitTransfer(req.params.accountId, req.params.orderId, req.body, req.file, req.authUser)));
router.get('/reports/:reportId/receipt', handle(req => receiptLink(req.params.reportId, req.authUser)));
router.use('/admin', (req: any, res, next) => {
  if (!isSuperAdmin(req.authUser)) { sendApiError(req, res, new ServiceError(403, 'Se requiere Super Admin'), 'Sin permiso'); return; }
  next();
});
router.get('/admin/bank', handle(async () => ({ bank: await bankSettings() })));
router.get('/admin/banks', handle(async () => ({ banks: await listBankOptions() })));
router.post('/admin/banks', handle(async req => ({ bank: await createBankOption(req.body, req.authUser) })));
router.put('/admin/banks/:bankId', handle(async req => ({ bank: await updateBankOption(req.params.bankId, req.body, req.authUser) })));
router.patch('/admin/banks/:bankId/active', handle(async req => ({ bank: await updateBankOption(req.params.bankId, req.body, req.authUser, true) })));
router.get('/admin/catalog', handle(async req => ({ catalog: await listBillingCatalog(undefined, req.query.archived === 'true') })));
router.get('/admin/catalog/:modeId/impact', handle(req => catalogModeImpact(req.params.modeId, req.authUser)));
router.post('/admin/catalog/:modeId/remove', handle(req => removeCatalogMode(req.params.modeId, req.body, req.authUser)));
router.post('/admin/catalog/:modeId/restore', handle(req => restoreCatalogMode(req.params.modeId, req.authUser)));
router.put('/admin/bank', handle(async req => ({ bank: await saveBankSettings(req.body, req.authUser) })));
router.post('/admin/catalog', handle(async req => ({ catalog: await createCommercialMode(req.body, req.authUser) })));
router.put('/admin/catalog/:modeId', handle(async req => ({ catalog: await saveBillingCatalog(req.params.modeId, req.body, req.authUser) })));
router.get('/admin/reports', handle(async req => { const reports = await listTransferReports(req.query, req.authUser); return { reports, nextCursor: reports.length === 200 ? reports.at(-1)?.id : null }; }));
router.post('/admin/reports/:reportId/review', handle(req => reviewTransfer(req.params.reportId, req.body, req.authUser)));
export default router;
