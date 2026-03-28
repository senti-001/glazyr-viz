import redis
import json
import time

# Upstash Redis from prod.env
REDIS_URL = "rediss://big-oyster-39155.upstash.io:6379"
REDIS_TOKEN = "AZjzAAIncDE2YzlkYWRjNzI5YjQ0NDFkOWY0ZTRkNDc0NGE0YWUxMHAxMzkxNTU"

try:
    print(f"Connecting to Upstash Redis...")
    r = redis.from_url(REDIS_URL, password=REDIS_TOKEN, decode_responses=True)
    
    key = "glazyr:viz:latest_telemetry"
    raw = r.get(key)
    
    if raw:
        data = json.loads(raw)
        server_time = data.get("server_time", 0)
        ts_us = data.get("timestamp_us", 0)
        now = time.time()
        
        # 1. End-To-End Latency (App to Redis)
        e2e_latency = (now - server_time) * 1000
        
        # 2. Vision Pipeline Latency (Hardware to Local Buffer)
        # Note: timestamp_us is from SHM header.
        # This is harder to measure from here since we don't know the remote clock sync.
        # But we can look at the sequence index and FPS.
        
        print(f"\n--- 🧠 GLAZYR VIZ: PRECISION AUDIT ---")
        print(f"Frame Index: {data.get('frame_index')}")
        print(f"FPS: {data.get('fps')}")
        print(f"Status: {data.get('status')}")
        print(f"Throughput: {data.get('shm_throughput')}")
        print(f"Server Time (GCP): {server_time}")
        print(f"Arrival Time (MC): {now}")
        print(f"Network Latency: {e2e_latency:.2f} ms")
        
        if ts_us > 0:
            print(f"Hardare Timestamp (US): {ts_us}")
        
        print(f"--------------------------------------")
        
        if e2e_latency < 500:
            print("✅ Telemetry Stream: STABLE")
        else:
            print("⚠️ Telemetry Stream: HIGH JITTER")
            
    else:
        print("No active telemetry stream found in Redis.")
        
except Exception as e:
    print(f"Error: {e}")
