import sys
import time
import struct
import mmap
import threading
import numpy as np
import collections

try:
    import webrtcvad
    HAS_WEBRTC_VAD = True
except ImportError:
    HAS_WEBRTC_VAD = False
    print("⚠️  webrtcvad not found. Using Energy-based VAD fallback.")

class SimpleVad:
    def is_speech(self, chunk, rate):
        # Simple energy check: if > 1% max amplitude, treat as speech
        # Chunk is bytes int16.
        data = np.frombuffer(chunk, dtype=np.int16)
        rms = np.sqrt(np.mean(data**2))
        return rms > 50  # Lowered threshold for quieter audio

    def get_rms(self, chunk):
        data = np.frombuffer(chunk, dtype=np.int16)
        return np.sqrt(np.mean(data**2))

# Shared Memory Constants
SHM_SIZE = 32 * 1024 * 1024  # 32MB
MAGIC_NUMBER = 0x4E43524D     # "NCRM" (Frame Header)
AUDIO_MAGIC_NUMBER = 0x41554449 # "AUDI" (Audio Header)

class AgentSharedMemory:
    def __init__(self, name="NeuralChromium_Agent_SharedMem"):
        self.name = name
        self.shm = mmap.mmap(-1, SHM_SIZE, tagname=name)
        self.audio_buffer = collections.deque(maxlen=16000 * 5) # 5 seconds
        if HAS_WEBRTC_VAD:
            self.vad = webrtcvad.Vad(3) # Aggressiveness: 0-3
        else:
            self.vad = SimpleVad()

    def read_header(self):
        # Read header (first 256 bytes reserved)
        self.shm.seek(0)
        data = self.shm.read(32)
        # struct FrameHeader {
        #   uint32_t magic_number;
        #   uint32_t width;
        #   uint32_t height;
        #   uint32_t stride;
        #   uint32_t format;
        #   int64_t timestamp_us;
        # };
        magic, width, height, stride, fmt, ts = struct.unpack('IIIIIq', data)
        return {
            'magic': magic,
            'width': width,
            'height': height,
            'stride': stride,
            'format': fmt,
            'timestamp': ts
        }

    def read_audio_header(self):
        # Audio header is at offset 16MB (halfway point)
        self.shm.seek(16 * 1024 * 1024)
        data = self.shm.read(24)
        # struct AudioHeader {
        #   uint32_t magic_number;
        #   uint32_t sample_rate;
        #   uint32_t channels;
        #   uint32_t frames;
        #   int64_t timestamp_us;
        # };
        try:
            magic, rate, channels, frames, ts = struct.unpack('IIIIq', data)
            return {
                'magic': magic,
                'rate': rate,
                'channels': channels,
                'frames': frames,
                'timestamp': ts
            }
        except Exception as e:
            return None

    def read_audio_data(self, frames):
        # Audio data follows header at 16MB + 256 bytes
        offset = 16 * 1024 * 1024 + 256
        size = frames * 4 # float32 = 4 bytes
        self.shm.seek(offset)
        return self.shm.read(size)

class NeuralAgent:
    def __init__(self):
        self.memory = AgentSharedMemory()
        self.running = True
        self.last_audio_ts = 0
        self.frames = []
        self.silence_frames = 0
        self.frame_count = 0
        
        # Text Return Path (Agent -> Browser)
        try:
            self.text_shm = mmap.mmap(-1, 4096, tagname="NeuralChromium_Input_Text")
            print("📝 Text Return Path Connected")
        except Exception as e:
            print(f"⚠️ Text Path Failed (Chrome not ready?): {e}")
            self.text_shm = None

    def write_text_to_browser(self, text):
        if not self.text_shm: return
        try:
            # Protocol: Revision (u32), Length (u32), Data
            self.text_shm.seek(0)
            current_rev_bytes = self.text_shm.read(4)
            self.text_shm.seek(0)
            current_rev = struct.unpack('I', current_rev_bytes)[0]
            
            new_rev = current_rev + 1
            encoded = text.encode('utf-8')
            length = len(encoded)
            
            # Pack: Rev, Len, Text
            # We explicitly overwrite
            self.text_shm.write(struct.pack('II', new_rev, length))
            self.text_shm.write(encoded)
        except Exception as e:
            print(f"Write Failed: {e}")

    def run(self):
        print("🧠 Neural Agent Connected via Shared Memory")
        print("🔊 Listening for Audio (Neural Audio Hook v2)...")
        
        while self.running:
            self.process_audio()
            # self.process_vision() # Re-enable for full multi-modal
            time.sleep(0.01) # Poll at 100Hz

    def process_audio(self):
        header = self.memory.read_audio_header()
        if not header:
            print("DEBUG: No Audio Header found (Read failed)") 
            return
            
        if header['magic'] != AUDIO_MAGIC_NUMBER:
            # Only print if it's NOT zero (0x0 means just not initialized yet)
            if header['magic'] != 0:
                 print(f"DEBUG: Magic Mismatch: Read {hex(header['magic'])} (Expected {hex(AUDIO_MAGIC_NUMBER)})")
            return
        
        # print(f"DEBUG: Header Found! TS={header['timestamp']} Last={self.last_audio_ts} Frames={header['frames']}")

        if header['timestamp'] <= self.last_audio_ts:
            # Silently return on stale data to avoid log spam
            return 

        self.last_audio_ts = header['timestamp']
        
        raw_bytes = self.memory.read_audio_data(header['frames'])
        # Convert raw bytes (float32) to numpy array
        audio_float = np.frombuffer(raw_bytes, dtype=np.float32)

        # 1. Gain/AGC (Automatic Gain Control)
        # Previously we used fixed 150x gain. Now we use dynamic normalization.
        rms = np.sqrt(np.mean(audio_float**2))
        
        gain = 1.0
        if 0.0001 < rms < 0.1:
            gain = 0.1 / rms
            gain = min(gain, 50.0) # Cap at 50x
        
        audio_boosted = audio_float * gain
        # 2. VAD (Voice Activity Detection)
        # Check RMS of the boosted float audio
        boosted_rms = np.sqrt(np.mean(audio_boosted**2))
        
        # Convert to Int16 for storage/transcription
        audio_int16 = (audio_boosted * 32767).astype(np.int16)
        
        # VAD: Speech detected if RMS > 0.02 (after gain) - raised to reduce noise
        is_speech = boosted_rms > 0.02
        
        # Log Status (Heartbeat) - Throttled to prevent spam
        self.frame_count += 1
        if self.frame_count % 15 == 0:  # Update ~4 times per second
            bar_len = int(min(rms * 1000 * gain, 20))
            vol_bar = "█" * bar_len + " " * (20 - bar_len)
            # Use ANSI escape code \033[K to clear the rest of the line
            sys.stdout.write(f"\rListening... Vol: [{vol_bar}] RMS: {rms:.6f} Gain: {gain:.1f}x \033[K")
            sys.stdout.flush()

        # Voice Activity Detection
        if is_speech:
            if self.silence_frames > 0:
                print("\n🎙️  Speech Detected! Recording...", end="", flush=True)
            self.frames.append(audio_int16.tobytes())
            self.silence_frames = 0
            # Print a dot for every chunk to show activity without spam
            if len(self.frames) % 5 == 0:
                sys.stdout.write(".")
                sys.stdout.flush()
        else:
            self.silence_frames += 1

        # Transcription Trigger (Process immediately on silence threshold)
        # Require at least 60 frames (~4 seconds of speech) for good quality
        if len(self.frames) > 60 and self.silence_frames > 10: 
            print("\n📝 Transcribing...")
            audio_data = b''.join(self.frames)
            try:
                import whisper
                from scipy import signal
                
                # Convert int16 audio to float32 numpy array (Whisper's expected format)
                sample_rate = int(header['rate'])
                
                print(f"📊 Audio: {len(audio_data)} bytes, {sample_rate}Hz")
                
                # Convert bytes to int16 numpy array, then to float32 in range [-1, 1]
                audio_int16 = np.frombuffer(audio_data, dtype=np.int16)
                audio_float32 = audio_int16.astype(np.float32) / 32768.0
                
                # Audio diagnostics
                duration = len(audio_float32) / sample_rate
                rms = np.sqrt(np.mean(audio_float32**2))
                peak = np.max(np.abs(audio_float32))
                print(f"🔍 Duration: {duration:.2f}s, RMS: {rms:.4f}, Peak: {peak:.4f}")
                
                # Resample to 16kHz (Whisper's native sample rate) for better accuracy
                if sample_rate != 16000:
                    num_samples = int(len(audio_float32) * 16000 / sample_rate)
                    audio_float32 = signal.resample(audio_float32, num_samples)
                    print(f"🔄 Resampled to 16kHz ({num_samples} samples)")
                
                # Load Whisper model (tiny.en is fast and accurate for English)
                if not hasattr(self, 'whisper_model'):
                    print("🔄 Loading Whisper model (first time only)...")
                    self.whisper_model = whisper.load_model("tiny.en")
                
                # Transcribe - pass audio directly as numpy array
                result = self.whisper_model.transcribe(audio_float32, language='en', fp16=False)
                text = result['text'].strip()
                
                if text:
                    print(f"✨ YOU SAID: \"{text}\"")
                    self.write_text_to_browser(text)
                else:
                    print("🤷 (No speech detected)")
                    
                print("🔊 Listening...") 
            except Exception as e:
                print(f"❌ Error: {e}")
                import traceback
                traceback.print_exc()
            
            self.frames = []
            self.silence_frames = 0
        
        # Buffer Cleanup
        if self.silence_frames > 100:
            self.frames = []
            
        # NO MORE CONTINUOUS PRINTING

if __name__ == "__main__":
    agent = NeuralAgent()
    try:
        agent.run()
    except KeyboardInterrupt:
        print("\n🛑 Agent Stopped")
