# ConnectForge (SI Remote) — portable preview

Download the [v0.4.1 portable preview](https://github.com/seanLOLIPOP/ConnectForge/releases/tag/v0.4.1) for Windows, Linux, Intel Mac and Apple Silicon Mac. The [portable admin app remains in v0.4.0](https://github.com/seanLOLIPOP/ConnectForge/releases/tag/v0.4.0). Mac ZIPs are built and verified on GitHub-hosted macOS; install them manually.

Built October 20, 2026. A working remote desktop preview with SI account login, owned-device discovery, approval or explicitly enabled unattended access, screen streaming, native keyboard/mouse control, direct encrypted WebRTC connections, and an authenticated TURN relay on the 5080 server.

## Responsiveness

v0.4.1 requests up to 60 FPS on direct connections (up to 30 FPS on relay) and favors reducing resolution over accumulating lag when the encoder or connection is constrained. The video bandwidth cap is 6 Mbps for direct sessions and 2 Mbps for relay sessions, with relay resolution scaled down by 1.5. The viewer requests the lowest available jitter buffer; this is a hint, not a guarantee of zero buffering. Actual FPS and latency depend on the capture system, GPU, network and relay path. The toolbar shows video buffer delay and control-channel round-trip time separately.

Mouse movement uses a separate encrypted, unordered channel without retransmissions when both apps support it. Only the newest position is sent each frame; an idle position is also sent reliably after 80 ms so a lost final movement cannot leave the pointer behind. Clicks, keys, scrolling and key releases retain reliable ordered delivery. Clicks carry their own coordinates so out-of-order movement cannot change the target. Older clients use the compatible ordered input channel. Update both ends for the full improvement.

Active sessions keep the Electron renderer unthrottled when the host window is hidden or minimized; normal throttling resumes after disconnect. Native input reuses display geometry until a display change instead of querying every mouse event.

Validation: 29 automated tests; direct and Cloudflare TURN sessions on Windows; shared clipboard in both paths; hidden host capture; 1,000-move bursts coalesced into one motion message; interoperability with actual v0.4.0 hosts and viewers. The v0.4.1 Mac ZIPs passed strict bundle/native-module/helper signature checks after extraction and an Intel launch check on GitHub-hosted macOS. Full macOS/Linux remote-session performance remains unverified. Sample comparisons are local test observations, not end-to-end latency guarantees.

## GPU acceleration

v0.3.0 prefers H.264 to use the operating system’s hardware encoder and decoder when available, keeping other codecs for compatibility. The host sharing banner shows GPU/CPU encoding; the viewer toolbar shows GPU/CPU decoding, codec, frame rate, and network round-trip time. An unknown status means WebRTC did not report acceleration. GPU availability depends on the OS, driver, and hardware; H.264 can also run in software. This change does not require a GPU on the relay server or guarantee lower latency. Capture now requests up to 60 FPS; network/encoder adaptation may lower the actual rate or resolution. Windows NVIDIA H.264 encoding and D3D11 decoding were verified; Linux/macOS hardware acceleration has not been verified.

## Run

**Windows:** run `SI-Remote-0.4.1-Windows-Portable.exe`. No installer. Alternatively extract the Windows ZIP and run `SI Remote.exe` from that folder.

Windows builds are unsigned; macOS bundles are ad-hoc signed without Developer ID signing or notarization. These are public preview downloads; they are not signed public-store releases.

**Linux x64:** make the AppImage executable and run it, or extract the tar.gz and run `si-remote`. The tar.gz avoids the AppImage FUSE dependency. X11 is supported for remote control; Wayland remote input is not implemented in this preview. The desktop must include libX11 and libXtst. Electron also needs its usual GTK/NSS/desktop runtime libraries. Ubuntu's AppArmor/user-namespace sandbox restrictions can require a system-approved Electron sandbox configuration. Do not disable the Chromium sandbox to work around those restrictions.

**macOS:** extract the matching Apple Silicon (arm64) or Intel (x64) ZIP and open SI Remote.app. v0.4.1 is built on macOS and ad-hoc signed with strict bundle/native-module/helper signature verification. The v0.4.1 Intel app launch passed on a GitHub-hosted macOS 15 runner; both architectures passed extracted ZIP integrity checks. Apple Silicon v0.4.0 launch previously passed on macOS 26.6, but v0.4.1 Apple Silicon runtime and full Mac remote sessions remain unverified. These builds are not Developer ID signed or notarized. macOS may block them until explicitly approved in Privacy & Security. Grant Screen Recording and Accessibility, then restart the app if macOS requests it. Apple signing/notarization is needed for normal public distribution.

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

Certificates, signing keys, identity RPC token, TURN secret, passwords, and database files must never be bundled into downloads. The public server certificate is intentionally included in the client for TLS verification. A different server/certificate requires an updated client configuration or a normal publicly trusted certificate workflow. Signed update offers are implemented, but v0.4.1 should be installed manually: Windows automatic reopening failed its final test, and the immutable v0.4.1 update manifest does not include the later Mac downloads.

## Development

Use Node 24+, pnpm, and the locked dependencies. Electron handles the desktop UI and capture; native input is implemented with Koffi bindings to Windows user32, macOS CoreGraphics, and Linux X11/XTest.

```text
pnpm install
node scripts/download-cloudflared.mjs
pnpm test
pnpm start
pnpm build:win
pnpm build:linux
pnpm build:mac # run on a Mac
```

Prefer native OS builds for releases. Cross-packaged macOS builds must include the correct `@koromix/koffi-darwin-*` native dependency, then be tested, signed, and notarized on macOS. Tests include isolated account/ownership/approval/revocation cases and an opt-in two-process Electron test (`test/electron-harness.cjs`) using an ephemeral identity server separate from production accounts. The test harness is never packaged.

## Validation and remaining work

Verified on Windows: app launch, portable executable/ZIP packaging, native input initialization, two independent account sessions, screen transmission at 1728×1080, direct ICE, forced TURN relay ICE through the 5080, and keyboard event delivery. The relay test also passed through the public Cloudflare TCP hostname with both clients using their loopback Cloudflare bridges. The API health request passed through the public tunnel while validating the origin TLS certificate. Account-isolation, unauthorized signaling, host approval, device removal, logout, and SI password-change revocation are tested.

Linux X11 app launch passed on Ubuntu 24.04 after the one-time administrator preparation of Chromium's sandbox helper. A Windows viewer controlling the Linux 5080 passed 1920×1080 screen streaming, direct and TURN relay paths, and native keyboard event delivery. The sandbox stayed enabled. On other Ubuntu hosts, run `bash scripts/prepare-linux-sandbox.sh /absolute/path/to/extracted-app` and enter the sudo password locally if required. Other Linux systems may support Chromium's user-namespace sandbox without this setup.

v0.4.1 Mac packages are built on GitHub-hosted macOS, with extracted bundle verification and an Intel launch check. Full Mac remote-control sessions and the new Apple Silicon binary's runtime remain unverified. Full cross-platform sessions need device testing. This preview has no file transfer, audio, monitor picker, secure-desktop support, auto-start service, or fully validated automatic update restarts. It shares the first available display. It is a usable preview, not a fully validated RustDesk replacement.

## Mac release integrity

Build Mac releases on macOS with `pnpm build:mac`; cross-platform Mac packaging is rejected because it cannot correctly sign the final bundle. Both Darwin native input packages are explicit optional dependencies and installed for both architectures. The build checks their presence and validates bundle, native module, and Cloudflare signatures. Default signing is ad-hoc for local testing. Public distribution still requires a Developer ID Application certificate and notarization: set `SI_REMOTE_MAC_IDENTITY` to that identity and configure electron-builder’s Apple notarization credentials locally. Do not commit credentials. The portable app is a ZIP containing SI Remote.app, with no installer. macOS 13+ is required; allow Screen Recording, Accessibility, and Local Network as needed for hosting and direct connections.

## Shared text clipboard and saved history (v0.3.0)

During a session, open Clipboard on both computers and enable sharing on each. Only subsequent text copies are shared; the clipboard contents present before opt-in are not uploaded. Copies travel on a separate encrypted WebRTC data channel through the direct or relay path. Older clients keep screen/input compatibility but need an update for clipboard sharing. Sharing resets to off at disconnect and when the connection is rebuilt for relay fallback.

History holds 30 distinct text items up to 16 KB each. Open This computer → Clipboard history to use saved items later. Copies are saved locally under the signed-in SI account, encrypted using Electron safeStorage and the OS credential store. If secure encryption is unavailable, history stays in memory only. Signing out clears memory but retains encrypted history for that same account; other accounts cannot access it. History is not stored on the server or uploaded as a backlog on reconnect. Each participating computer keeps its own saved copy. Clear saved history removes that computer’s saved history; it does not erase the OS clipboard or another computer’s history. Images, files, and rich-text formats are not supported.

Verified using isolated per-process clipboards in a full Windows app session: text transferred in both directions over direct and TURN routes. Eight clipboard persistence/isolation/bounds/race tests and six existing account security tests pass. Mac/Linux clipboard runtime remains unverified.
