import { getUserPermissions } from './user.service.ts';
import type { EntityId } from '../lib/ids.ts';
import { serializeId } from '../lib/ids.ts';

export async function getMyPermissions(userId: EntityId) {
  const permissions = await getUserPermissions(userId);
  return permissions.map((permission) => ({ ...permission, id: serializeId(permission.id) }));
}
