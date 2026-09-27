# Optional voice input for SessionDeck: keeps two Whisper models in memory and answers requests
# on a Unix socket. Request = optionally one JSON line {"from": seconds, "fast": true}, then the audio
# file (webm/opus or similar) until EOF. Answer = JSON {text, parts: [{start, end, text}], duration} or {error}.
# Recognition starts at "from", so while recording the app only has to re-send the still open rest.
import io, json, os, socketserver
from faster_whisper import WhisperModel, decode_audio

SOCK = os.environ.get('VOICE_SOCKET', '/run/sessiondeck-voice/sock')
LANGUAGE = os.environ.get('VOICE_LANGUAGE') or None  # e.g. "en"; empty = detect automatically
MAX = 25 * 1024 * 1024
# small understands a lot more but needs close to real time under load.
# base is about three times faster and drives the live transcript ("fast"), small the final text.
load = lambda name: WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=int(os.environ.get('VOICE_THREADS', '4')),
                                 download_root=os.environ.get('VOICE_MODELS'), local_files_only=True)
accurate = load(os.environ.get('VOICE_MODEL', 'small'))
fast = load('base')


class Request(socketserver.StreamRequestHandler):
    def handle(self):
        data = self.rfile.read(MAX + 1)
        try:
            if len(data) > MAX:
                raise ValueError('recording too large')
            head = {}
            if data[:1] == b'{':
                line, data = data.split(b'\n', 1)
                head = json.loads(line)
            audio = decode_audio(io.BytesIO(data))
            start = max(0.0, float(head.get('from', 0)))
            rest = audio[int(start * 16000):]
            parts = []
            if len(rest) > 1600:
                segments, _ = (fast if head.get('fast') else accurate).transcribe(rest, language=LANGUAGE, beam_size=1, vad_filter=True)
                parts = [{'start': start + s.start, 'end': start + s.end, 'text': s.text.strip()} for s in segments]
            answer = {'text': ' '.join(p['text'] for p in parts).strip(), 'parts': parts, 'duration': len(audio) / 16000}
        except Exception as e:
            answer = {'error': str(e) or type(e).__name__}
        self.wfile.write(json.dumps(answer, ensure_ascii=False).encode())


if os.path.exists(SOCK):
    os.unlink(SOCK)
os.umask(0o077)  # only the service user may use the socket
# ponytail: one thread, requests run one after another; enough for one person.
socketserver.UnixStreamServer(SOCK, Request).serve_forever()
