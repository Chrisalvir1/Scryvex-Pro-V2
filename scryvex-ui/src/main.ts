import './styles.css';

const nativeOrigin = (import.meta.env.VITE_SCRYPTED_ORIGIN || window.location.origin).replace(/\/$/, '');
const nativeUrl = (path = '/') => `${nativeOrigin}${path}`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header>
      <div><p class="eyebrow">Scryvex Pro</p><h1>La interfaz nueva. Scrypted intacto.</h1></div>
      <a class="native" href="${nativeUrl()}" target="_blank" rel="noreferrer">Abrir Scrypted original ↗</a>
    </header>
    <section class="hero">
      <h2>Control moderno sin una segunda plataforma.</h2>
      <p>Las cámaras, plugins, ajustes, credenciales y base de datos pertenecen exclusivamente a Scrypted. Esta capa nunca instala ni modifica plugins por cuenta propia.</p>
    </section>
    <section class="grid">
      <article><h3>Plugins y cámaras</h3><p>Usa la tienda y los DeviceCreator originales. Aquí no se recrean formularios ni se pierden opciones de ONVIF, RTSP, Ring, Tapo, Wyze o EZVIZ.</p><a href="${nativeUrl()}" target="_blank" rel="noreferrer">Gestionar en Scrypted ↗</a></article>
      <article><h3>Apple: remux solamente</h3><p>La futura auditoría de compatibilidad solo permitirá H.264/H.265 ya presentes en la cámara. Si el perfil requiere conversión, se mostrará como no compatible; no se transcodificará.</p><span class="status">Diagnóstico pendiente de Runtime</span></article>
      <article><h3>HomeKit y Matter</h3><p>Se mantiene la integración original de Scrypted. Matter y HomeKit Secure Video se tratan como capacidades distintas y no se anuncian hasta que el Runtime las confirme.</p><span class="status">Sin afirmaciones de compatibilidad</span></article>
    </section>
    <section class="notice"><strong>Principio de seguridad:</strong> toda configuración real se abre en la UI original de Scrypted. Scryvex Pro se limita a presentación, enlaces y diagnósticos de solo lectura hasta que cada capacidad sea validada.</section>
  </main>`;
