# Runs on the server (python3 -c <this> <file>): serves the folder of an HTML draft over
# python3 -m http.server on 127.0.0.1, one server per folder, and prints its port as JSON.
# The port is noted in /tmp, so the next preview of the same folder reuses the running server.
# ponytail: the servers keep running (one per folder, localhost only); clean up if they ever pile up.
import hashlib, json, os, socket, subprocess, sys, time, urllib.parse, urllib.request

path = os.path.realpath(sys.argv[1])
root, name = os.path.dirname(path), os.path.basename(path)
note = f'/tmp/sessiondeck-draft-{os.getuid()}-{hashlib.sha1(root.encode()).hexdigest()[:12]}'


def serves(port):
    # Our server answers 200 for the draft; a stranger that took over the port does not.
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/{urllib.parse.quote(name)}', timeout=1) as r:
            return r.status == 200
    except Exception:
        return False


try:
    port = int(open(note).read())
except (OSError, ValueError):
    port = 0
if not (port and serves(port)):
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    subprocess.Popen(['setsid', sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', root],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    end = time.time() + 10
    while not serves(port):
        if time.time() > end:
            sys.exit('http.server did not start for ' + root)
        time.sleep(0.2)
    with open(note, 'w') as f:
        f.write(str(port))
print(json.dumps({'port': port, 'root': root, 'file': name}))
