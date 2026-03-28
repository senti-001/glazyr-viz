import requests
import json
import uuid
import sys

# Production Endpoint
url = "http://136.113.105.70:4545/mcp/messages"

# If user provided a token from the dashboard, use it. Otherwise use a fresh one.
session_id = sys.argv[1] if len(sys.argv) > 1 else f"sentinel-verified-{uuid.uuid4().hex[:6]}"

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {session_id}"
}

def call_mcp(method_name, args={}):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": method_name,
            "arguments": args
        }
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()
        if "result" in data:
            return data["result"]
        return data
    except Exception as e:
        status_code = getattr(e.response, 'status_code', 'N/A') if hasattr(e, 'response') and e.response else 'N/A'
        return {"error": str(e), "status_code": status_code}

print(f"[*] Target Session: {session_id}")
if len(sys.argv) <= 1:
    print("[!] NO TOKEN PROVIDED: Creating a fresh 1M credit session for this test...")

# Step 1: Check Initial Balance
print("\n[1] Checking Initial Balance...")
initial = call_mcp("get_remaining_credits")
if "content" in initial:
    print(f"Result: {initial['content'][0]['text']}")
else:
    print(f"Unexpected Response: {json.dumps(initial, indent=2)}")
    sys.exit(1)

# Step 2: Trigger a Perception (Consumes 1 Credit)
print("\n[2] Triggering Perception (peek_vision_buffer)...")
perception = call_mcp("peek_vision_buffer", {"include_base64": False})
if "isError" in perception and perception["isError"]:
    print(f"Vision Error: {perception['content'][0]['text']}")
else:
    print("✅ Perception call successful.")

# Step 3: Check Final Balance
print("\n[3] Checking Final Balance...")
final = call_mcp("get_remaining_credits")
if "content" in final:
    print(f"Result: {final['content'][0]['text']}")
else:
    print(f"Unexpected Response: {json.dumps(final, indent=2)}")
