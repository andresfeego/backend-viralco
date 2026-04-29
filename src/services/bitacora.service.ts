import { and, desc, gte, lte } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { bitacoraTable } from '../db/schema.ts';

export async function logBitacoraEvent(input: any) {
  await db.insert(bitacoraTable).values({
    actorUserId: input.actorUserId || null,
    actorEmail: input.actorEmail || null,
    actorRoles: input.actorRoles || null,
    canal: input.canal || 'api',
    accion: input.accion,
    entidadTipo: input.entidadTipo || null,
    entidadId: input.entidadId || null,
    resultado: input.resultado || 'success',
    httpMethod: input.httpMethod || 'GET',
    httpPath: input.httpPath || '',
    httpStatus: Number(input.httpStatus || 200),
    requestId: input.requestId || 'unknown',
    ipHash: input.ipHash || null,
    userAgent: input.userAgent || null,
    payloadResumen: input.payloadResumen || null,
    mensaje: input.mensaje || 'Evento registrado',
    errorCode: input.errorCode || null,
    errorDetalle: input.errorDetalle || null,
    createdAt: new Date(),
  });
}

export async function listBitacora(input: any = {}) {
  const page = Math.max(Number(input.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 30, 1), 30);
  const offset = (page - 1) * pageSize;
  const startDate = input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null;
  const endDate = input.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : null;

  const filters = [];
  if (startDate && !Number.isNaN(startDate.getTime())) {
    filters.push(gte(bitacoraTable.createdAt, startDate));
  }
  if (endDate && !Number.isNaN(endDate.getTime())) {
    filters.push(lte(bitacoraTable.createdAt, endDate));
  }

  const baseQuery = db.select().from(bitacoraTable);
  const rows = await (filters.length ? baseQuery.where(and(...filters)) : baseQuery)
    .orderBy(desc(bitacoraTable.createdAt))
    .limit(pageSize + 1)
    .offset(offset);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    page,
    pageSize,
    hasMore,
    items: pageRows.map((row: any) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      actorRoles: row.actorRoles,
      canal: row.canal,
      accion: row.accion,
      entidadTipo: row.entidadTipo,
      entidadId: row.entidadId,
      resultado: row.resultado,
      httpMethod: row.httpMethod,
      httpPath: row.httpPath,
      httpStatus: row.httpStatus,
      requestId: row.requestId,
      ipHash: row.ipHash,
      userAgent: row.userAgent,
      payloadResumen: row.payloadResumen,
      mensaje: row.mensaje,
      errorCode: row.errorCode,
      errorDetalle: row.errorDetalle,
      createdAt: row.createdAt,
    })),
  };
}
