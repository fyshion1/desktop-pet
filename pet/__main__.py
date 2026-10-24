"""python -m pet run | doctor。Windows Job 在包装器被强杀时回收 Electron 进程树。"""
import argparse
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
PROJECT = Path(os.environ.get('SHIONARIUM_CORE_DIR', str(ROOT.parent.parent))).resolve()
ELECTRON = ROOT / 'node_modules' / 'electron' / 'dist' / ('electron.exe' if os.name == 'nt' else 'electron')


def windows_job(proc):
    if os.name != 'nt':
        return None
    from ctypes import wintypes as w
    class Basic(ctypes.Structure):
        _fields_ = [('ProcessTime', ctypes.c_int64), ('JobTime', ctypes.c_int64), ('Flags', w.DWORD),
                    ('MinWorking', ctypes.c_size_t), ('MaxWorking', ctypes.c_size_t), ('ActiveLimit', w.DWORD),
                    ('Affinity', ctypes.c_size_t), ('Priority', w.DWORD), ('Scheduling', w.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['ReadOps', 'WriteOps', 'OtherOps', 'ReadBytes', 'WriteBytes', 'OtherBytes']]
    class Extended(ctypes.Structure):
        _fields_ = [('Basic', Basic), ('IO', IO), ('ProcessMemory', ctypes.c_size_t), ('JobMemory', ctypes.c_size_t),
                    ('PeakProcess', ctypes.c_size_t), ('PeakJob', ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    info = Extended(); info.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        if job: kernel.CloseHandle(job)
        raise OSError('无法创建桌宠进程回收 Job')
    if not kernel.AssignProcessToJobObject(job, int(proc._handle)):
        kernel.CloseHandle(job)
        raise OSError('无法将桌宠加入进程回收 Job')
    return kernel, job


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['run', 'doctor'])
    args = parser.parse_args()
    required = [ELECTRON, ROOT / 'dist/index.html']
    missing = [p for p in required if not p.is_file()]
    if missing:
        for p in missing: print(f'缺少：{p}', flush=True)
        print('请在桌宠插件目录执行 npm install 和 npm run build。启动后点击“添加模型”，选择自行取得授权的本地文件。', flush=True)
        return 1
    if args.command == 'doctor':
        print('Electron 与桌宠界面已就绪。模型默认不附带；Live2D 还需自行准备 Cubism Core。', flush=True)
        return 0
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    proc = subprocess.Popen([str(ELECTRON), str(ROOT)], cwd=ROOT, env=env, stdin=subprocess.DEVNULL)
    job = None
    try:
        job = windows_job(proc)
        def stop(*_): raise KeyboardInterrupt
        signal.signal(signal.SIGINT, stop)
        if hasattr(signal, 'SIGBREAK'): signal.signal(signal.SIGBREAK, stop)
        print(f'桌宠已启动，pid={proc.pid}；Ctrl+Shift+Space 打开对话。', flush=True)
        return proc.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        if job:
            job[0].CloseHandle(job[1])
        elif proc.poll() is None:
            proc.terminate()
        try: proc.wait(timeout=8)
        except subprocess.TimeoutExpired: proc.kill()


if __name__ == '__main__':
    sys.exit(main())
