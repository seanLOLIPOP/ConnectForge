Update restarting now uses Electron's native relauncher instead of detached PowerShell and shell helpers that discarded launch errors. A real public Windows portable app reopened through the new updater fixture and retained its portable data. The updater also lets users retry an interrupted installing state instead of being permanently stuck.

Linux updates can extract the verified AppImage and launch its AppRun without FUSE 2. Chromium sandbox restrictions are checked before closing the current app. An existing administrator-approved sandbox helper is reused only if it is root-owned, mode 4755 and byte-identical to the new helper. User namespaces remain an alternative where permitted. Some Linux systems still require administrator sandbox setup; the updater explains that requirement and keeps the current app open. No sandbox protection is disabled.

Mac updates now check strict signatures and macOS Gatekeeper approval before closing the current app. These preview Mac downloads are ad-hoc signed and not Apple notarized. macOS may block them, so automatic Mac updates are not claimed to work until Developer ID signing and notarization are configured. Manual macOS approval may be required.

All 44 automated tests pass locally, including restart ordering, scheduling failure, FUSE-free staging, sandbox restriction handling, Mac approval checks, failed preflight keeping the app open, and retrying an interrupted installation. The release workflow runs these tests on Windows, Linux and Mac. Full Linux/Mac update restarts remain unverified. Both Mac bundles receive extracted signature, architecture and version checks plus an Intel launch check.

Install v0.4.3 manually once to get the new restart code: an older installed app still uses its older updater to install this release. Preserve the existing SI Remote Data folder. Subsequent offers continue to require user download/restart approval and no active remote session. The signed update manifest will be attached after published artifact hashes are verified and will cover Windows x64, Linux x64 and both Mac architectures.

Windows binaries remain unsigned and Mac binaries are not notarized. Existing OS download warnings and Linux sandbox setup requirements remain. Resumable downloads, progress, speed and estimated remaining time from v0.4.2 are included.


