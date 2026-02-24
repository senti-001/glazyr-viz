import requests
import json
import time
import threading

def sse_listener(url, session_info):
    try:
        response = requests.get(url, stream=True, timeout=30)
        for line in response.iter_lines():
            if not line: continue
            line = line.decode('utf-8')
            if "sessionId=" in line:
                session_info['sessionId'] = line.split("sessionId=")[1].strip()
                session_info['ready'].set()
            if session_info['stop'].is_set():
                break
    except Exception as e:
        print(f"SSE Error: {e}")

def test_mcp():
    base_url = "http://localhost:4545"
    sse_url = f"{base_url}/mcp/sse"
    
    session_info = {
        'sessionId': None,
        'ready': threading.Event(),
        'stop': threading.Event()
    }
    
    print(f"Connecting to SSE at {sse_url}...")
    t = threading.Thread(target=sse_listener, args=(sse_url, session_info), daemon=True)
    t.start()
    
    if not session_info['ready'].wait(timeout=10):
        print("Timeout waiting for session ID")
        session_info['stop'].set()
        return

    session_id = session_info['sessionId']
    print(f"Captured Session ID: {session_id}")
    
    message_url = f"{base_url}/mcp/messages?sessionId={session_id}"
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "shm_vision_validate",
            "arguments": {
                "url": "https://www.google.com"
            }
        },
        "id": 1
    }
    
    print(f"Sending tool call to {message_url}...")
    try:
        post_response = requests.post(message_url, json=payload, timeout=15)
        print(f"Status Code: {post_response.status_code}")
        print(f"Response: {post_response.text}")
    except Exception as e:
        print(f"POST Error: {e}")
    
    session_info['stop'].set()
    time.sleep(1)

if __name__ == "__main__":
    test_mcp()
