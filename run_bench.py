import requests
import json
import uuid

url = "http://136.113.105.70:4545/mcp/messages"
# Use a fresh UUID to trigger the auto-grant logic in consumeCredit
session_id = f"sentinel-victory-{uuid.uuid4().hex[:8]}"
payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "run_dogfood_surge",
        "arguments": {}
    }
}
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {session_id}"
}

try:
    print(f"[*] Sending benchmark request to {url} with session {session_id}...")
    response = requests.post(url, json=payload, headers=headers, timeout=60)
    print(f"[*] Response Status: {response.status_code}")
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    print(f"[*] Error: {e}")
