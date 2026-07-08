# Changelog

## [1.0.2] - 2026-07-07

### Fixed
- Revertido `typescript` a la versión estable 5.6.2 y corregida la compilación del Dockerfile y UI. La versión "7" de TS solicitada previamente causaba un fallo en la instalación de Node.js (Internal Plugin Error: @scrypted/core)
- Forzado el disparador de GitHub Actions para asegurar la construcción del contenedor Docker en la rama de Scryvex Pro.

## [1.0.1] - 2026-07-07

### Fixed
- Corrección del error de Home Assistant `s6-overlay-suexec: fatal: can only run as pid 1` mediante la instrucción `init: false` en `config.yaml`.
- Restaurado nombre oficial del proyecto a Scryvex Pro.

## [1.0.0] - 2026-07-07

### Added
- Versión inicial estable de **Scryvex Pro**.
- Remux directo de cámaras a HomeKit sin transcodificación.
- Soporte optimizado para Raspberry Pi 5 (menor carga de CPU).
- Soporte para cámaras EZVIZ, Aqara G410 2K, Hikvision, ONVIF, RTSP, Tapo, Reolink, Ring, Wyze.
- Agrupación nativa en HomeKit (1 cámara = 1 entidad con PTZ, luz, sirena y movimiento integrados).
- Compatibilidad para mostrar Scryvex Pro como botón lateral (panel ingress) en Home Assistant.
- Nuevos paquetes núcleo de la arquitectura integrados (`camera-core`, `compat-engine`, `runtime`, `registry`).
- Corrección de rutas de UI (dist/index.html) para despliegue correcto en contenedor Docker de Home Assistant.
