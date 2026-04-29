import { env } from '../lib/env.ts';
import { jsonError } from '../lib/http.ts';
import { activateUser, createAdminUser, deactivateUser, listAdminUsers } from '../services/admin.service.ts';
import { listBitacora } from '../services/bitacora.service.ts';
import { createSuperAdminConfirmToken } from '../services/token.service.ts';

export async function confirmSuperAdminPassword(req: any, res: any) {
  try {
    const inputPassword = String(req.body?.password || '');

    if (!inputPassword) {
      jsonError(res, 400, 'Contrasena de confirmacion requerida');
      return;
    }

    if (inputPassword !== env.superAdminConfirmPassword) {
      jsonError(res, 401, 'Contrasena de confirmacion invalida');
      return;
    }

    const token = createSuperAdminConfirmToken(Number(req.authUser.id));
    res.status(200).json({ confirmationToken: token });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo confirmar acceso';
    jsonError(res, 400, message);
  }
}

export async function getUsers(req: any, res: any) {
  try {
    const users = await listAdminUsers();
    res.status(200).json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo listar usuarios';
    jsonError(res, 400, message);
  }
}

export async function createAdmin(req: any, res: any) {
  try {
    const user = await createAdminUser(req.body || {});
    res.status(201).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear usuario admin';
    jsonError(res, 400, message);
  }
}

export async function activate(req: any, res: any) {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      jsonError(res, 400, 'ID de usuario invalido');
      return;
    }

    const user = await activateUser(userId);
    res.status(200).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo activar usuario';
    jsonError(res, 400, message);
  }
}

export async function deactivate(req: any, res: any) {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      jsonError(res, 400, 'ID de usuario invalido');
      return;
    }

    const user = await deactivateUser(userId);
    res.status(200).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo desactivar usuario';
    jsonError(res, 400, message);
  }
}

export async function getBitacora(req: any, res: any) {
  try {
    const result = await listBitacora({
      page: req.query?.page,
      pageSize: req.query?.pageSize,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo consultar bitacora';
    jsonError(res, 400, message);
  }
}
