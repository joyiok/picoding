#!/bin/sh
set -eu
mkdir -p /workspace/.picoding /workspace/downloads
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.2
done
openbox > /tmp/openbox.log 2>&1 &
x11vnc -display :99 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 > /tmp/vnc.log 2>&1 &
websockify --web /usr/share/novnc 6080 127.0.0.1:5900 > /tmp/websockify.log 2>&1 &
exec node /opt/picoding/dist/sandbox/worker.js
