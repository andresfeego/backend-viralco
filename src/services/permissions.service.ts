import { getUserPermissions } from './user.service.ts';

export async function getMyPermissions(userId: number) {
  return getUserPermissions(userId);
}
