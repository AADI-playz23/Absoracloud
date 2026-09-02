// render_server/lib/orchestrator.js
// AbsoraCloud Container Packing Orchestrator for Bare-Metal VPS GitHub Action Runner Nodes

import dotenv from 'dotenv';
import { executeD1Query } from './d1.js';

dotenv.config();

const GITHUB_REPO = process.env.GITHUB_REPO || 'AADI-playz23/Absoracloud';
const HF_SPACE_ID = process.env.HF_SPACE_ID || 'AADI-playz23/absoracloud-game-node';

/**
 * VPS Container Packing Manager:
 * - Single GitHub Runner Machine = 4.0 vCPU / 16GB RAM Hardware Pool
 * - Free VPS Container = 0.5 vCPU / 4GB RAM
 * - Pro VPS Container = 1.5 vCPU / 8GB RAM
 * - Ultra VPS Container = 2.0 vCPU / 16GB RAM
 * 
 * If current active runner machine has vCPU capacity (used + req <= 4.0 vCPU), attach container to existing machine.
 * Otherwise, dispatch a NEW GitHub Action Runner Machine!
 */
export async function handleSmartVpsLaunch(userId, planTier = 'free', gitRepoUrl = '') {
  const reqVcpu = planTier === 'ultra' ? 2.0 : (planTier === 'pro' ? 1.5 : 0.5);
  console.log(`[Orchestrator] VPS Launch for ${userId} (${planTier} plan, requires ${reqVcpu} vCPU)`);

  try {
    // 1. Fetch all active VPS container sessions from Cloudflare D1
    const d1Sql = `SELECT * FROM session_urls WHERE service_type = 'vps' AND status = 'active' ORDER BY updated_at DESC;`;
    const d1Res = await executeD1Query(d1Sql);
    const activeSessions = d1Res.results || [];

    // 2. If user already has an active VPS container, connect to it
    const existingSession = activeSessions.find(s => s.user_id === userId);
    if (existingSession) {
      return {
        success: true,
        action: 'CONNECTED_EXISTING',
        session: existingSession,
        message: 'Connected to your existing active VPS container instance.'
      };
    }

    // 3. Calculate total used vCPU on active GitHub Runner machine
    const totalUsedVcpu = activeSessions.reduce((acc, s) => {
      const specs = (s.hardware_specs || '').toLowerCase();
      if (specs.includes('2.0 vcpu') || specs.includes('ultra')) return acc + 2.0;
      if (specs.includes('1.5 vcpu') || specs.includes('pro')) return acc + 1.5;
      return acc + 0.5;
    }, 0);

    console.log(`[Orchestrator] Current Active Machine vCPU Load: ${totalUsedVcpu} / 4.0 vCPU`);

    // 4. If current machine has capacity for this user's vCPU allocation (used + req <= 4.0)
    if (totalUsedVcpu + reqVcpu <= 4.0 && activeSessions.length > 0) {
      console.log(`[Orchestrator] Attaching container instance to active runner machine (${totalUsedVcpu + reqVcpu} / 4.0 vCPU)...`);
      return {
        success: true,
        action: 'ATTACHED_TO_ACTIVE_MACHINE',
        session: activeSessions[0],
        message: `VPS container instance allocated on active runner machine (${reqVcpu} vCPU assigned).`
      };
    }

    // 5. Machine full or no active machine: Dispatch a NEW GitHub Action Runner Machine
    console.log(`[Orchestrator] Machine capacity reached. Dispatching NEW GitHub Action Runner Machine (4.0 vCPU pool)...`);
    const dispatchRes = await triggerGitHubVpsRunner(userId, gitRepoUrl);
    return {
      success: true,
      action: 'DISPATCHED_NEW_RUNNER_MACHINE',
      dispatch: dispatchRes,
      message: `Provisioning new GitHub Action Runner Machine (${reqVcpu} vCPU container allocated). Establishing Cloudflare Quick Tunnel WSS...`
    };
  } catch (err) {
    console.error('[Orchestrator] Error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Dispatch GitHub Action VPS Runner Machine via GitHub REST API
 */
export async function triggerGitHubVpsRunner(userId, gitRepoUrl = '') {
  const token = process.env.GITHUB_TOKEN || process.env.GH_PAT;
  if (!token) {
    return { success: false, error: 'GITHUB_TOKEN environment variable missing' };
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/vps_runner.yml/dispatches`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AbsoraCloud-Render-Backend'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          target_user_id: userId,
          git_repo_url: gitRepoUrl
        }
      })
    });

    if (res.status === 204) {
      return { success: true, message: 'GitHub Action VPS runner machine dispatched successfully' };
    }
    const text = await res.text();
    return { success: false, status: res.status, error: text };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Dispatch Kaggle ZeroGPU Kernel via Kaggle API
 */
export async function triggerKaggleZeroGpuDevbox(userId) {
  const kaggleKey = process.env.KAGGLE_KEY;
  if (!kaggleKey) {
    return { success: false, error: 'KAGGLE_KEY environment variable missing' };
  }

  const url = 'https://www.kaggle.com/api/v1/kernels/push';
  try {
    const payload = {
      slug: `absoracloud-zerogpu-${userId.toLowerCase()}`,
      newTitle: `AbsoraCloud ZeroGPU Devbox ${userId}`,
      text: `import os\nos.environ['RENDER_SERVER_URL']='https://absoracloud.onrender.com'\nos.environ['TARGET_USER_ID']='${userId}'\nexec(open('workers/kaggle_devbox/kaggle_runner.py').read())`,
      language: 'python',
      kernelType: 'script',
      isPrivate: true,
      enableGpu: true,
      enableInternet: true,
      datasetDataSources: [],
      kernelDataSources: []
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`aadi:${kaggleKey}`).toString('base64')}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return { success: true, message: 'Kaggle ZeroGPU notebook kernel pushed successfully', data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check health & wake up Hugging Face Space Managed Game Cloud Node
 */
export async function wakeAndVerifyHfSpace(spaceId = HF_SPACE_ID) {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    return { success: false, error: 'HF_TOKEN environment variable missing' };
  }

  const statusUrl = `https://huggingface.co/api/spaces/${spaceId}`;
  const restartUrl = `https://huggingface.co/api/spaces/${spaceId}/restart`;

  try {
    const statusRes = await fetch(statusUrl, {
      headers: { 'Authorization': `Bearer ${hfToken}` }
    });
    const spaceData = await statusRes.json();
    const stage = spaceData?.runtime?.stage || 'UNKNOWN';

    if (stage === 'RUNNING') {
      return { success: true, status: 'RUNNING', space: spaceData };
    }

    const restartRes = await fetch(restartUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfToken}` }
    });
    const restartData = await restartRes.json();

    return {
      success: true,
      status: 'WAKING_UP',
      previousStage: stage,
      message: 'Hugging Face Space wake signal sent successfully',
      data: restartData
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
