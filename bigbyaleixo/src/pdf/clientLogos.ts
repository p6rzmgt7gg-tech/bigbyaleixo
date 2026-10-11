/**
 * Logótipos dos clientes (canto superior direito do PDF). Os habituais vêm com a aplicação;
 * outros podem ser acrescentados e ficam guardados neste browser.
 */
import btv from './clients/btv.png?url';
import canal11 from './clients/canal11.png?url';
import portocanal from './clients/portocanal.png?url';
import sporttv from './clients/sporttv.png?url';
import type { PdfLogo } from './pdfGenerator';

export interface ClientLogo {
  id: string;
  name: string;
  /** Para mostrar no ecrã. */
  url: string;
  /** Nomes de cliente (normalizados) que escolhem este logótipo automaticamente. */
  matches: string[];
  custom?: boolean;
}

export const BUILT_IN_LOGOS: ClientLogo[] = [
  { id: 'sporttv', name: 'SPORT TV', url: sporttv, matches: ['sport tv', 'sporttv', 'stv'] },
  { id: 'portocanal', name: 'PORTO CANAL', url: portocanal, matches: ['porto canal', 'portocanal'] },
  { id: 'canal11', name: 'CANAL 11', url: canal11, matches: ['canal 11', 'canal11', '11'] },
  { id: 'btv', name: 'BTV', url: btv, matches: ['btv', 'benfica tv'] },
];

const STORAGE_KEY = 'big:client-logos';

interface StoredLogo {
  id: string;
  name: string;
  type: 'png' | 'jpg';
  data: string;
}

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function readStored(): StoredLogo[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredLogo[]) : [];
  } catch {
    return [];
  }
}

function writeStored(logos: StoredLogo[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logos));
    return true;
  } catch {
    return false;
  }
}

/** Todos os logótipos: os da aplicação e os acrescentados neste browser. */
export function listClientLogos(): ClientLogo[] {
  const custom = readStored().map((logo) => ({
    id: logo.id,
    name: logo.name,
    url: `data:image/${logo.type === 'png' ? 'png' : 'jpeg'};base64,${logo.data}`,
    matches: [normalize(logo.name)],
    custom: true,
  }));
  return [...BUILT_IN_LOGOS, ...custom];
}

export async function addClientLogo(name: string, file: File): Promise<ClientLogo | null> {
  const type = /png$/i.test(file.type) || /\.png$/i.test(file.name) ? 'png' : 'jpg';
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const stored: StoredLogo = { id: `custom-${Date.now().toString(36)}`, name: name.trim() || file.name.replace(/\.\w+$/, ''), type, data: btoa(binary) };
  if (!writeStored([...readStored(), stored])) return null;
  return listClientLogos().find((logo) => logo.id === stored.id) ?? null;
}

export function removeClientLogo(id: string): void {
  writeStored(readStored().filter((logo) => logo.id !== id));
}

/** Logótipo que corresponde ao cliente lido no cabeçalho (ex.: "SPORT TV"). */
export function logoForClient(client: string): ClientLogo | null {
  const key = normalize(client);
  if (!key) return null;
  return listClientLogos().find((logo) => logo.matches.includes(key) || normalize(logo.name) === key) ?? null;
}

/** Bytes do logótipo, para o PDF. */
export async function loadClientLogo(logo: ClientLogo): Promise<PdfLogo | null> {
  try {
    const response = await fetch(logo.url);
    if (!response.ok) return null;
    const type = response.headers.get('content-type')?.includes('png') || /png/i.test(logo.url.slice(0, 40)) || logo.url.endsWith('.png') ? 'png' : 'jpg';
    return { bytes: new Uint8Array(await response.arrayBuffer()), type };
  } catch {
    return null;
  }
}
