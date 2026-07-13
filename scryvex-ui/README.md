# Scryvex Pro UI

Companion UI for an unmodified Scrypted Runtime. It deliberately does not contain
camera, plugin, HomeKit, Matter, or database logic. Configuration links open the
native Scrypted UI, keeping every official plugin and setting authoritative.

Set `VITE_SCRYPTED_ORIGIN` to the Scrypted server origin when this UI is hosted on
a different origin. Build with `npm install` and `npm run build` using TypeScript 7.
