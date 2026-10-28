# LocalMe

Share files between devices on the same network. Files never touch a server: they stay in the
uploader's browser tab and stream **browser → browser** over WebRTC. The server only introduces
devices and keeps a tiny in-memory file list.

## Layout
- `shared/` – protocol types
- `worker/` – Cloudflare Worker + Durable Object (one per room). Also serves the built client.
- `client/` – React + TS + Vite

## Run
```bash
npm install
npm run dev          # worker on :8787, vite on :5173 (open the Vite URL; /ws is proxied)
```
Open the Vite URL on two devices/tabs. Devices behind the same public IP land in the same room
automatically; use the room button for a private code/QR room.

## Offline mode (no internet)
Run LocalMe on your own PC and let nearby devices use it over the local network. No Cloudflare and
no internet needed (after the one-time `npm install`).

```bash
npm run offline      # builds the client, then serves everything on port 8787
```

1. Put the PC and the other devices on the same network: a router with no internet is fine, or the
   PC's / a phone's Wi-Fi hotspot.
2. Find the PC's address (`ipconfig` on Windows, look for IPv4, e.g. `192.168.1.25`).
3. On every device open `http://192.168.1.25:8787`. All devices land in the same room automatically.
4. If other devices can't connect, allow Node / workerd through the Windows firewall on **private**
   networks. If a phone keeps switching to mobile data, tell it to stay on the Wi-Fi even without
   internet.

Limits on plain `http://<IP>` (browsers treat it as insecure):
- Chrome/Edge can't stream big downloads straight to disk, so they fall back to memory (large files
  may fail). Fix per device: open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add
  `http://192.168.1.25:8787`, enable it and relaunch the browser.
- The "copy" buttons use a fallback that still works.
- Web fonts load from Google, so offline the page uses a system font. Everything else works.
- STUN servers are unreachable offline; devices on the same LAN still connect directly.

For development with hot reload use `npm run dev` instead.

## Deploy
```bash
npx wrangler login
npm run deploy       # builds client, deploys worker + static assets
```

## Notes
- Password on a file is checked by the owner's browser over the P2P channel; it never reaches the server.
- "Download all" skips password-protected files (download those one by one).
- Disk streaming: Chrome/Edge use the File System Access API; Firefox/Safari use a service-worker
  stream (`client/public/sw.js`); last resort is an in-memory Blob (small files only).
- Strict networks (symmetric NAT / client isolation) may need a TURN server – add it to `ICE` in `client/src/lib/p2p.ts`.
