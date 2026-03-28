import redis
import json

r = redis.from_url('rediss://big-oyster-39155.upstash.io:6379', 
                   password='AZjzAAIncDE2YzlkYWRjNzI5YjQ0NDFkOWY0ZTRkNDc0NGE0YWUxMHAxMzkxNTU', 
                   decode_responses=True)

keys = r.keys('user:*')
credit_keys = r.keys('user:credits:*')

with open('user_list_raw.txt', 'w', encoding='utf-8') as f:
    f.write("--- 🕵️ USER IDENTITY LIST (LINE-SEPARATED) ---\n\n")
    
    # 1. Profiles
    f.write("## Authenticated User Profiles\n")
    for k in keys:
        if r.type(k) != 'string': continue
        val = r.get(k)
        if not val or '{' not in val or 'email' not in val: continue
        try:
            data = json.loads(val)
            name = data.get('name', 'N/A')
            email = data.get('email', 'N/A')
            f.write(f"{name} <{email}>\n")
        except:
            continue
            
    # 2. Credits/Stateless
    f.write("\n## Active Credit Accounts (Usage)\n")
    for k in credit_keys:
        uid = k.replace('user:credits:', '')
        balance = r.get(k)
        used = "0"
        try:
            used = f"{1000000 - int(balance):,}"
        except:
            used = f"N/A ({balance})"
        f.write(f"{uid} : {used} frames consumed\n")

print("Generated user_list_raw.txt (UTF-8)")
