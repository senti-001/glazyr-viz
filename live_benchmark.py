"""
Glazyr Viz — Live MCP Benchmark v3
Uses sseclient-py for proper SSE event parsing.
"""
import json
import time
import requests
import threading
import sys
import sseclient

MCP_BASE = "http://localhost:4545"

def run_live_benchmark():
    post_url = None
    rpc_id = 0
    responses = {}
    connected = threading.Event()

    def sse_reader():
        nonlocal post_url
        try:
            resp = requests.get(f"{MCP_BASE}/mcp/sse", stream=True, headers={"Accept": "text/event-stream"})
            client = sseclient.SSEClient(resp)
            for event in client.events():
                if event.event == "endpoint":
                    post_url = f"{MCP_BASE}{event.data}"
                    connected.set()
                elif event.event == "message":
                    try:
                        msg = json.loads(event.data)
                        if "id" in msg:
                            responses[msg["id"]] = msg
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            print(f"SSE stream ended: {e}")

    t = threading.Thread(target=sse_reader, daemon=True)
    t.start()

    print("=" * 57)
    print("  GLAZYR VIZ — LIVE MCP BENCHMARK v3")
    print("  Empirical Vision Latency Measurement")
    print("=" * 57)
    print("\n1. Connecting to SSE transport at localhost:4545...")

    if not connected.wait(timeout=10):
        print("   X Failed to negotiate SSE session.")
        sys.exit(1)

    print(f"   OK Session: {post_url}")

    def rpc_call(method, params=None, timeout_s=30):
        nonlocal rpc_id
        rpc_id += 1
        msg_id = rpc_id
        msg = {"jsonrpc": "2.0", "id": msg_id, "method": method}
        if params:
            msg["params"] = params
        headers = {"Content-Type": "application/json"}
        try:
            r = requests.post(post_url, headers=headers, json=msg, timeout=5)
            print(f"   POST status: {r.status_code}")
        except Exception as e:
            print(f"   POST error: {e}")
            return None

        deadline = time.time() + timeout_s
        while msg_id not in responses:
            time.sleep(0.05)
            if time.time() > deadline:
                return None
        return responses[msg_id]

    # Initialize
    print("\n2. Initializing MCP protocol...")
    init_resp = rpc_call("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "GlazyrBench", "version": "1.0.0"}
    }, timeout_s=10)

    if not init_resp:
        print("   X Handshake timed out.")
        sys.exit(1)

    server_info = init_resp.get("result", {}).get("serverInfo", {})
    print(f"   OK Server: {server_info.get('name', '?')} v{server_info.get('version', '?')}")

    # Send initialized notification
    requests.post(post_url, headers={"Content-Type": "application/json"}, json={
        "jsonrpc": "2.0", "method": "notifications/initialized"
    }, timeout=5)

    # List tools
    print("\n3. Listing tools...")
    tools_resp = rpc_call("tools/list", timeout_s=10)
    if tools_resp and "result" in tools_resp:
        for tool in tools_resp["result"].get("tools", []):
            print(f"   - {tool['name']}")
    else:
        print("   X Could not list tools.")

    # Benchmark
    targets = ["https://example.com", "https://httpbin.org/html"]
    results = []

    print(f"\n4. Running shm_vision_validate on {len(targets)} targets...")
    print("-" * 57)

    for idx, url in enumerate(targets):
        print(f"\n   [{idx+1}/{len(targets)}] {url}")
        t_start = time.perf_counter()
        resp = rpc_call("tools/call", {
            "name": "shm_vision_validate",
            "arguments": {"url": url}
        }, timeout_s=60)
        elapsed_ms = (time.perf_counter() - t_start) * 1000

        if resp and "result" in resp:
            content = resp["result"].get("content", [])
            is_err = resp["result"].get("isError", False)
            text = "".join(c.get("text", "") for c in content)
            text_bytes = len(text.encode("utf-8"))
            if is_err:
                print(f"       X Tool error: {text[:200]}")
                results.append({"url": url, "ok": False, "ms": elapsed_ms, "bytes": 0})
            else:
                print(f"       OK {text_bytes} bytes extracted")
                print(f"       Latency: {elapsed_ms:.1f} ms")
                preview = text[:150].replace("\n", " ")
                print(f"       Preview: {preview}...")
                results.append({"url": url, "ok": True, "ms": elapsed_ms, "bytes": text_bytes})
        else:
            print(f"       X Timeout ({elapsed_ms:.0f}ms)")
            results.append({"url": url, "ok": False, "ms": elapsed_ms, "bytes": 0})

    # Summary
    print("\n" + "=" * 57)
    print("  EMPIRICAL RESULTS")
    print("=" * 57)
    ok = [r for r in results if r["ok"]]
    if ok:
        avg_ms = sum(r["ms"] for r in ok) / len(ok)
        total_bytes = sum(r["bytes"] for r in ok)
        print(f"  Captures    : {len(ok)}/{len(results)}")
        print(f"  Avg Latency : {avg_ms:.1f} ms")
        print(f"  Total Bytes : {total_bytes}")
        if avg_ms > 0:
            print(f"  Implied TPS : {1000/avg_ms:.2f}")
    else:
        print("  No successful captures.")

    for r in results:
        sym = "OK" if r["ok"] else "X"
        print(f"  {sym} {r['url']}  ->  {r['ms']:.0f}ms  ({r['bytes']}B)")
    print("=" * 57)

if __name__ == "__main__":
    run_live_benchmark()
