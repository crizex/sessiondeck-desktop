# Runs on the server (python3 -c, sent by the app): the Claude transcript of a session as readable text.
# Arguments: cwd of the session, samples (base64, lines from the visible screen, to find the right file
# when several sessions share a folder), optionally "rounds" for the timeline.
import base64, glob, json, os, re, sys

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
    if len(sys.argv) > 3 and sys.argv[3] == 'touched':
        sys.stdout.write('\n'.join(dict.fromkeys(f['path'] for r in rounds(lines) for f in r['files'])))
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
