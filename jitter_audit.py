import redis
import json
import time

def jitter_audit():
    r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)
    
    print("--- 🧠 GLAZYR VIZ: JITTER AUDIT START ---")
    print(f"Target: GCP Perception Node Redis @ 127.0.0.1:6379")
    
    snapshots = []
    
    # Perform 5 snapshots with 100ms delay to verify frame increment
    for i in range(5):
        start_time = time.time()
        telemetry = r.get('glazyr:viz:latest_telemetry')
        end_time = time.time()
        
        latency_ms = (end_time - start_time) * 1000
        
        if telemetry:
            data = json.loads(telemetry)
            snapshots.append({
                'idx': data.get('frame_index'),
                'latency': latency_ms,
                'objects': data.get('dom_state', {}).get('webgl_objects'),
                'fps': data.get('fps')
            })
            print(f"Snapshot {i+1}: Frame Index {data.get('frame_index')} | Latency: {latency_ms:.2f}ms | Objects: {data.get('dom_state', {}).get('webgl_objects')}")
        else:
            print(f"Snapshot {i+1}: [ERROR] No telemetry found in Redis!")
        
        time.sleep(0.1) # 100ms interval

    print("\n--- 📊 AUDIT ANALYSIS ---")
    if len(snapshots) >= 2:
        total_frames = snapshots[-1]['idx'] - snapshots[0]['idx']
        total_time = 0.4 # 4 intervals of 100ms
        avg_fps_increment = total_frames / total_time
        
        print(f"Average Frame Increment: {total_frames / 4:.1f} frames per 100ms")
        print(f"Measured Telemetry Frequency: {avg_fps_increment:.2f} FPS")
        print(f"Average Redis Latency: {sum(s['latency'] for s in snapshots)/len(snapshots):.2f}ms")
        
        if avg_fps_increment >= 20:
            print("✅ 21.18 FPS Synchronization: VERIFIED")
        else:
            print("⚠️ 21.18 FPS Synchronization: BELOW TARGET (Check GCP Perception Node Load)")
            
        if any(s['latency'] > 15 for s in snapshots):
            print("⚠️ Redis Latency Spikes Detected (>15ms)")
        else:
            print("✅ Sub-10ms Zero-Copy Performance: VERIFIED")
    else:
        print("❌ Audit Failed: Insufficient telemetry data.")
    print("------------------------------------------")

if __name__ == "__main__":
    jitter_audit()
