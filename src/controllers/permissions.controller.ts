import { sendApiError } from '../lib/api-error.ts';
import { getMyPermissions } from '../services/permissions.service.ts';
import { parseEntityId } from '../lib/ids.ts';

export async function myPermissions(req: any, res: any) {
  try {
    const userId = parseEntityId(req.authUser?.id);
    const permissions = await getMyPermissions(userId);
    res.status(200).json({ permissions });
  } catch (error) {
    sendApiError(req, res, error, 'No se pudieron obtener permisos');
  }
}
