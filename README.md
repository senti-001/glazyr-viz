<div align="center">
  <h1>👁️ Glazyr Viz</h1>
  <p><b>The Sovereign Operating Environment for Agentic Intelligence.</b></p>
  <p><i>Sub-16ms Zero-Copy Vision • x402 SovereignLink Authorization • Fully Hardened</i></p>
</div>

---

## The "Last Mile" Bottleneck is Solved.

Traditional browser automation (Selenium, Playwright) is plagued by the "Capture-Encode-Transmit" loop, causing latency jitter up to 2.3 seconds. This makes real-time, high-dynamic interactions impossible for AI agents.

**Glazyr Viz** is a structural fork of Chromium that integrates your agent *directly* into the rendering compositor via POSIX Shared Memory.

- **Human-Parity Reaction Times:** 1-frame (16ms) visual perception synchronization.
- **Intelligence Yield:** Delivers structured DOM state directly as `vision.json`, eliminating OCR/Encoding overhead.
- **Hardened Execution:** Runs untrusted scraper code inside a 4GB V8 Virtual Memory Cage.

---

## Zero-Configuration Installation (LIGHT Tier)

For rapid deployment and edge performance, we provide a pre-compiled, hardened 294MB binary (The **LIGHT Tier**). 

You do **not** need to compile Chromium from source to use Glazyr Viz. 

### 1. Initialize the Runtime

Use our zero-config scripts to automatically verify your environment, download the binary, initialize the Shared Memory (SHM) segments, and launch the Model Context Protocol (MCP) server.

**Linux / macOS:**
```bash
curl -sL https://raw.githubusercontent.com/project-nexus-v2/glazyr-viz/main/scripts/glazyr-init.sh | bash
```

**Windows (PowerShell):**
```powershell
IRM https://raw.githubusercontent.com/project-nexus-v2/glazyr-viz/main/scripts/glazyr-init.ps1 | IEX
```

### 2. Connect Your Agent

The runtime exposes a standard MCP Server on `localhost:4545`.

If you are using **Open Claw** or **Moltbook**:
1. Navigate to your Agent Dashboard.
2. Enable the **Glazyr Connector Plugin (High-Performance Mode)** toggle.

If you are building a custom agent, install the SDK:
```bash
npm install @glazyr/sdk
# or
pip install glazyr-sdk
```

---

## Architecture: LIGHT vs HEAVY Tiers

| Feature | LIGHT Tier (Pre-compiled) | HEAVY Tier (Compile from Source) |
| :--- | :--- | :--- |
| **Size** | 294 MB | 600+ MB |
| **Use Case** | Edge Deployment, Open Claw Agents | High-Performance Research, Core Dev |
| **Setup** | 1 command (`glazyr-init`) | Requires Clang 19.x & ThinLTO |
| **x402 Requirement**| Requires USDC micropayment | Unrestricted (Self-Hosted) |

---

## 🔒 The Economic Layer (x402 Protocol)

Access to the sub-16ms 'Big Iron' infrastructure via the lightly distributed binaries is gated by the Universal Commerce Protocol (UCP).

When your agent invokes high-performance tools like `shm_vision_read`, the MCP Server will issue an **HTTP 402 Payment Required** challenge. Agents must settle these micropayments ($0.001 per request) using **USDC on the Base Network**. Authorization is verified cryptographically via **SovereignLink JWS Signatures**.

---

## Contributing & BountyBoard CTF

Ready to test your agent's perception speed? Participate in the **Search & Extract CTF** on the Moltbook BountyBoard to win 500 USDC. Standard scrapers cannot react fast enough to solve it.

See [CONTRIBUTING.md](./CONTRIBUTING.md) to start compiling the HEAVY tier from source.
