# Runs on the server (python3 -c, sent by the app every 2 s): every tmux session of the SSH user
# with its folder and the visible screen, as JSON. The app reads Claude's state from the screen.
import json, subprocess


def tmux(*args):
    r = subprocess.run(['tmux', *args], capture_output=True)
    return r.stdout.decode('utf-8', 'replace') if r.returncode == 0 else ''


out = []
# Colon, not tab: without a UTF-8 locale tmux prints tabs as "_". Session names never contain ":"
# (tmux replaces it), so splitting twice leaves colons in the path intact.
for line in tmux('list-sessions', '-F', '#{session_name}:#{session_created}:#{pane_current_path}').splitlines():
    parts = line.split(':', 2)
    if len(parts) != 3:
        continue
    name, created, cwd = parts
    out.append({'name': name, 'created': int(created or 0), 'cwd': cwd,
                'screen': tmux('capture-pane', '-p', '-t', name + ':')})
print(json.dumps(out))
