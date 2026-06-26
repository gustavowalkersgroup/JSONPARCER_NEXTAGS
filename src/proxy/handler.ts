import { detectFormat, isWebp } from '../images/detect';

export type FetchImpl = (url: string) => Promise<Uint8Array>;
export type Transcode = (buf: Uint8Array) => Promise<Uint8Array>;

async function defaultFetch(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/jpeg,image/png' },
  });
  return new Uint8Array(await res.arrayBuffer());
}

async function defaultTranscode(buf: Uint8Array): Promise<Uint8Array> {
  // Especificador não-literal: evita que tsc/esbuild resolvam 'sharp' no build
  // do núcleo. sharp é optionalDependency, importado só aqui em runtime.
  const spec: string = 'sharp';
  const mod = (await import(spec)) as {
    default: (input: Buffer) => { jpeg: () => { toBuffer: () => Promise<Buffer> } };
  };
  return new Uint8Array(await mod.default(Buffer.from(buf)).jpeg().toBuffer());
}

// Proxy de imagem de referência. Estratégia em camadas: negociação por Accept
// (resolve Shopify), por query ?format=jpg|jpeg (resolve Dooca) e, se ainda vier
// WebP, transcodifica com sharp. fetchImpl/transcode injetáveis para teste.
export function createProxyHandler(
  opts: { fetchImpl?: FetchImpl; transcode?: Transcode } = {},
): (rawUrl: string) => Promise<{ body: Uint8Array; contentType: string }> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const transcode = opts.transcode ?? defaultTranscode;

  return async (rawUrl: string) => {
    const base = rawUrl.split('?')[0] ?? rawUrl;
    const candidates = [base + '?format=jpg', base + '?format=jpeg', base];
    let lastWebp: Uint8Array | null = null;

    for (const c of candidates) {
      try {
        const buf = await fetchImpl(c);
        if (buf.length < 4) continue;
        if (!isWebp(buf)) {
          const f = detectFormat(buf);
          return { body: buf, contentType: f === 'png' ? 'image/png' : 'image/jpeg' };
        }
        lastWebp = buf;
      } catch {
        /* tenta a próxima candidata */
      }
    }

    if (lastWebp) return { body: await transcode(lastWebp), contentType: 'image/jpeg' };
    return { body: new Uint8Array(0), contentType: 'image/jpeg' };
  };
}
