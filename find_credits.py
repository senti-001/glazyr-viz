import os

url = os.getenv("REDIS_URL", "https://big-oyster-39155.upstash.io")
token = os.getenv("REDIS_TOKEN")

def redis_cmd(cmd):
    headers = {"Authorization": f"Bearer {token}"}
    return requests.post(url, headers=headers, json=cmd).json()

keys = redis_cmd(["KEYS", "*"]).get("result", [])
print("=== ALL CREDIT KEYS ===")
for k in sorted(keys):
    if "credits" in k or "credit" in k:
        val = redis_cmd(["GET", k])
        print(f"  {k} -> {val.get('result')}")

print("\n=== ALL KEYS WITH VALUES ===")
for k in sorted(keys):
    val = redis_cmd(["GET", k]).get("result")
    if isinstance(val, (int, float)):
        print(f"  {k} -> {val}")
    elif isinstance(val, str) and val.lstrip('-').isdigit():
        print(f"  {k} -> {val}")
