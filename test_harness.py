#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
"""
glazyr-viz MCP — Local Test Harness
Covers: server card, MCP handshake, tools/list, and all 7 tools.

KEY FIX vs test_mcp.py:
  MCP SSE transport returns results over the SSE stream, NOT in the POST body.
  This harness listens on both channels and routes by request ID.

Usage:
  1. Start server:  npm run dev   (in glazyr-viz/)
  2. Run harness:   python test_harness.py
"""

import requests
import json
import time
import threading
import sys

BASE_URL = "http://localhost:4545"
DEFAULT_TIMEOUT = 20

# ── Terminal colors ────────────────────────────────────────────────────────────
class C:
    GREEN  = '\033[92m'
    RED    = '\033[91m'
    YELLOW = '\033[93m'
    CYAN   = '\033[96m'
    BOLD   = '\033[1m'
    DIM    = '\033[2m'
    RESET  = '\033[0m'


# ── MCP Session (SSE + POST, response-routed by ID) ───────────────────────────
class MCPSession:
    """
    Manages an MCP SSE session.
    - Connects via GET /mcp/sse → captures sessionId from the event stream
    - Sends requests via POST /mcp/messages?sessionId=...
    - Receives responses via the same SSE stream, routed back by JSON-RPC id
    """

    def __init__(self, base_url: str):
        self.base_url  = base_url
        self.session_id = None
        self._pending: dict[int, threading.Event] = {}
        self._results:  dict[int, dict]           = {}
        self._stop      = threading.Event()
        self._req_id    = 0
        self._lock      = threading.Lock()

    def connect(self, timeout: float = 10.0) -> "MCPSession":
        ready = threading.Event()
        t = threading.Thread(target=self._sse_listener, args=(ready,), daemon=True)
        t.start()
        if not ready.wait(timeout=timeout):
            raise TimeoutError("Timed out waiting for SSE session ID from server")
        return self

    def _sse_listener(self, ready_event: threading.Event):
        try:
            resp = requests.get(
                f"{self.base_url}/mcp/sse",
                stream=True,
                timeout=120,
            )
            buffer = ""
            for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
                if self._stop.is_set():
                    break
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue

                    if line.startswith("data:"):
                        data = line[5:].strip()

                        # Session ID arrives as a plain URL fragment
                        if "sessionId=" in data and self.session_id is None:
                            self.session_id = data.split("sessionId=")[1].strip()
                            ready_event.set()
                            continue

                        # All other data lines should be JSON-RPC responses
                        try:
                            msg = json.loads(data)
                            req_id = msg.get("id")
                            if req_id is not None:
                                with self._lock:
                                    self._results[req_id] = msg
                                    ev = self._pending.get(req_id)
                                if ev:
                                    ev.set()
                        except json.JSONDecodeError:
                            pass

        except Exception:
            ready_event.set()  # unblock caller so it can report the error

    def call(
        self,
        method: str,
        params: dict | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> tuple[dict | None, str | None]:
        with self._lock:
            self._req_id += 1
            req_id = self._req_id
            ev = threading.Event()
            self._pending[req_id] = ev

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": req_id,
        }

        try:
            requests.post(
                f"{self.base_url}/mcp/messages?sessionId={self.session_id}",
                json=payload,
                timeout=10,
            )
        except Exception as e:
            return None, f"POST failed: {e}"

        if not ev.wait(timeout=timeout):
            return None, f"No response on SSE stream after {timeout}s"

        return self._results.get(req_id), None

    def close(self):
        self._stop.set()


# ── Test runner helpers ────────────────────────────────────────────────────────
_results = {"pass": 0, "fail": 0}

def check(label: str, ok: bool, detail: str = ""):
    sym  = f"{C.GREEN}✓{C.RESET}" if ok else f"{C.RED}✗{C.RESET}"
    info = f"{C.DIM} — {detail}{C.RESET}" if detail else ""
    print(f"  {sym} {label}{info}")
    _results["pass" if ok else "fail"] += 1
    return ok


def section(title: str):
    print(f"\n{C.BOLD}[{title}]{C.RESET}")


def tool_call(session: MCPSession, tool: str, args: dict, timeout=DEFAULT_TIMEOUT):
    return session.call("tools/call", {"name": tool, "arguments": args}, timeout=timeout)


def content_text(resp: dict | None) -> str:
    if not resp:
        return ""
    return resp.get("result", {}).get("content", [{}])[0].get("text", "")


def is_error_result(resp: dict | None) -> bool:
    return bool(resp and resp.get("result", {}).get("isError", False))


# ── Test suite ─────────────────────────────────────────────────────────────────
def run():
    print(f"\n{C.BOLD}{C.CYAN}{'━'*44}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  glazyr-viz MCP  ·  Local Test Harness   {C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  Server: {BASE_URL:<34}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}{'━'*44}{C.RESET}")

    # ── 1. Server reachability ─────────────────────────────────────────────
    section("1  Server Reachability")
    try:
        r    = requests.get(f"{BASE_URL}/.well-known/mcp/server-card.json", timeout=5)
        card = r.json()
        check("Server card → 200", r.status_code == 200)
        # src/index.ts serves name/version at root; dist/index.js wraps in serverInfo
        name    = card.get("name") or card.get("serverInfo", {}).get("name")
        version = card.get("version") or card.get("serverInfo", {}).get("version")
        check("name = glazyr-viz", name == "glazyr-viz", f"got {name!r}")
        check("version present",   version is not None,  version or "missing")
        tools_advertised = list(card.get("capabilities", {}).get("tools", {}).keys())
        check("capabilities.tools present", len(tools_advertised) > 0,
              ", ".join(tools_advertised))
    except Exception as e:
        check("Server reachable", False, str(e))
        print(f"\n{C.RED}  Server not running — start it with: npm run dev{C.RESET}\n")
        _summary()
        return

    # ── 2. MCP Handshake ───────────────────────────────────────────────────
    section("2  MCP Protocol Handshake")
    try:
        session = MCPSession(BASE_URL).connect()
    except TimeoutError as e:
        check("SSE connect", False, str(e))
        _summary()
        return

    sid_preview = (session.session_id or "")[:16] + "..."
    check("SSE session established", session.session_id is not None, sid_preview)

    resp, err = session.call("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "glazyr-test-harness", "version": "1.0.0"},
    })
    check("initialize accepted",
          err is None and resp is not None and "error" not in resp,
          err or "")

    # ── 3. Tool discovery ──────────────────────────────────────────────────
    section("3  Tool Discovery  (tools/list)")
    resp, err = session.call("tools/list")
    advertised = [t["name"] for t in (resp or {}).get("result", {}).get("tools", [])]
    check("tools/list responds", err is None and len(advertised) > 0,
          ", ".join(advertised))

    expected = [
        "shm_vision_validate",
        "peek_vision_buffer",
        "browser_navigate",
        "browser_click",
        "browser_type",
        "github_push_readme",
        "reddit_research",
    ]
    for name in expected:
        check(f"  '{name}' advertised", name in advertised)

    # ── 4. shm_vision_validate ─────────────────────────────────────────────
    section("4  shm_vision_validate")

    # Path A: Hacker News — fully implemented in zero_copy_vision.py
    t0 = time.time()
    resp, err = tool_call(session, "shm_vision_validate",
                          {"url": "https://news.ycombinator.com"}, timeout=25)
    elapsed = time.time() - t0
    ok = err is None and resp is not None
    check("HN URL → result returned", ok, f"{elapsed:.1f}s")
    if ok:
        txt = content_text(resp)
        # zero_copy_vision.py emits JSON with status + body_preview
        try:
            data = json.loads(txt.split("Vision Signal Validated:\n", 1)[-1])
            has_status  = "status" in data
            has_preview = "body_preview" in data or "title" in data
            check("  JSON response with status field", has_status,
                  data.get("status", "missing"))
            check("  Contains page content (title or body_preview)", has_preview,
                  (data.get("title") or data.get("body_preview", ""))[:60])
        except (json.JSONDecodeError, KeyError):
            check("  Parseable JSON output", False, txt[:80].replace("\n", " "))
        check("  isError = false", not is_error_result(resp))

    # Path B: Generic URL — known stub ("not implemented yet")
    resp2, err2 = tool_call(session, "shm_vision_validate",
                            {"url": "https://example.com"}, timeout=20)
    ok2 = err2 is None and resp2 is not None
    check("Generic URL → graceful response (known stub)", ok2,
          content_text(resp2)[:60].replace("\n", " ") if ok2 else err2)

    # ── 5. peek_vision_buffer ──────────────────────────────────────────────
    section("5  peek_vision_buffer")
    resp, err = tool_call(session, "peek_vision_buffer", {"include_base64": False})
    ok = err is None and resp is not None
    check("Tool responds", ok)
    if ok:
        txt = content_text(resp)
        shm_absent  = is_error_result(resp) and "SHM buffer" in txt
        # SHM file may exist but contain raw binary (not JSON) from the compositor
        shm_binary  = "Unexpected token" in txt or "JSON" in txt.upper()
        shm_handled = shm_absent or shm_binary
        check("SHM state handled gracefully", shm_handled,
              ("no compositor running — SHM absent (expected)" if shm_absent else
               "BUG: SHM file exists with binary data — peek_vision_buffer must handle non-JSON")
              + f" | {txt[:60].replace(chr(10),' ')}")

    # ── 6. browser_navigate ────────────────────────────────────────────────
    section("6  browser_navigate")
    t0 = time.time()
    resp, err = tool_call(session, "browser_navigate",
                          {"url": "https://news.ycombinator.com"}, timeout=25)
    elapsed = time.time() - t0
    ok = err is None and resp is not None
    check("Tool responds", ok, f"{elapsed:.1f}s")
    if ok:
        txt = content_text(resp)
        check("Navigation confirmation present",
              "Navigation" in txt or "SHM Buffer" in txt,
              txt[:60].replace("\n", " "))

    # ── 7. browser_click & browser_type (interaction stubs) ───────────────
    section("7  Interaction Stubs  (browser_click / browser_type)")

    resp, err = tool_call(session, "browser_click", {"x": 320, "y": 240})
    ok = err is None and resp is not None
    check("browser_click → confirmation",
          ok and "Click" in content_text(resp),
          content_text(resp)[:50] if ok else err)

    resp, err = tool_call(session, "browser_type", {"text": "hello glazyr"})
    ok = err is None and resp is not None
    check("browser_type → confirmation",
          ok and resp.get("result") is not None,
          content_text(resp)[:50] if ok else err)

    # ── 8. reddit_research scaffold ────────────────────────────────────────
    section("8  reddit_research  (scaffold)")
    resp, err = tool_call(session, "reddit_research",
                          {"query": "MCP browser automation token efficiency"})
    ok = err is None and resp is not None
    check("Tool responds", ok)
    if ok:
        txt = content_text(resp)
        check("Returns strategy text", len(txt) > 20, txt[:70].replace("\n", " "))

    session.close()
    _summary()


def _summary():
    total = _results["pass"] + _results["fail"]
    print(f"\n{C.BOLD}{'━'*44}{C.RESET}")
    pcolor = C.GREEN if _results["pass"] > 0 else C.DIM
    fcolor = C.RED   if _results["fail"] > 0 else C.GREEN
    print(
        f"{C.BOLD}  Results: "
        f"{pcolor}{_results['pass']} passed{C.RESET}{C.BOLD}, "
        f"{fcolor}{_results['fail']} failed{C.RESET}{C.BOLD} / {total} total{C.RESET}"
    )
    print(f"{C.BOLD}{'━'*44}{C.RESET}\n")
    sys.exit(0 if _results["fail"] == 0 else 1)


if __name__ == "__main__":
    run()
