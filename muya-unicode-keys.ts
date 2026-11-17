import type { Plugin } from 'vite';

// Upstream Muya's build emits a case-folding table with unquoted object keys
// from Unicode 16 (e.g. `꟎: "꟏"`). Engines with older Unicode tables (Node 24,
// older Safari) reject them as identifiers, which breaks the whole bundle.
// Quote non-ASCII keys that directly follow `{` or `,`.
export function quoteUnicodeKeys(code: string): string {
  return code.replace(/([{,]\s*)([^\x00-\x7F\s"'`:,{}()[\]]+)(\s*:)/g, (_m, pre, key, post) => `${pre}${JSON.stringify(key)}${post}`);
}

export function muyaUnicodeKeys(): Plugin {
  return {
    name: 'muya-unicode-keys',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@muyajs/core') || !/\.(m?js)$/.test(id.split('?')[0])) return null;
      const out = quoteUnicodeKeys(code);
      return out === code ? null : { code: out, map: null };
    },
    // The minifier (which runs after renderChunk in Vite 8) un-quotes keys it
    // considers valid identifiers; re-quote in the final output.
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') file.code = quoteUnicodeKeys(file.code);
      }
    },
  };
}
