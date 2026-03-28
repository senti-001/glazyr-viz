import redis
import json
import time

r = redis.from_url('rediss://big-oyster-39155.upstash.io:6379', 
                   password='AZjzAAIncDE2YzlkYWRjNzI5YjQ0NDFkOWY0ZTRkNDc0NGE0YWUxMHAxMzkxNTU', 
                   decode_responses=True)

print(f"--- 🕵️ USER ACTIVITY & CONSUMPTION AUDIT ---")
sessions = r.keys('user:session:*')
print(f"Active Sessions Found: {len(sessions)}")

# Check frame consumption
print(f"\n--- 💰 FRAME CONSUMPTION (BETA FREE) ---")
credits = r.keys('user:credits:*')
total_granted = 0
total_current = 0
active_users = 0

for c in credits:
    try:
        balance = int(r.get(c))
        # Beta users start at 1,000,000
        if balance <= 1000000:
            total_granted += 1000000
            total_current += balance
            if balance < 1000000:
                active_users += 1
                used = 1000000 - balance
                print(f"User: {c.replace('user:credits:', '')} | Used: {used} frames")
    except:
        continue

consumed = total_granted - total_current
print(f"\nTotal Active Users (Consuming Frames): {active_users}")
print(f"Total Framework Consumption: {consumed} frames")
print(f"------------------------------------------")
