import os

upstash_url = os.getenv("REDIS_URL", "https://big-oyster-39155.upstash.io")
upstash_token = os.getenv("REDIS_TOKEN")
mcp_url = os.getenv("MCP_URL", "http://136.113.105.70:4545/mcp/messages")

def redis_cmd(cmd):
    headers = {"Authorization": f"Bearer {upstash_token}"}
    return requests.post(upstash_url, headers=headers, json=cmd).json()

session_token = "081cb0f6-db00-4dbb-872d-e478a9697d17"
user_id = "4c519c22-4dc1-42d1-8295-2d7065e0bbed"

# 1. Show the session resolver result
print("=== PRE-FLIGHT ===")
session = redis_cmd(["GET", f"user:session:{session_token}"])
print(f"Session (user:session:{session_token[:8]}...): {session}")

balance_before = redis_cmd(["GET", f"user:credits:{user_id}"])
print(f"Balance BEFORE (user:credits:{user_id[:8]}...): {balance_before}")

# 2. Trigger a tool call via MCP
print("\n=== TOOL CALL ===")
headers = {"Content-Type": "application/json", "Authorization": f"Bearer {session_token}"}
payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "peek_vision_buffer", "arguments": {"include_base64": False}}}
res = requests.post(mcp_url, json=payload, headers=headers, timeout=15)
print(f"MCP Response: {res.status_code} - {res.text[:200]}")

# 3. Check the balance again
print("\n=== POST-FLIGHT ===")
balance_after = redis_cmd(["GET", f"user:credits:{user_id}"])
print(f"Balance AFTER (user:credits:{user_id[:8]}...): {balance_after}")

before_val = int(balance_before.get("result", 0) or 0)
after_val = int(balance_after.get("result", 0) or 0)
delta = before_val - after_val
print(f"\n{'✅ DEDUCTED' if delta > 0 else '❌ NOT DEDUCTED'}: Delta = {delta}")
