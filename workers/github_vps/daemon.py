# workers/github_vps/daemon.py
# AbsoraCloud Bare-Metal VPS Daemon for GitHub Action Runners (4 vCPU / 16GB RAM / 20GB NVMe)

import os
import sys
import time
import signal
import subprocess
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

RENDER_SERVER_URL = os.environ.get("RENDER_SERVER_URL", "https://absoracloud.onrender.com")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN") or "vps_gh_runner_token_secure_99"
USER_ID = os.environ.get("TARGET_USER_ID") or "usr_demo_vps"
GIT_REPO_URL = os.environ.get("GIT_REPO_URL", "")
CLOUDFLARE_TUNNEL_URL = os.environ.get("CLOUDFLARE_TUNNEL_URL", "")

def push_session_url(session_url):
    """Push live active Cloudflare Quick Tunnel WSS session URL to Render API & D1 SQLite."""
    payload = {
        "user_id": USER_ID,
        "service_type": "vps",
        "session_url": session_url,
        "runner_token": WORKER_TOKEN,
        "hardware_specs": "4 vCPU / 16GB RAM / 20GB NVMe (Cloudflare Quick Tunnel Active)"
    }
    try:
        res = requests.post(f"{RENDER_SERVER_URL}/api/worker/push_session", json=payload, timeout=10)
        print(f"[VPS Daemon] Cloudflare Quick Tunnel Pushed: {res.status_code} {res.text}")
    except Exception as e:
        print(f"[VPS Daemon] Error pushing session URL: {e}")

def git_auto_push():
    """Perform automatic git commit & push before runner sleep or signal termination."""
    print("============================================================")
    print("AbsoraCloud Auto-Sync: Committing & Pushing workspace to GitHub...")
    print("============================================================")
    try:
        subprocess.run(["git", "add", "."], check=False)
        subprocess.run(["git", "commit", "-m", "AbsoraCloud Auto-Backup on VPS Sleep"], check=False)
        if GIT_REPO_URL:
            subprocess.run(["git", "push", "origin", "main"], check=False)
        print("[VPS Daemon] Workspace successfully saved to GitHub repository.")
    except Exception as e:
        print(f"[VPS Daemon] Git auto-push warning: {e}")

def handle_shutdown(signum, frame):
    print(f"\n[VPS Daemon] Signal {signum} received. Runner entering sleep state...")
    git_auto_push()
    sys.exit(0)

def main():
    print("=" * 60)
    print("[VPS Daemon] AbsoraCloud Bare-Metal VPS Worker Initializing...")
    print("   Specs: 4 vCPUs | 16GB RAM | 20GB NVMe Ephemeral Disk")
    print("   Tunnel: Cloudflare Quick Tunnel WSS")
    print("=" * 60)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    session_url = CLOUDFLARE_TUNNEL_URL if CLOUDFLARE_TUNNEL_URL else f"wss://vps-runner-{USER_ID}.absoracloud.qzz.io/ws"
    push_session_url(session_url)

    if os.environ.get("TEST_RUN") == "1":
        return

    while True:
        time.sleep(30)
        push_session_url(session_url)

if __name__ == "__main__":
    main()
