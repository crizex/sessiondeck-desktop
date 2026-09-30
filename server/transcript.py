# Runs on the server (python3 -c, sent by the app): the Claude transcript of a session as readable text.
# Arguments: cwd of the session, samples (base64, lines from the visible screen, to find the right file
# when several sessions share a folder), optionally a mode: "rounds" (timeline), "touched" (diff), "recap".
import base64, glob, json, os, re, subprocess, sys

MAX_READ = 30_000_000  # only read the end of very large transcripts
MAX_OUT = 2_000_000    # at most this much text goes to the app


def tail(path, n):
    with open(path, 'rb') as f:
        f.seek(max(0, os.path.getsize(path) - n))
        return f.read().decode('utf-8', 'replace')


def short(inp):
    for k in ('command', 'file_path', 'pattern', 'description', 'url', 'query', 'prompt'):
        if isinstance(inp.get(k), str):
            return inp[k].splitlines()[0][:140] if inp[k] else ''
    return ''


def text_of(line):
    try:
        return _text_of(line)
    except Exception:  # one line in an unexpected format must not cost the whole history
        return None


def _text_of(line):
    try:
        d = json.loads(line)
    except ValueError:
        return None
    if d.get('isSidechain') or d.get('type') not in ('user', 'assistant'):
        return None
    content = (d.get('message') or {}).get('content')
    if isinstance(content, str):
        content = [{'type': 'text', 'text': content}]
    parts = []
    for b in content or []:
        if b.get('type') == 'text' and b.get('text', '').strip() and not b['text'].lstrip().startswith('<'):
            parts.append(('> ' if d['type'] == 'user' else '') + b['text'].strip())
        elif b.get('type') == 'tool_use':
            parts.append(f"  [{b.get('name')}] {short(b.get('input') or {})}")
    return '\n'.join(parts) or None


MAX_PART = 20_000  # characters per old/new text of an edit


def rounds(lines):
    """One round per user prompt: time, prompt, last answer, tool count, file edits from Edit/Write."""
    out, cur, pending = [], None, {}
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict) or d.get('isSidechain') or d.get('isMeta') or d.get('isCompactSummary'):
            continue
        content = (d.get('message') or {}).get('content')
        if d.get('type') == 'user':
            if isinstance(content, str):
                content = [{'type': 'text', 'text': content}]
            text = '\n'.join(b.get('text', '') for b in content or [] if isinstance(b, dict) and b.get('type') == 'text').strip()
            # Take failed edits out again
            for b in content or []:
                if isinstance(b, dict) and b.get('type') == 'tool_result' and b.get('is_error'):
                    for lst, part in pending.pop(b.get('tool_use_id'), []):
                        if part in lst:
                            lst.remove(part)
            if text and not text.startswith('<') and not text.startswith('[Request interrupted'):
                cur = {'time': d.get('timestamp'), 'prompt': text[:600], 'answer': '', 'tools': 0, 'files': {}}
                out.append(cur)
        elif d.get('type') == 'assistant' and cur is not None and isinstance(content, list):
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'text' and b.get('text', '').strip():
                    cur['answer'] = b['text'].strip()[:800]
                elif b.get('type') == 'tool_use':
                    cur['tools'] += 1
                    e, name = b.get('input') or {}, b.get('name')
                    if name not in ('Edit', 'MultiEdit', 'Write') or not isinstance(e.get('file_path'), str):
                        continue
                    lst = cur['files'].setdefault(e['file_path'], [])
                    if name == 'Write':
                        new = [{'old': None, 'new': str(e.get('content', ''))[:MAX_PART]}]
                    else:
                        new = [{'old': str(x.get('old_string', ''))[:MAX_PART], 'new': str(x.get('new_string', ''))[:MAX_PART]}
                               for x in ([e] if name == 'Edit' else e.get('edits') or []) if isinstance(x, dict)]
                    lst.extend(new)
                    pending[b.get('id')] = [(lst, t) for t in new]
    for r in out:
        r['files'] = [{'path': p, 'parts': t} for p, t in r['files'].items() if t]
    return out[-300:]


def line_count(t):
    return len(t[:-1].split('\n') if t.endswith('\n') else t.split('\n')) if t else 0


def git(folder, *args):
    try:
        return subprocess.run(['git', '-C', folder, *args], capture_output=True, text=True, timeout=10, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def repo_of(path):
    d = path
    while d and not os.path.isdir(d):
        d = os.path.dirname(d)
    top = git(d, 'rev-parse', '--show-toplevel') if d else None
    return top.strip() if top else None


def git_state(paths, since, cwd, messages, hashes):
    """Commits since the session started and files not committed yet. A commit belongs to the session if it touches
    one of its files, its message is in one of its git commit commands, or its hash shows up in a tool output.
    Known limit: commits of other sessions on the same files count too, the session id is not in the commit."""
    repos = {}
    for p in [cwd, *paths]:
        top = repo_of(os.path.dirname(p) if p != cwd else p)
        if top:
            repos.setdefault(top, [])
            if p != cwd:
                repos[top].append(p)
    commits, uncommitted = [], []
    for top, ps in repos.items():
        rel = {os.path.relpath(p, top) for p in ps}
        for block in (git(top, 'log', f'--since={since}', '--format=%x01%h%x09%aI%x09%s', '--name-only') or '').split('\x01')[1:] if since else []:
            head, *names = block.strip('\n').split('\n')
            h, time, text = head.split('\t', 2)
            if rel.intersection(names) or text in messages or any(x.startswith(h) or h.startswith(x) for x in hashes):
                commits.append({'hash': h, 'time': time, 'text': text, 'repo': os.path.basename(top)})
        status = (git(top, 'status', '--porcelain', '-z', '--', *rel) or '').split('\0') if rel else []
        uncommitted += [os.path.join(top, e[3:]) for e in status if len(e) > 3]
    return sorted(commits, key=lambda c: c['time']), uncommitted


COMMIT_MSG = re.compile(r"""\bcommit\b[^\n]*?\s-[a-zA-Z]*m\s*(?:"([^"\n]+)|'([^'\n]+)|"?\$\(cat <<-?'?\w+'?\n([^\n]+))""")
COMMIT_OUT = re.compile(r'^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\]', re.M)


def recap(cwd, lines):
    """Facts about the session: duration, rounds, output tokens, files with +/-, commits, what is not committed."""
    rs, times, output, ids, messages, hashes = rounds(lines), [], 0, set(), set(), set()
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict) or d.get('isSidechain'):
            continue
        if d.get('timestamp'):
            times.append(d['timestamp'])
        m = d.get('message') or {}
        # One answer often spans several lines with the same id and the same usage
        if d.get('type') == 'assistant' and isinstance(m.get('usage'), dict) and m.get('id') not in ids:
            ids.add(m.get('id'))
            output += m['usage'].get('output_tokens') or 0
        for b in m.get('content') if isinstance(m.get('content'), list) else []:
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'tool_use' and b.get('name') == 'Bash':
                for t in COMMIT_MSG.findall(str((b.get('input') or {}).get('command', ''))):
                    messages.add(next(x for x in t if x).strip())
            elif b.get('type') == 'tool_result':
                c = b.get('content')
                c = c if isinstance(c, str) else ' '.join(x.get('text', '') for x in c or [] if isinstance(x, dict))
                hashes.update(COMMIT_OUT.findall(c))
    files = {}
    for r in rs:
        for f in r['files']:
            e = files.setdefault(f['path'], {'path': f['path'], 'plus': 0, 'minus': 0})
            for t in f['parts']:
                e['plus'] += line_count(t['new'])
                e['minus'] += line_count(t['old'])
    start = rs[0]['time'] if rs else (times[0] if times else None)
    commits, uncommitted = git_state(list(files), start, cwd, messages, hashes)
    return {'start': start, 'end': times[-1] if times else None, 'rounds': len(rs), 'tools': sum(r['tools'] for r in rs),
            'output': output, 'files': list(files.values()), 'commits': commits, 'uncommitted': uncommitted,
            'answer': next((r['answer'] for r in reversed(rs) if r['answer']), '')}


def last_html(lines):
    """Path of the last file edit if it was an HTML file (the session is building a draft), else None"""
    last = None
    for line in lines:
        if '"tool_use"' not in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict) or d.get('isSidechain') or d.get('type') != 'assistant':
            continue
        for b in (d.get('message') or {}).get('content') or []:
            if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') in ('Edit', 'MultiEdit', 'Write'):
                path = (b.get('input') or {}).get('file_path')
                if isinstance(path, str):
                    last = path
    return last if last and last.lower().endswith(('.html', '.htm')) else None


def main():
    cwd = sys.argv[1]
    samples = [p for p in base64.b64decode(sys.argv[2]).decode('utf-8', 'replace').split('\n') if p] if len(sys.argv) > 2 else []
    folder = os.path.expanduser('~/.claude/projects/' + re.sub(r'[^A-Za-z0-9]', '-', cwd))
    files = sorted(glob.glob(folder + '/*.jsonl'), key=os.path.getmtime, reverse=True)[:6]
    if not files:
        sys.exit('no transcript for ' + cwd)
    pick = files[0]
    for f in files if samples else []:
        if any(p in tail(f, 3_000_000) for p in samples):
            pick = f
            break
    lines = tail(pick, MAX_READ).split('\n')
    if os.path.getsize(pick) > MAX_READ:
        lines = lines[1:]  # first line is cut
    if len(sys.argv) > 3 and sys.argv[3] == 'html':
        sys.stdout.write(json.dumps(last_html(lines)))
        return
    if len(sys.argv) > 3 and sys.argv[3] == 'touched':
        sys.stdout.write('\n'.join(dict.fromkeys(f['path'] for r in rounds(lines) for f in r['files'])))
        return
    if len(sys.argv) > 3 and sys.argv[3] == 'recap':
        sys.stdout.write(json.dumps(recap(cwd, lines), ensure_ascii=False))
        return
    if len(sys.argv) > 3 and sys.argv[3] == 'rounds':
        lst = rounds(lines)
        # Too big for the app: old rounds without edit texts
        while len(json.dumps(lst)) > 4_000_000 and any(r['files'] for r in lst):
            next(r for r in lst if r['files'])['files'] = []
        sys.stdout.write(json.dumps(lst, ensure_ascii=False))
        return
    text = '\n\n'.join(t for t in map(text_of, lines) if t)
    sys.stdout.write(text[-MAX_OUT:])


main()
