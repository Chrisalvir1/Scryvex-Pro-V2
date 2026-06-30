# Scrypted Pro: Migración a TypeScript 7 RC - Hand-Off para IA

Este documento detalla el estado exacto de la migración del repositorio a TypeScript 7.0.1 RC. Su objetivo es brindar contexto rápido, logros alcanzados y un mapa de ruta claro para cualquier agente IA o desarrollador que tome el proyecto a partir de este punto.

## 📌 Contexto Actual
* **Rama Activa:** `experiment/typescript-7-0-1-rc`
* **Entorno:** Node.js v24.17.0 (Soporte ESM + CJS)
* **Objetivo:** Lograr una migración completa y estable de todo el monorepo y sus plugins a TypeScript 7.0.1 RC, lidiando con deuda técnica y herramientas incompatibles.

---

## ✅ Qué se hizo (Fases A, B y C completadas)

### 1. Sistema Híbrido TS7 / TS6 (Fallback)
* Se implementó exitosamente un fallback de compilación porque herramientas clave como `ts-loader` y `typedoc` aún no soportan la API programática de TS7. 
* **Cómo funciona:** El archivo `tools/typescript-compat/register-fallback.cjs` intercepta los llamados (`require` y `import`) al paquete `typescript` en el momento de compilar y los redirige al alias `typescript-js` (que instala la versión TS 6.0.3 retrocompatible).
* **Compatibilidad ESM y CJS:** El script fue inyectado en `scrypted-webpack.ts` de forma explícita y transparente. Para herramientas ESM (como `typedoc`), el wrapper inyecta dinámicamente un *ESM Loader* en memoria usando `node:module.register` con una `data: URI`, evitando dependencias de scripts `.mjs` externos no controlados.

### 2. Resolución de Builds desde Cero (Clean Install)
* Se validó que el comando `rm -rf node_modules package-lock.json && npm install --legacy-peer-deps && npm run build` funciona perfectamente tanto para el `sdk` como para plugins individuales. (La bandera `--legacy-peer-deps` es mandatoria por un choque de `peerDependencies` con `@rollup/plugin-typescript`).
* Se corrigió el script de construcción de tipos del SDK en `sdk/types`, garantizando que `@types/node` se asigne manualmente al ejecutar `tsc` sin configuración (`tsconfig.build_script.json`).

### 3. Arreglo Parcial de Plugins y Supresión Estratégica
* **Plugins corregidos formalmente (Strict Fix):** Se arreglaron cientos de errores por violaciones estrictas de nulos, inicializaciones vacías (`TS2564`), parámetros inferidos como `any` y tipos de retorno incompatibles en los plugins `reolink`, `amcrest` y `hikvision`.
* **Plugins legacy aislados:** Los plugins con base de código muy antigua y masivos errores estructurales en TS7 (`onvif`, `rtsp`, `ffmpeg-camera`, `prebuffer-mixin`, `snapshot`, etc.) se compilaron exitosamente añadiendo `"strict": false` e `"ignoreDeprecations": "6.0"` temporalmente a sus respectivos `tsconfig.json`.

**Estado Actual del Monorepo:** 
Todo el proyecto (SDK + Plugins) COMPILA exitosamente. El proyecto ya genera los empaquetados (`main.nodejs.js`) para todos los módulos evaluados.

---

## 🚀 Qué hay que hacer (Fase D en adelante)

El proyecto está en estado de compilación "verde", pero con parches de transición que deben ser abordados gradualmente. 

Si eres la próxima IA en este proyecto, tus prioridades son:

### 1. Limpieza de `strict: false` (Deuda Técnica de TS7)
* **El Problema:** Varios plugins (ej. `onvif`, `prebuffer-mixin`) compilan ahora mismo bajo TS7 pero con las validaciones estrictas deshabilitadas para evadir errores de tipo (`strictNullChecks`, `noImplicitAny`, etc.).
* **La Tarea:** Deberás tomar los plugins uno por uno, habilitar `"strict": true` en su `tsconfig.json` y arreglar pacientemente la lógica subyacente. Los errores más comunes que encontrarás son `TS18048` (objeto posiblemente undefined) y `TS7006` (callback param inferido como any). 

### 2. Retiro progresivo de `tools/typescript-compat/register-fallback.cjs`
* **El Problema:** Scrypted Pro todavía depende de Webpack y `ts-loader` para compilar los binarios de los plugins, y estos requieren la API antigua de TS6. 
* **La Tarea:** Deberás vigilar y evaluar en un futuro si se puede actualizar `ts-loader` (o la cadena de empaquetado) a una versión nativa compatible con TS7. Cuando esto suceda, debes borrar el fallback y su invocación en `sdk/src/bin/scrypted-webpack.ts`.

### 3. Pruebas de Integración E2E (End-to-End)
* **La Tarea:** Confirmar que no hubo regresiones funcionales. A pesar de que los binarios compilan (`main.nodejs.js`), es necesario asegurarse que el streaming de video (`ffmpeg-camera`), integraciones de domótica (`homekit`), y el runtime principal (`server`) no presentan errores al arrancar los nodos en producción con el nuevo modelo de tipado estricto que se insertó.
* **Nota Crítica:** Especial cuidado con parches insertados en `amcrest` y `reolink` relativos a los parámetros por defecto de los métodos y a la instanciación tardía de clases (`this.property = undefined as any;`), garantizando que no disparen null-pointers en runtime.
