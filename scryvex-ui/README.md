# Scryvex Pro UI

Visual wrapper for an unmodified Scrypted Runtime. It deliberately does not contain
camera, plugin, HomeKit, Matter, or database logic. The original console runs in a
same-origin iframe; the wrapper only applies the Scryvex Pro brand and Liquid Glass CSS.

Serve it below `/scryvex-pro/` on the same origin as Scrypted. `VITE_SCRYPTED_VERSION`
controls the visible release badge. Build with `npm install` and `npm run build` using TypeScript 7.
