# ConnectForge (SI Remote) — portable preview

Download the Windows, Linux, and macOS packages from the [v0.2.1 preview release](https://github.com/seanLOLIPOP/ConnectForge/releases/tag/v0.2.1).

Built October 20, 2026. A working remote desktop preview with SI account login, owned-device discovery, approval or explicitly enabled unattended access, screen streaming, native keyboard/mouse control, direct encrypted WebRTC connections, and an authenticated TURN relay on the 5080 server.

## GPU acceleration

v0.2.1 prefers H.264 to use the operating system’s hardware encoder and decoder when available, keeping other codecs for compatibility. The host sharing banner shows GPU/CPU encoding; the viewer toolbar shows GPU/CPU decoding, codec, frame rate, and network round-trip time. An unknown status means WebRTC did not report acceleration. GPU availability depends on the OS, driver, and hardware; H.264 can also run in software. This change does not require a GPU on the relay server or guarantee lower latency. Capture remains at 24 FPS ideal, 30 FPS maximum. Windows NVIDIA H.264 encoding and D3D11 decoding were verified; Linux/macOS hardware acceleration has not been verified.

## Run

**Windows:** run `SI-Remote-0.2.1-Windows-Portable.exe`. No installer. Alternatively extract the Windows ZIP and run `SI Remote.exe` from that folder.

Windows and macOS builds are not code-signed. These are private preview downloads, not signed public-store releases.

**Linux x64:** make the AppImage executable and run it, or extract the tar.gz and run `si-remote`. The tar.gz avoids the AppImage FUSE dependency. X11 is supported for remote control; Wayland remote input is not implemented in this preview. The desktop must include libX11 and libXtst. Electron also needs its usual GTK/NSS/desktop runtime libraries. Ubuntu's AppArmor/user-namespace sandbox restrictions can require a system-approved Electron sandbox configuration. Do not disable the Chromium sandbox to work around those restrictions.

**macOS:** extract the matching Apple Silicon (arm64) or Intel (x64) ZIP and open SI Remote.app. These builds are unsigned and unnotarized and have not been runtime-tested on a Mac. macOS may block them until explicitly approved in Privacy & Security. Grant Screen Recording and Accessibility, then restart the app if macOS requests it. Apple signing/notarization is needed for normal public distribution.

1. Sign in with your existing SI email and password. No new account is created.
2. On the computer to control, open **This computer** and explicitly enable **Unattended access**, then save. Otherwise someone must accept each incoming request.
3. Open the app on another computer and sign in to the same SI account.
4. Select the online computer and click **Connect**.
5. Click the remote screen to send mouse and keyboard input. Use **Disconnect**, **Stop sharing**, or the tray menu to end the session.

Keep the app running and the host awake. Closing the window leaves it in the tray only while signed in with unattended access enabled. **Quitting stops remote access.** This portable preview does not install a service or automatically start at boot. Login screens, Windows secure desktop/UAC prompts, and access before OS sign-in are outside this build's capabilities.

## Network scope

The app connects through **connectforge.mcseanilog.com** using the existing **crafty-dashboard** Cloudflare tunnel on SERVER-A520I-AC (`192.168.4.99`). That machine and the 5080 must both remain running. The portable app includes a checksum-verified official Cloudflare helper, which runs silently as a child process; users do not need to install Cloudflare, open router ports, or sign in to a Cloudflare account.

The two Cloudflare routes are raw TCP over secure WebSockets:

* `connectforge.mcseanilog.com` → `192.168.4.68:8443` for login and signaling.
* `connectforge-relay.mcseanilog.com` → `192.168.4.68:3478` for authenticated TURN TCP.

The helper binds only to loopback on the client. The app verifies the 5080's dedicated TLS certificate inside the tunnel, preserving API encryption without disabling certificate checks. Screen/control traffic stays protected by WebRTC encryption. Cloudflare's public STUN server discovers public addresses for direct connections. When direct access fails, both clients use TURN TCP through their Cloudflare bridges, with the 5080 forwarding the encrypted media. The TURN media ports only need to be reachable locally on the 5080 in this mode. These hostnames are app transports, not browser-based login websites.

The server runs:

* HTTPS API and secure WebSocket signaling: TCP 8443.
* STUN/TURN: UDP and TCP 3478.
* TURN relay media ports: UDP 49160–49260.

Direct media is preferred. If the initial route fails, the viewer retries with relay-only ICE. Both direct and relayed media/control use WebRTC encryption. TURN authentication uses account-bound credentials expiring after one hour; the long-term TURN secret stays on the server.

No inbound router forwarding is required for the Cloudflare configuration. Restrictive networks can still block Cloudflare or WebRTC; the app reports failed connections instead of claiming every network can be repaired. SI's database/RPC remains private on the 5080's loopback interface.

**Auto-fix connection** checks HTTPS, verifies the account, refreshes device registration, reconnects signaling, and reports native-input readiness and relay configuration. ICE discovers current addresses for each session. It does not claim to alter the ISP, fix every firewall, or prove TURN reachability merely from its configuration.

## Portable data and credentials

The app uses `SI Remote Data` next to the portable executable/AppImage/app folder when writable. It falls back to the OS application-data folder when that location is not writable. It reports the actual location in **This computer**. Keep the executable and its data folder together when moving it on the same machine.

Passwords are sent over verified HTTPS and never saved. The main process keeps the session token away from the renderer. Remembered tokens are encrypted with Electron safeStorage and the OS credential store. Remember me is disabled if secure encryption is unavailable, including Linux's basic_text fallback. Remembered credentials generally cannot be moved to a different OS account/computer; sign in again there. Settings and device registration identifiers are local metadata, not passwords. Do not distribute your own data folder to other people.

## SI integration and server operations

Website/account records were not changed. `server/identity.mjs` calls only SI's existing loopback RPC `findEmail` and `user` operations. It reads the existing SI password record in the server process and verifies it using the existing scrypt scheme. No password hashes or database tokens are sent to desktop clients. Remote sessions/devices/audit entries use a separate `data/remote.sqlite` file. Account deletion or an SI password change invalidates sessions; connected sockets are revalidated at most once per minute.

On the 5080, files are in `/home/sean/si-remote`. User services `si-remote.service` and `si-remote-turn.service` are enabled. User lingering is enabled so they run independently of an SSH login and start after boot. Cloudflare's existing root-managed `cloudflared.service` on `192.168.4.99` reads `/etc/cloudflared/config.yml`; existing Crafty/Minecraft routes were preserved and a timestamped backup was made before adding ConnectForge.

```bash
systemctl --user status si-remote si-remote-turn
systemctl --user restart si-remote si-remote-turn
systemctl --user stop si-remote si-remote-turn
```

Certificates, signing keys, identity RPC token, TURN secret, passwords, and database files must never be bundled into downloads. The public server certificate is intentionally included in the client for TLS verification. A different server/certificate requires an updated client configuration or a normal publicly trusted certificate workflow. Automatic update delivery is not implemented.

## Development

Use Node 24+, pnpm, and the locked dependencies. Electron handles the desktop UI and capture; native input is implemented with Koffi bindings to Windows user32, macOS CoreGraphics, and Linux X11/XTest.

```text
pnpm install
node scripts/download-cloudflared.mjs
pnpm test
pnpm start
pnpm build:win
pnpm build:linux
pnpm build:mac
```

Prefer native OS builds for releases. Cross-packaged macOS builds must include the correct `@koromix/koffi-darwin-*` native dependency, then be tested, signed, and notarized on macOS. Tests include isolated account/ownership/approval/revocation cases and an opt-in two-process Electron test (`test/electron-harness.cjs`) using an ephemeral identity server separate from production accounts. The test harness is never packaged.

## Validation and remaining work

Verified on Windows: app launch, portable executable/ZIP packaging, native input initialization, two independent account sessions, screen transmission at 1728×1080, direct ICE, forced TURN relay ICE through the 5080, and keyboard event delivery. The relay test also passed through the public Cloudflare TCP hostname with both clients using their loopback Cloudflare bridges. The API health request passed through the public tunnel while validating the origin TLS certificate. Account-isolation, unauthorized signaling, host approval, device removal, logout, and SI password-change revocation are tested.

Linux X11 app launch passed on Ubuntu 24.04 after the one-time administrator preparation of Chromium's sandbox helper. A Windows viewer controlling the Linux 5080 passed 1920×1080 screen streaming, direct and TURN relay paths, and native keyboard event delivery. The sandbox stayed enabled. On other Ubuntu hosts, run `bash scripts/prepare-linux-sandbox.sh /absolute/path/to/extracted-app` and enter the sudo password locally if required. Other Linux systems may support Chromium's user-namespace sandbox without this setup.

macOS binaries are cross-packaged and untested on actual Macs. Full cross-platform sessions need device testing. This preview has no file transfer, clipboard sync, audio, monitor picker, secure-desktop support, auto-start service, or automatic updates. It shares the first available display. It is a usable preview, not a fully validated RustDesk replacement.
