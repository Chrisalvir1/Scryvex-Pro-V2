# 📋 Estado del Proyecto — Scryvex Pro

> Última actualización: 7 de julio de 2026

---

## 🎯 Objetivo del Proyecto

Scryvex Pro es una versión personalizada de Scrypted orientada a:

- **Remux directo** de cámaras a HomeKit sin transcodificación (para no cargar la Raspberry Pi 5)
- **Soporte H.264 y H.265** con aceleración de hardware cuando sea necesario
- **Una cámara = una entidad** en HomeKit (PTZ, sirena, luz, movimiento agrupados, no como accesorios separados)
- **UI funcional** sin pantalla en blanco en el addon de Home Assistant
- **Soporte de cámaras:** EZVIZ, Aqara G410 (2K), Hikvision, ONVIF genérico, RTSP, Tapo, Reolink, Ring, Wyze, Amcrest, Doorbird, Eufy, UniFi

---

## ✅ Lo que ya está hecho

### Infraestructura base
- [x] Fork del repositorio open source de Scrypted
- [x] Repo creado en GitHub: `Chrisalvir1/Scryvex-Pro`
- [x] SSH key configurada en GitHub para push desde Mac
- [x] Limpieza de `plugins/core/fs/dist/` (carpeta duplicada que causaba pantalla en blanco)
- [x] `node_modules/` agregado a `.gitignore`
- [x] `*.tgz` agregado a `.gitignore`

### Paquetes nuevos creados (Fase 1)
- [x] `packages/camera-core` — Interfaces `CameraStream` y `CameraCapabilities`
- [x] `packages/compat-engine` — Lógica de evaluación remux vs transcode
- [x] `packages/runtime` — Base `PluginRuntime` y `BaseRuntime`
- [x] `packages/registry` — Registro central de cámaras

### Plugins existentes (heredados de Scrypted)
- [x] `plugins/rtsp27` — Ingestión RTSP
- [x] `plugins/onvif27` — ONVIF con PTZ
- [x] `plugins/homekit27` — Exportación a HomeKit
- [x] `plugins/webrtc27` — WebRTC
- [x] `plugins/ffmpeg-camera27` — Cámaras FFmpeg
- [x] `plugins/core` — UI y servidor base (UI corregida en `dist/`, no `fs/dist/`)

### Docker / CI-CD
- [x] `Dockerfile.s6` configurado con build de todos los plugins
- [x] GitHub Actions (`docker.yml`) configurado para publicar imagen en `ghcr.io/chrisalvir1/scrypted`
- [x] `release.yml` configurado para crear releases con tags `v*`

---

## ⏳ Pendientes para que el proyecto funcione completo

### 1. Sincronizar repo local con GitHub
El repo local tiene commits pendientes que no se han podido subir por problema de remote incorrecto.
```bash
cd "/Users/chrisalvir/Desktop/GITHUB PROJECT/Scryvex Pro"
git remote set-url origin git@github.com:Chrisalvir1/Scryvex-Pro.git
git pull origin main --rebase
```

### 2. Corregir build del plugin core (pantalla en blanco)
El `Dockerfile.s6` compila el plugin `core` pero no garantiza que la UI quede en la ruta correcta dentro del contenedor. Agregar después del `BUILDING_CORE`:
```dockerfile
RUN cd /scrypted-src/plugins/core && \
    test -f dist/index.html || (cp -r fs/dist/* dist/ && echo "UI copiada desde fs/dist")
```

### 3. Eliminar archivos grandes del historial git
El archivo `scrypted-core-0.3.147.tgz` (~7.6MB) está siendo trackeado y causa que el push se corte.
```bash
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch scrypted-core-0.3.147.tgz' \
  --prune-empty --tag-name-filter cat -- --all
git push origin main --force
```

### 4. Crear `config.yaml` para addon de Home Assistant
Para que Scryvex Pro aparezca como addon instalable en HA, necesita:
```yaml
# addon/config.yaml
name: Scryvex Pro
version: "1.0.0"
slug: scryvex_pro
description: Scrypted personalizado con remux directo para HomeKit
url: https://github.com/Chrisalvir1/Scryvex-Pro
arch:
  - aarch64
  - amd64
startup: application
boot: auto
ports:
  11080/tcp: 11080
  11443/tcp: 11443
map:
  - config:rw
  - data:rw
options: {}
schema: {}
```

### 5. Crear estructura de repositorio de addons HA
Para poder instalar el addon desde HA hay que crear un repositorio de addons separado o agregar la estructura dentro de este mismo repo:
```
addons/
  scryvex-pro/
    config.yaml
    Dockerfile
    icon.png
    logo.png
    CHANGELOG.md
    README.md
```

### 6. Conectar paquetes nuevos a los plugins existentes
Los paquetes `camera-core`, `compat-engine`, `runtime` y `registry` fueron creados pero aún no están importados en los plugins `rtsp27`, `onvif27`, `homekit27`. Hay que cablear los imports.

### 7. Primera prueba end-to-end
- Compilar imagen Docker localmente
- Instalar en Raspberry Pi 5
- Conectar cámara EZVIZ o Aqara G410
- Verificar que la UI carga (sin pantalla en blanco)
- Verificar remux directo a HomeKit sin transcodificación

---

## 🚀 Para subir a GitHub y que funcione como addon en HA

| Paso | Estado | Acción |
|------|--------|--------|
| Repo en GitHub | ✅ Listo | `Chrisalvir1/Scryvex-Pro` |
| SSH key configurada | ✅ Listo | Ya agregada |
| Paquetes base subidos | ✅ Listo | `camera-core`, `compat-engine`, `runtime`, `registry` |
| Sync repo local → GitHub | ❌ Pendiente | `git pull --rebase && git push` |
| Fix UI pantalla en blanco | ❌ Pendiente | Corregir `Dockerfile.s6` |
| Remover `.tgz` del historial | ❌ Pendiente | `git filter-branch` |
| `config.yaml` addon HA | ❌ Pendiente | Crear estructura de addon |
| Repositorio addon HA | ❌ Pendiente | Crear repo o carpeta `addons/` |
| Cablear imports paquetes nuevos | ❌ Pendiente | Editar plugins rtsp27, onvif27, homekit27 |
| Primera prueba en Pi 5 | ❌ Pendiente | Deploy y test real |

---

## 📌 Prompt para continuar en otra sesión

```
Estoy desarrollando Scryvex Pro, una versión personalizada de Scrypted para HomeKit en Raspberry Pi 5.
Repo: https://github.com/Chrisalvir1/Scryvex-Pro
Repo local: /Users/chrisalvir/Desktop/GITHUB PROJECT/Scryvex Pro

Objetivo principal: remux directo de cámaras (EZVIZ, Aqara G410 2K, Hikvision, ONVIF, RTSP, Tapo, Reolink) 
a HomeKit sin transcodificación para no cargar la Pi 5. Una cámara = una entidad en HomeKit 
(PTZ, luz, sirena, movimiento agrupados).

Lo que ya está hecho:
- Paquetes base creados y subidos a GitHub: camera-core, compat-engine, runtime, registry
- UI del core corregida (fs/dist eliminado, dist/ contiene index.html correcto)
- SSH key configurada para push
- Docker.yml y release.yml configurados

Pendientes urgentes:
1. Sincronizar repo local con GitHub (git pull --rebase)
2. Remover scrypted-core-0.3.147.tgz del historial git (causa desconexión en push)
3. Corregir Dockerfile.s6 para garantizar UI en dist/ dentro del contenedor
4. Crear config.yaml y estructura de addon para Home Assistant
5. Cablear imports de camera-core, compat-engine, runtime, registry en plugins rtsp27, onvif27, homekit27
6. Primera prueba end-to-end en Raspberry Pi 5

El problema del repo local es que el remote apuntaba a Scrypted-Pro-G-C (no existe).
Ya fue corregido a: git@github.com:Chrisalvir1/Scryvex-Pro.git
Pero el push falla porque el .tgz de 7.6MB corta la conexión.
```
