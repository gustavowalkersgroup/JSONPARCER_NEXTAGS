import { defineConfig } from 'tsup';

export default defineConfig([
  // Pacote npm dual ESM/CJS (núcleo puro)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'node20',
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.mjs' };
    },
  },
  // Entry do proxy (depende de sharp — externo, nunca bundlado)
  {
    entry: { proxy: 'src/proxy/handler.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'node20',
    external: ['sharp'],
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.mjs' };
    },
  },
  // Bundle de card: IIFE autossuficiente, zod/jsonrepair inlinados, zero require
  // externo. tsup acrescenta ".global.js" ao formato iife → dist/card.global.js.
  {
    entry: { card: 'src/index.ts' },
    format: ['iife'],
    globalName: 'WAMW',
    noExternal: ['zod', 'jsonrepair'],
    minify: true,
    platform: 'browser',
    target: 'es2020',
    dts: false,
  },
]);
