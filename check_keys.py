import os

url = os.getenv("REDIS_URL", "https://big-oyster-39155.upstash.io")
token = os.getenv("REDIS_TOKEN")

def redis_cmd(cmd):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(url, headers=headers, json=cmd)
    return response.json()

# Check the dashboard User ID key
user_id = "4c519c22-4dc1-42d1-8295-2d7065e0bbed"
token_key = "081cb0f6-db00-4dbb-872d-e478a9697d17"

print(f"Dashboard Key (user:credits:{user_id[:8]}...):")
print(f"  -> {redis_cmd(['GET', f'user:credits:{user_id}'])}")

print(f"\nOrphaned Token Key (user:credits:{token_key[:8]}...):")
print(f"  -> {redis_cmd(['GET', f'user:credits:{token_key}'])}")
