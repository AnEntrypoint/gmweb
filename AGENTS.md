# Operational facts

- Native browser WebSocket handshakes cannot supply the site HTTP Basic credentials. The `/sync` and `/gm/sync` Nginx locations therefore disable Basic auth while preserving their AgentGUI upstream and upgrade routing.
- The Compose service references `gmweb-h1@file`; deployment must provide that Traefik transport through its file provider.
- Only `99-gmweb-startup.sh` is executable in `/custom-cont-init.d`; it invokes the non-executable helper scripts so s6 does not start them independently.
- Selkies serves one transport at a time and the client follows the server's mode, so `SELKIES_MODE` must name a transport the network can actually carry.
- Selkies advertises the container's own IP (e.g. `10.0.2.2`) in its WebRTC host candidates unless `SELKIES_WEBRTC_PUBLIC_IP` names a reachable address; clients cannot route to the container IP, so ICE never completes. The setting maps through NAT1TO1 onto the UDP-mux candidate, and `svc-selkies/run` autodetects the public IP when it is blank.
- s6 runs each service from a copy under `/run/service/<name>/`, made at boot; editing `/etc/s6-overlay/s6-rc.d/<name>/run` in a *live* container changes nothing until the container restarts. Edit the `/run/service/` copy to change a running service, and the `/etc` one to change what the next boot starts.
