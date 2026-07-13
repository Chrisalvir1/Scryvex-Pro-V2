# Scryvex ONVIF

Independent Scrypted plugin for ONVIF cameras which need a fresh media URI for
each connection. It does not modify, replace, vendor, or copy `@scrypted/onvif`.

The adapter reports the actual camera codecs discovered from ONVIF. Its stream
mode is remux-only: it never changes H.264 into H.265, H.265 into H.264, or
transcodes video. Any controller-specific export remains subject to that
controller's supported codecs.

The first target is the camera firmware that only answers a normal RTSP
`DESCRIBE` when the standard ONVIF backchannel `Require` header is present.
