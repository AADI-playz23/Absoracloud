# workers/kaggle_devbox/kaggle_runner.py
# AbsoraCloud Devbox Cloud IDE — Kaggle Tesla P100 / Dual T4 x2 ZeroGPU Engine

import os
import sys
import time
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

RENDER_SERVER_URL = os.environ.get("RENDER_SERVER_URL", "https://absoracloud.onrender.com")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "kaggle_zerogpu_token_secure_88")
USER_ID = os.environ.get("TARGET_USER_ID", "usr_demo_devbox")
GPU_TYPE = os.environ.get("GPU_TYPE", "Tesla P100 (16GB VRAM) / Dual T4 (32GB VRAM)")

def push_devbox_session(session_url):
    payload = {
        "user_id": USER_ID,
        "service_type": "devbox",
        "session_url": session_url,
        "runner_token": WORKER_TOKEN,
        "hardware_specs": f"ZeroGPU AI Cloud IDE — {GPU_TYPE}"
    }
    try:
        res = requests.post(f"{RENDER_SERVER_URL}/api/worker/push_session", json=payload, timeout=10)
        print(f"[Devbox ZeroGPU] Session Pushed: {res.status_code} {res.text}")
    except Exception as e:
        print(f"[Devbox ZeroGPU] Error pushing session URL: {e}")

def main():
    print("=" * 60)
    print("[Devbox ZeroGPU] AbsoraCloud ZeroGPU Devbox Engine Initializing...")
    print(f"   Hardware: Kaggle Notebook Runtime — {GPU_TYPE}")
    print("=" * 60)

    session_url = f"https://devbox-zerogpu-{USER_ID}.absoracloud.qzz.io/execute"
    push_devbox_session(session_url)

    if os.environ.get("TEST_RUN") == "1":
        return

    while True:
        time.sleep(30)
        push_devbox_session(session_url)

if __name__ == "__main__":
    main()
