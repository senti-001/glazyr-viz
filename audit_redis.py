import os

url = os.getenv("REDIS_URL", "https://big-oyster-39155.upstash.io")
token = os.getenv("REDIS_TOKEN")

def redis_cmd(cmd):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(url, headers=headers, json=cmd)
    return response.json()

print("=== FULL REDIS AUDIT ===\n")

# 1. Get ALL keys
keys_res = redis_cmd(["KEYS", "*"])
keys = keys_res.get("result", [])
print(f"Total Keys: {len(keys)}\n")

# 2. Dump every key with its type and value
for k in sorted(keys):
    val = redis_cmd(["GET", k]).get("result")
    # Truncate long values
    val_str = json.dumps(val) if not isinstance(val, str) else val
    if len(val_str) > 200:
        val_str = val_str[:200] + "..."
    print(f"  {k}")
    print(f"    -> {val_str}")
    print()
