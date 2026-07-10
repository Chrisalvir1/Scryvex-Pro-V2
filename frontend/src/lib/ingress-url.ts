function getIngressBaseUrl(): URL {
  const current = new URL(window.location.href);
  const ingressMarker = '/api/hassio_ingress/';
  const markerIndex = current.pathname.indexOf(ingressMarker);

  if (markerIndex === -1) {
    current.pathname = '/';
    current.search = '';
    current.hash = '';
    return current;
  }

  const remainder = current.pathname.slice(
    markerIndex + ingressMarker.length,
  );

  const token = remainder.split('/')[0];

  current.pathname = `${ingressMarker}${token}/`;
  current.search = '';
  current.hash = '';

  return current;
}

export function apiUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), getIngressBaseUrl()).toString();
}

export function websocketUrl(path: string): string {
  const url = new URL(
    path.replace(/^\/+/, ''),
    getIngressBaseUrl(),
  );

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  return url.toString();
}
