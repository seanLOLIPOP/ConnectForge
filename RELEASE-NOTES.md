Improves the local Mac update approval guide. It now explains that you must first try opening the exact downloaded app in Finder before looking for Open Anyway. It names the Security section and explains that some macOS warnings may not offer approval.

Open System Settings launches the System Settings app directly instead of relying on an older preference-pane link. Choose Privacy & Security in its sidebar. If the launch fails, the app shows manual instructions and the error. The approval guide also restores and focuses a hidden or minimized SI Remote window before displaying the dialog.

Install v0.4.9 once to receive this guide for subsequent updates. The currently installed app still handles the update into v0.4.9. Mac approval remains local and may still be required; these builds are ad-hoc signed and not Apple notarized. No Gatekeeper, signature, checksum or restart-approval check is disabled.

Retains v0.4.8 fullscreen and stream resolution/bitrate controls. Update both viewer and host for those controls. SI Remote Admin remains v0.4.0.

All 70 automated tests pass locally, including selected-action routing, restoring the approval window, and both returned and thrown Settings-launch errors. Opening Settings and completing approval on a real Mac remain unverified.

Load signed release 0.4.9 in Admin after its verified update manifest is attached. Users approve downloads and restarts; active sessions block updates.
