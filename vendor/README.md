# vendor/

`muyajs-core-<commit>.tgz` is upstream Muya built from the MarkText monorepo
(`marktext/marktext`, `packages/muya`) at a pinned `develop` commit, because
the fixes Makora needs (large-file performance, heading Enter duplication,
lazy change payloads, ...) aren't in an npm release yet (npm: 0.2.0, May 2026).

Rebuild / bump:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/marktext/marktext.git
cd marktext && git sparse-checkout set packages/muya
pnpm install --filter "@muyajs/core..." --frozen-lockfile   # root postinstall may fail; harmless
cd packages/muya && pnpm build && pnpm pack
# copy the tarball here as muyajs-core-<short-sha>.tgz, then:
npm i ./vendor/muyajs-core-<short-sha>.tgz
npm test && npm run test:e2e && npx playwright test -c tests/perf/playwright.perf.ts
```

Switch back to the npm package once a release contains these fixes.
