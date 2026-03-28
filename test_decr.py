import os

url = os.getenv("REDIS_URL", "https://big-oyster-39155.upstash.io")
token = os.getenv("REDIS_TOKEN")
userId = "4c519c22-4dc1-42d1-8295-2d7065e0bbed"
key = f"user:credits:{userId}"

def redis_cmd(cmd):
    headers = {"Authorization": f"Bearer {token}"}
    return requests.post(url, headers=headers, json=cmd).json()

print(f"1. Current value: {redis_cmd(['GET', key])}")
print(f"2. Triggering DECR...")
decr_res = redis_cmd(["DECR", key])
print(f"DECR result: {decr_res}")
print(f"3. Value after DECR: {redis_cmd(['GET', key])}")
