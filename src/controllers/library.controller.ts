import { jsonError } from '../lib/http.ts';
import { serviceErrorStatus } from '../lib/service-error.ts';
import {
  addAssetToAccountLibrary,
  cloneAssetForAccount,
  createLibraryAsset,
  listAccountLibrary,
  listLibraryAssets,
  prepareAccountLibraryUpload,
  prepareGlobalLibraryUpload,
} from '../services/library.service.ts';

function sendError(res: any, error: unknown, fallback: string) {
  jsonError(res, serviceErrorStatus(error), error instanceof Error ? error.message : fallback);
}

export async function getLibraryAssets(req: any, res: any) {
  try { res.status(200).json({ assets: await listLibraryAssets(req.query || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo listar biblioteca'); }
}

export async function postGlobalLibraryUpload(req: any, res: any) {
  try { res.status(200).json(await prepareGlobalLibraryUpload(req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo preparar upload global'); }
}

export async function postGlobalLibraryAsset(req: any, res: any) {
  try { res.status(201).json({ asset: await createLibraryAsset(req.body || {}, req.authUser, { ownerType: 'viralco' }) }); }
  catch (error) { sendError(res, error, 'No se pudo crear recurso global'); }
}

export async function getAccountLibrary(req: any, res: any) {
  try { res.status(200).json({ library: await listAccountLibrary(req.params.accountId, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo listar biblioteca de cuenta'); }
}

export async function postAccountLibraryUpload(req: any, res: any) {
  try { res.status(200).json(await prepareAccountLibraryUpload(req.params.accountId, req.body || {}, req.authUser)); }
  catch (error) { sendError(res, error, 'No se pudo preparar upload de cuenta'); }
}

export async function postAccountLibraryAsset(req: any, res: any) {
  try {
    const asset = await createLibraryAsset(req.body || {}, req.authUser, { ownerType: 'account', accountId: BigInt(String(req.params.accountId)) });
    await addAssetToAccountLibrary(req.params.accountId, { libraryAssetId: asset?.id, displayName: req.body?.displayName }, req.authUser);
    res.status(201).json({ asset });
  } catch (error) { sendError(res, error, 'No se pudo crear recurso de cuenta'); }
}

export async function postAccountLibraryEntry(req: any, res: any) {
  try { res.status(201).json({ library: await addAssetToAccountLibrary(req.params.accountId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo agregar recurso a biblioteca'); }
}

export async function postAccountLibraryClone(req: any, res: any) {
  try { res.status(201).json({ asset: await cloneAssetForAccount(req.params.accountId, req.params.libraryAssetId, req.body || {}, req.authUser) }); }
  catch (error) { sendError(res, error, 'No se pudo clonar recurso'); }
}
