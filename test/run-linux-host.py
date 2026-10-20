"""Test with the already approved, identical Chromium sandbox helper."""
from pathlib import Path
import hashlib, os, subprocess
root=Path.home()/'si-remote'
approved=root/'dist/linux-unpacked/chrome-sandbox'
dev=root/'node_modules/electron/dist/chrome-sandbox'
backup=root/'data/dev-sandbox-before-test'
digest=lambda p:hashlib.sha256(p.read_bytes()).digest()
if approved.stat().st_uid!=0 or approved.stat().st_mode&0o4777!=0o4755 or digest(approved)!=digest(dev):
    raise RuntimeError('The approved sandbox helper does not match the development runtime. No files were moved.')
os.rename(dev,backup);os.rename(approved,dev)
try:
    env=dict(os.environ,DISPLAY=':1',XAUTHORITY='/run/user/1000/gdm/Xauthority',SI_REMOTE_TEST_SERVER='https://192.168.4.68:8444',SI_REMOTE_PROFILE=str(root/'test/linux-host-profile'),SI_REMOTE_E2E=str(root/'test/linux-host-result.json'),SI_REMOTE_E2E_ROLE='host',SI_REMOTE_E2E_LOGIN=str(root/'data/e2e-login.json'))
    subprocess.run([str(root/'node_modules/electron/dist/electron'),'.'],cwd=root,env=env,timeout=200,check=True)
finally:
    os.rename(dev,approved);os.rename(backup,dev)
