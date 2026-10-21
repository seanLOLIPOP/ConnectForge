Fullscreen now uses the native app window control. The toolbar switches to Exit fullscreen, Escape exits locally, and disconnecting restores the window.

The session toolbar adds stream resolution choices (Auto, 720p, 1080p, 1440p, 2160p) and bitrate limits (Auto, 0.5, 1, 2, 4, 8, 16 Mbps). Changes apply during the session. Resolution preserves aspect ratio and never upscales the captured screen; it does not change the host monitor's desktop resolution. Bitrate is an encoder limit, so actual traffic can be lower. Auto keeps adaptive quality. Manual choices survive automatic profile updates. The toolbar wraps on smaller windows.

Update both the viewer and host to v0.4.8 for the selectors. They stay disabled with older hosts. SI Remote Admin remains v0.4.0.

All 68 automated tests pass locally. A Windows Electron smoke check passed native fullscreen entry/exit, selector delivery to the host, preservation through adaptation, and disabling selectors for legacy hosts. Mac/Linux fullscreen and live video changes still require real-device verification. Mac approval still requires local action where macOS blocks this ad-hoc signed, unnotarized preview.

Load signed release 0.4.8 in Admin after its verified update manifest is attached. Downloads and restarts require user approval; active sessions block updates.
