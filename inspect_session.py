import os

url = os.getenv("REDIS_URL", "https://big-oyster-39155.upstash.io")
token = os.getenv("REDIS_TOKEN")

def redis_cmd(cmd):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(url, headers=headers, json=cmd)
    return response.json()

session_key = "session:081cb0f6-db00-4dbb-872d-e478a9697d17"
res = redis_cmd(["GET", session_key])
print(f"Session Key: {session_key}")
print(f"Content Type: {type(res.get('result'))}")
print(f"Content: {res.get('result')}")
