import { createHash } from 'node:crypto';

export const PRINT_PROFILE_SCHEMA_VERSION = 1;
export const PRINT_PROFILE_KIND = 'print-profile';
export const PRINT_PROFILE_MIME = 'application/vnd.kaptura.print-profile+json';

export type PrintProfileV1 = {
  schemaVersion: 1;
  kind: 'print-profile';
  manufacturer: string;
  model: string;
  paper: {
    name: string;
    widthMm: number;
    heightMm: number;
    orientation: 'portrait' | 'landscape';
    borderless: boolean;
    safeMarginMm: number;
  };
  output: {
    dpi: number;
    fit: 'contain' | 'cover';
    defaultCopies: number;
    maxCopies: number;
    supportsTwoPerPage: boolean;
    colorMode: 'color' | 'grayscale';
  };
  compatibility: {
    transports: Array<'airprint' | 'ipp' | 'usb' | 'system'>;
    platforms: Array<'ios' | 'android'>;
  };
};

const rounded = (value: unknown, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
};

export function canonicalPrintProfile(input: any): PrintProfileV1 {
  return {
    schemaVersion: 1,
    kind: PRINT_PROFILE_KIND,
    manufacturer: String(input?.manufacturer || '').trim(),
    model: String(input?.model || '').trim(),
    paper: {
      name: String(input?.paper?.name || '').trim(),
      widthMm: rounded(input?.paper?.widthMm),
      heightMm: rounded(input?.paper?.heightMm),
      orientation: input?.paper?.orientation === 'landscape' ? 'landscape' : 'portrait',
      borderless: Boolean(input?.paper?.borderless),
      safeMarginMm: rounded(input?.paper?.safeMarginMm ?? 0),
    },
    output: {
      dpi: Math.round(Number(input?.output?.dpi)),
      fit: input?.output?.fit === 'cover' ? 'cover' : 'contain',
      defaultCopies: Math.round(Number(input?.output?.defaultCopies)),
      maxCopies: Math.round(Number(input?.output?.maxCopies)),
      supportsTwoPerPage: Boolean(input?.output?.supportsTwoPerPage),
      colorMode: input?.output?.colorMode === 'grayscale' ? 'grayscale' : 'color',
    },
    compatibility: {
      transports: Array.isArray(input?.compatibility?.transports) ? [...new Set(input.compatibility.transports.map(String))] as PrintProfileV1['compatibility']['transports'] : [],
      platforms: Array.isArray(input?.compatibility?.platforms) ? [...new Set(input.compatibility.platforms.map(String))] as PrintProfileV1['compatibility']['platforms'] : [],
    },
  };
}

export function validatePrintProfile(input: any) {
  const errors: Array<{ path: string; code: string; message: string }> = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [{ path: 'profile', code: 'PRINT_PROFILE_INVALID', message: 'El perfil debe ser un objeto' }] };
  if (Number(input.schemaVersion) !== PRINT_PROFILE_SCHEMA_VERSION) errors.push({ path: 'schemaVersion', code: 'SCHEMA_VERSION_INVALID', message: 'Version de perfil no soportada' });
  if (input.kind !== PRINT_PROFILE_KIND) errors.push({ path: 'kind', code: 'KIND_INVALID', message: 'Tipo de perfil no soportado' });
  if (!String(input.manufacturer || '').trim() || String(input.manufacturer).length > 120) errors.push({ path: 'manufacturer', code: 'MANUFACTURER_INVALID', message: 'Fabricante invalido' });
  if (!String(input.model || '').trim() || String(input.model).length > 160) errors.push({ path: 'model', code: 'MODEL_INVALID', message: 'Modelo invalido' });
  if (!String(input.paper?.name || '').trim() || String(input.paper?.name).length > 120) errors.push({ path: 'paper.name', code: 'PAPER_NAME_INVALID', message: 'Nombre de papel invalido' });
  const width = Number(input.paper?.widthMm); const height = Number(input.paper?.heightMm);
  if (!Number.isFinite(width) || width < 20 || width > 2000) errors.push({ path: 'paper.widthMm', code: 'PAPER_WIDTH_INVALID', message: 'Ancho de papel invalido' });
  if (!Number.isFinite(height) || height < 20 || height > 2000) errors.push({ path: 'paper.heightMm', code: 'PAPER_HEIGHT_INVALID', message: 'Alto de papel invalido' });
  if (!['portrait', 'landscape'].includes(input.paper?.orientation)) errors.push({ path: 'paper.orientation', code: 'ORIENTATION_INVALID', message: 'Orientacion invalida' });
  if (typeof input.paper?.borderless !== 'boolean') errors.push({ path: 'paper.borderless', code: 'BOOLEAN_REQUIRED', message: 'borderless debe ser booleano' });
  const safeMargin = Number(input.paper?.safeMarginMm);
  if (!Number.isFinite(safeMargin) || safeMargin < 0 || safeMargin > Math.min(width, height) / 3) errors.push({ path: 'paper.safeMarginMm', code: 'MARGIN_INVALID', message: 'Margen seguro invalido' });
  const dpi = Number(input.output?.dpi);
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > 1200) errors.push({ path: 'output.dpi', code: 'DPI_INVALID', message: 'Resolucion invalida' });
  if (!['contain', 'cover'].includes(input.output?.fit)) errors.push({ path: 'output.fit', code: 'FIT_INVALID', message: 'Ajuste invalido' });
  const copies = Number(input.output?.defaultCopies); const maxCopies = Number(input.output?.maxCopies);
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) errors.push({ path: 'output.defaultCopies', code: 'COPIES_INVALID', message: 'Copias predeterminadas invalidas' });
  if (!Number.isInteger(maxCopies) || maxCopies < copies || maxCopies > 100) errors.push({ path: 'output.maxCopies', code: 'MAX_COPIES_INVALID', message: 'Maximo de copias invalido' });
  if (typeof input.output?.supportsTwoPerPage !== 'boolean') errors.push({ path: 'output.supportsTwoPerPage', code: 'BOOLEAN_REQUIRED', message: 'supportsTwoPerPage debe ser booleano' });
  if (!['color', 'grayscale'].includes(input.output?.colorMode)) errors.push({ path: 'output.colorMode', code: 'COLOR_MODE_INVALID', message: 'Modo de color invalido' });
  const transports = Array.isArray(input.compatibility?.transports) ? input.compatibility.transports : [];
  if (!transports.length || transports.some((value: unknown) => !['airprint', 'ipp', 'usb', 'system'].includes(String(value)))) errors.push({ path: 'compatibility.transports', code: 'TRANSPORT_INVALID', message: 'Transporte de impresion invalido' });
  const platforms = Array.isArray(input.compatibility?.platforms) ? input.compatibility.platforms : [];
  if (!platforms.length || platforms.some((value: unknown) => !['ios', 'android'].includes(String(value)))) errors.push({ path: 'compatibility.platforms', code: 'PLATFORM_INVALID', message: 'Plataforma invalida' });
  return { valid: errors.length === 0, errors };
}

export function printProfileContentHash(profile: PrintProfileV1) {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}
