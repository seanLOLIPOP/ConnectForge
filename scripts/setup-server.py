"""Run on the 5080. Never prints secrets or reads SI user records."""
from pathlib import Path
import json, secrets, subprocess, os
root=Path.home()/'si-remote'
data=root/'data'
data.mkdir(mode=0o700,parents=True,exist_ok=True)
key=data/'tls.key'; cert=data/'tls.pem'
if not key.exists():
    subprocess.run(['openssl','req','-x509','-newkey','rsa:3072','-sha256','-days','3650','-nodes','-keyout',str(key),'-out',str(cert),'-subj','/CN=SI Remote 5080','-addext','subjectAltName=IP:192.168.4.68,DNS:SERVER-Z790-EAGLE-AX,DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
key.chmod(0o600)
secret=data/'turn.secret'
if not secret.exists(): secret.write_text(secrets.token_hex(32))
secret.chmod(0o600)
config={'port':8443,'bind':'0.0.0.0','key':str(key),'cert':str(cert),'identityTokenFile':str(Path.home()/'databases/rpc.token'),'turnSecretFile':str(secret),'turnHost':'192.168.4.68','turnPort':3478}
(data/'server.json').write_text(json.dumps(config,indent=2));(data/'server.json').chmod(0o600)
turn='''listening-port=3478
listening-ip=0.0.0.0
relay-ip=192.168.4.68
min-port=49160
max-port=49260
realm=si-remote
fingerprint
use-auth-secret
static-auth-secret={secret}
no-tls
no-dtls
no-cli
no-multicast-peers
no-tcp-relay
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=::1
user-quota=12
total-quota=120
max-bps=2000000
pidfile={pid}
log-file=stdout
'''.format(secret=secret.read_text().strip(),pid=data/'turn.pid')
(data/'turn.conf').write_text(turn);(data/'turn.conf').chmod(0o600)
unitdir=Path.home()/'.config/systemd/user';unitdir.mkdir(parents=True,exist_ok=True)
node=Path.home()/'emulation/website/runtime/bin/node'
unit='''[Unit]
Description=SI Remote account and connection service
After=network.target
[Service]
WorkingDirectory={root}
Environment=SI_REMOTE_DATA={data}
ExecStart={node} server/start.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
'''.format(root=root,data=data,node=node)
(unitdir/'si-remote.service').write_text(unit)
turnunit='''[Unit]
Description=SI Remote encrypted WebRTC relay
After=network.target
[Service]
WorkingDirectory={root}
Environment=LD_LIBRARY_PATH={root}/turn/root/usr/lib/x86_64-linux-gnu
ExecStart={root}/turn/root/usr/bin/turnserver -c {data}/turn.conf
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
'''.format(root=root,data=data)
(unitdir/'si-remote-turn.service').write_text(turnunit)
print('SI Remote configuration prepared. Existing SI accounts and website were not modified.')
