"""One-time administrator action on SERVER-A520I-AC. Never prints credentials."""
from pathlib import Path
import os, sys, shutil, subprocess, datetime, tempfile
import yaml

CONFIG=Path('/etc/cloudflared/config.yml')
TUNNEL='184fbcab-ad17-475c-9e55-e4405e035fe1'
ROUTES={
    'connectforge.mcseanilog.com':'tcp://192.168.4.68:8443',
    'connectforge-relay.mcseanilog.com':'tcp://192.168.4.68:3478',
}
if os.geteuid()!=0:
    sys.exit('Run with sudo: this updates the root-owned Cloudflare tunnel configuration.')
raw=CONFIG.read_text()
config=yaml.safe_load(raw)
if not isinstance(config,dict) or str(config.get('tunnel'))!=TUNNEL:
    sys.exit('Stopped: this is not the expected crafty-dashboard tunnel.')
ingress=config.get('ingress')
if not isinstance(ingress,list) or not ingress or 'hostname' in ingress[-1]:
    sys.exit('Stopped: the existing ingress/catch-all configuration needs review.')
for rule in ingress:
    if rule.get('hostname') in ROUTES and rule.get('service')!=ROUTES[rule['hostname']]:
        sys.exit('Stopped: a ConnectForge hostname already points to a different service.')
new=[{'hostname':h,'service':s} for h,s in ROUTES.items() if not any(r.get('hostname')==h for r in ingress)]
if not new:
    print('Both ConnectForge routes are already present. No restart needed.')
    sys.exit(0)
config['ingress']=new+ingress
candidate=CONFIG.with_name('config.connectforge.pending.yml')
candidate.write_text(yaml.safe_dump(config,sort_keys=False));candidate.chmod(0o600)
result=subprocess.run(['/usr/bin/cloudflared','--config',str(candidate),'tunnel','ingress','validate'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
if result.returncode:
    candidate.unlink(missing_ok=True)
    sys.exit('Validation failed. Original tunnel configuration was left unchanged.')
backup=CONFIG.with_name('config.yml.before-connectforge-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(CONFIG,backup);backup.chmod(0o600)
os.replace(candidate,CONFIG)
try:
    subprocess.run(['systemctl','restart','cloudflared'],check=True)
    subprocess.run(['systemctl','is-active','--quiet','cloudflared'],check=True)
except subprocess.CalledProcessError:
    shutil.copy2(backup,CONFIG)
    subprocess.run(['systemctl','restart','cloudflared'])
    sys.exit('Restart failed. Restored the original configuration.')
print('Added ConnectForge API and relay routes to crafty-dashboard.')
print('Existing routes were preserved; the tunnel restarted successfully.')
print('Original configuration backup: '+str(backup))
