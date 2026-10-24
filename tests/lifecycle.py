"""Verify force-stopping the Python runner also reaps its Electron descendants."""
import os
from pathlib import Path
import subprocess
import sys
import time
import psutil

root = Path(__file__).resolve().parent.parent
env = dict(os.environ, PYTHONIOENCODING='utf-8')
env['PET_USER_DATA_DIR'] = str(root / 'artifacts/lifecycle-profile')
env['PET_BRAIN_URL'] = 'http://127.0.0.1:1'  # Offline startup must still open the UI without bundled models.
proc = subprocess.Popen([sys.executable, '-m', 'pet', 'run'], cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
descendants = []
try:
    time.sleep(5)
    assert proc.poll() is None, proc.communicate()[0].decode('utf-8', errors='replace')
    descendants = psutil.Process(proc.pid).children(recursive=True)
    assert len(descendants) >= 3, 'Electron process tree not running'
    proc.kill(); proc.wait(timeout=10)
    _, alive = psutil.wait_procs(descendants, timeout=8)
    assert not alive, f'Unreaped processes: {[p.pid for p in alive]}'
    print(f'PASS force-killed wrapper; all {len(descendants)} Electron descendants exited')
finally:
    if proc.poll() is None: proc.kill(); proc.wait(timeout=10)
    for child in descendants:
        try:
            if child.is_running(): child.kill()
        except psutil.Error:
            pass
