# Etapa 1 — 3.0.0-alpha.1: núcleo universal de lectura

## Propósito

Entregar una lectura segura y serializable del Runtime de Scrypted para la UI
universal, sin duplicar sus dispositivos ni filtrar secretos.

```text
Scrypted Runtime -> PluginRepository -> RawDeviceSnapshot
-> DeviceModelFactory -> DeviceModelView -> API -> UI universal
```

## Alcance

- `PluginRepository` es la única frontera que accede al Runtime.
- `RawDeviceSnapshot` contiene únicamente datos planos y ya sanitizados.
- `DeviceModelView` comparte un contrato único entre servidor y frontend.
- Lecturas tienen timeout, TTL corto, single-flight y aislamiento por
  dispositivo.
- UI universal de solo lectura y UI legacy aislada mediante configuración de
  runtime.
- CI, Docker y add-on construyen contratos antes de servidor y frontend.

## Trabajo pendiente de cierre

1. Eliminar `any` de las capas universales y sustituirlo por `unknown` con
   type guards.
2. Garantizar que el hash de revisión ignore timestamps variables de
   `readErrors` y mantenga la revisión igual para contenido idéntico.
3. Sanitizar defensivamente mensajes de errores y fuentes multimedia también
   en API/repositorio, no solo en settings.
4. Ampliar pruebas de timeout, single-flight, TTL, datos circulares, secretos
   semánticos, errores parciales y selección UI.
5. Construir e instalar la imagen exacta en Home Assistant ARM64 y ejecutar el
   smoke test listado abajo.

## Registro de implementación

### 2026-07-11 — endurecimiento local

- `DeviceModelFactory` calcula la revisión sobre errores normalizados sin
  `occurredAt`, evitando que un mismo fallo cambie la revisión en cada GET.
- El router universal y `DeviceRepository` convierten errores desconocidos en
  mensajes públicos limitados y con URL userinfo redactada.
- `PluginRepository` deja de importar tipos de dispositivos de Scrypted y
  normaliza settings/media desde `unknown` con guards antes de formar el
  snapshot.
- Validación local: contracts build, server typecheck, 10 tests y server build
  correctos.

Pendiente: ampliar las pruebas de concurrencia/timeout y ejecutar el smoke test
ARM64 antes de cambiar a `beta.1`.

### 2026-07-11 — corrección de instalación Home Assistant

El primer intento de construir el add-on falló antes de compilar con
`fatal: couldn't find remote ref 3.0.0-alpha.1`. Home Assistant entrega la
versión del add-on como `BUILD_VERSION`, pero no proporciona `SOURCE_REF`.
El Dockerfile ahora usa `main` como referencia por defecto para versiones de
desarrollo y conserva `SOURCE_REF` para que CI construya desde un SHA, tag o
rama explícitos. Una versión final deberá construirse desde su tag `v3.0.0`.

### 2026-07-11 — autenticación Ingress

La UI alpha respondió HTTP 401 aunque Home Assistant ya había autenticado al
usuario por Ingress. El middleware de Scrypted solo entendía sus propias
cookies/tokens y descartaba los encabezados `X-Remote-User-*` que agrega el
Supervisor. Se acepta ahora esa identidad solamente cuando la conexión llega
desde el proxy documentado `172.30.32.2`; no se confían esos encabezados desde
la LAN. Debe validarse desde el panel Ingress real antes de beta.1.

## Criterios de salida

- `pnpm install --frozen-lockfile` y los builds/test/lint definidos por CI
  terminan con código 0 sobre el mismo SHA publicado.
- La imagen ARM64 se construye desde `SOURCE_REF=<SHA>` y usa
  `server/dist/scrypted-main.js` como entrypoint.
- `/api/scrypted/*` exige autenticación.
- Un dispositivo que falla no elimina los demás de `/api/scrypted/devices`.
- Dos lecturas sin cambios mantienen exactamente la misma `revision`.
- No hay proxies, métodos, ciclos ni secretos en las respuestas.

## Smoke test del propietario

1. Instalar el add-on y confirmar `running`, cero reinicios y logs limpios.
2. Abrir `/api/system/ui-config`, `/api/scrypted/plugins` y
   `/api/scrypted/devices` a través de Ingress autenticado.
3. Sobre una cámara ONVIF real, revisar interfaces, settings, media options y
   diagnostics: secretos redactados, errores parciales visibles y ninguna
   capacidad inventada.
4. Repetir dos lecturas y comprobar `revision` estable; cambiar un setting en
   Scrypted y comprobar que la revisión cambia tras TTL/invalidez.
5. Ejecutar diez lecturas simultáneas de settings y verificar una sola lectura
   del plugin por ventana de cache.
6. Mantener el add-on 30 minutos, alternando UI universal/legacy y vigilando
   RAM, CPU, reinicios y errores.

## Handoff

Antes de pasar a beta.1, registrar aquí SHA, artefacto ARM64, resultados del
smoke test, errores encontrados y cualquier limitación. Si el smoke test falla,
corregir alpha.1 en vez de avanzar de versión.
