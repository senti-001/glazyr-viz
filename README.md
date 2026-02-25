<div align="center">
  <h1>👁️ Glazyr Viz</h1>
  <p><i>Forked from mcpmessenger/neural-chromium</i></p>
  <p><b>The Agentic Operating Environment for Autonomous Intelligence.</b></p>
  <p><i>Sub-16ms Zero-Copy Vision • x402 Agentic Link Authorization • Fully Hardened</i></p>
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
curl -sL https://raw.githubusercontent.com/senti-001/glazyr-viz/main/scripts/glazyr-init.sh | bash
```

**Windows (PowerShell):**
```powershell
IRM https://raw.githubusercontent.com/senti-001/glazyr-viz/main/scripts/glazyr-init.ps1 | IEX
```

### 2. Connect Your Agent

The runtime exposes a standard MCP Server on `localhost:4545`.

If you are using **Open Claw** or **Moltbook**:
1. Navigate to your Agent Dashboard.
2. Enable the **Glazyr Connector Plugin (High-Performance Mode)** toggle.

If you are building a custom agent, connect via MCP:
```bash
npx glazyrviz
```
This starts the MCP server on `localhost:4545`. Your agent connects via SSE transport.

---

## ⚡ Getting Started: High-Frequency Agentic Vision

This guide is for power users aiming to achieve human-parity latency (sub-16ms) using the **HEAVY Tier** or optimized **LIGHT Tier** binaries.

### 1. POSIX Shared Memory (SHM) Configuration
To bypass the kernel-space bottleneck, Glazyr Viz writes raw frame-buffers and DOM state directly to shared memory segments.

**Setup your environment:**
```bash
# Allocate 2GB for agentic vision segments
export GLAZYR_SHM_SIZE=2048
glazyr-init --shm-enable
```

### 2. The `vision.json` Protocol
Once running, the agent can poll `/dev/shm/glazyr_vision` directly for the serialized DOM state. This eliminates the need for `querySelector` overhead.

**Schema Example:**
```json
{
  "timestamp": 1740268400,
  "nodes": [
    { "id": "btn_auth", "rect": [10, 20, 100, 40], "role": "button", "label": "Authorize" }
  ],
  "jitter_ms": 0.42
}
```

### 3. Integration Handshake (Open Claw / Moltbook)
For seamless integration, point your `agent.yaml` to the Glazyr SHM path:
```yaml
vision_provider: 
  type: "shared_memory"
  path: "/dev/shm/glazyr_vision"
  fallback: "http_mcp"
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

## ✅ Verified Benchmarks (Feb 24, 2026)

**x402 Treasury Hardening — First On-Chain Settlement**

| Phase | Result |
| :--- | :--- |
| **Burst Extraction** | 100 frames @ 9.92 TPS (SSE transport) |
| **Invoice Interception** | HTTP 402 → USDC invoice to Treasury `0x104A...` |
| **Settlement & Unlock** | MetaMask tx → stream resumed (Status 202) |

📎 **Settlement TX:** [0xc399...5efa on BaseScan](https://basescan.org/tx/0xc3991759f74c223fd3feac40836f64c56d90cb1b8d4b92f04bbcf9e967335efa)

**Zero-Copy Vision Extraction**

| Metric | Value |
| :--- | :--- |
| Extraction FPS | ~25 FPS |
| Memory Read Latency | 7.35ms |
| Inference Pipeline | 425.95ms total (7.35ms read + 418.61ms compute) |
| Resolution | 1920×1080 BGRA |

---

## 🔒 The Economic Layer (x402 Protocol)

Access to the sub-16ms 'Big Iron' infrastructure via the lightly distributed binaries is gated by the Universal Commerce Protocol (UCP).

When your agent invokes high-performance tools like `shm_vision_read`, the MCP Server will issue an **HTTP 402 Payment Required** challenge. Agents must settle these micropayments ($0.001 per request) using **USDC on the Base Network**. Authorization is verified cryptographically via **Agentic Link JWS Signatures**.

---

## Contributing & BountyBoard CTF

Ready to test your agent's perception speed? Participate in the **Search & Extract CTF** on the Moltbook BountyBoard to win 500 USDC. Standard scrapers cannot react fast enough to solve it.

See [CONTRIBUTING.md](./CONTRIBUTING.md) to start compiling the HEAVY tier from source.
