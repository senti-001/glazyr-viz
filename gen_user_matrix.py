import redis
import json

r = redis.from_url('rediss://big-oyster-39155.upstash.io:6379', 
                   password='AZjzAAIncDE2YzlkYWRjNzI5YjQ0NDFkOWY0ZTRkNDc0NGE0YWUxMHAxMzkxNTU', 
                   decode_responses=True)

# 1. Get all credit keys to find all "accounts"
credit_keys = r.keys('user:credits:*')
all_uids = [k.replace('user:credits:', '') for k in credit_keys]

print(f"Total credit accounts: {len(all_uids)}")

header = "| Name/Type | Email/IP | Provider | Frames Used | User ID |"
sep = "| :--- | :--- | :--- | :--- | :--- |"
rows = [header, sep]

user_count = 0
for uid in all_uids:
    # 2. Try to get profile
    profile_key = f"user:{uid}"
    val = r.get(profile_key)
    
    name = "Stateless User"
    email = uid if 'stateless' in uid else "N/A"
    provider = "Internal/Direct"
    
    if val and '{' in val:
        try:
            data = json.loads(val)
            name = data.get('name', 'N/A')
            email = data.get('email', 'N/A')
            image = data.get('image', '')
            if 'github' in image.lower() or 'github' in email.lower():
                provider = "GitHub"
            elif 'google' in image.lower() or 'google' in email.lower():
                provider = "Google"
        except:
            pass
            
    # 3. Get frame consumption
    balance = r.get(f"user:credits:{uid}")
    used = "0"
    if balance:
        try:
            used = f"{1000000 - int(balance):,}"
        except:
            used = f"N/A ({balance})"
            
    rows.append(f"| {name} | `{email}` | **{provider}** | {used} | `{uid[:8]}...` |")
    user_count += 1

with open('user_matrix.md', 'w', encoding='utf-8') as f:
    f.write("# Glazyr Full User Identity Matrix\n\n")
    f.write(f"Total Unique Accounts: **{user_count}**\n\n")
    f.write("\n".join(rows))

print(f"Successfully generated matrix for {user_count} accounts.")
