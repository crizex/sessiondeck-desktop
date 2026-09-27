# Runs on the server (python3 -c, sent by the app): search across all Claude transcripts of the last 30 days.
#   search <term base64>  -> JSON {conversations: [...], files, ms}, newest first
#   history <sessionId>   -> one conversation as readable text (like transcript.py)
#   --selftest            -> checks the pure search and excerpt logic
# Fast, because it searches raw bytes first and only JSON-parses lines with a hit.
import base64, glob, json, multiprocessing, os, re, sys, time

DAYS = 30
MAX_CONVERSATIONS = 40
MAX_EXCERPTS = 3
PROJECTS = os.path.expanduser('~/.claude/projects')
IMAGE = re.compile(rb'"data":"[A-Za-z0-9+/=]{200,}"')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


def short(inp):
    for k in ('command', 'file_path', 'pattern', 'description', 'url', 'query', 'prompt'):
        if isinstance(inp.get(k), str):
            return inp[k].splitlines()[0][:140] if inp[k] else ''
    return ''


def texts(d):
    """Readable parts of a transcript line as (who, text); tool results and system texts are dropped."""
    if d.get('isSidechain') or d.get('isMeta') or d.get('type') not in ('user', 'assistant'):
        return []
    content = (d.get('message') or {}).get('content')
    if isinstance(content, str):
        content = [{'type': 'text', 'text': content}]
    out = []
    for b in content if isinstance(content, list) else []:
        if not isinstance(b, dict):
            continue
        if b.get('type') == 'text' and b.get('text', '').strip() and not b['text'].lstrip().startswith('<'):
            out.append(('you' if d['type'] == 'user' else 'claude', b['text'].strip()))
        elif b.get('type') == 'tool_use':
            out.append(('tool', f"[{b.get('name')}] {short(b.get('input') or {})}"))
    return out


def prefilter(term):
    # The raw bytes are JSON and bytes.lower() only folds ASCII. The longest ASCII run without " and \
    # appears unchanged in the file; the real check happens afterwards on the parsed text.
    runs = re.findall(r'[\x20\x21\x23-\x5b\x5d-\x7e]+', term.lower())
    longest = max(runs, key=len, default='')
    return (longest if len(longest.strip()) >= 2 else term.lower()).encode()


def excerpt(text, needle, width=200):
    """Piece around the first hit (word start), whitespace collapsed; None without a hit."""
    t = ' '.join(text.split())
    i = t.lower().find(needle)
    if i < 0:
        return None
    a = max(0, i - 70)
    if a:
        a = t.find(' ', a, i) + 1 or a  # do not start in the middle of a word
    return t[a:a + width]


def lines_with(d, dl, raw):
    """Lines (bytes) with a hit in the raw text, from back to front."""
    i = dl.rfind(raw)
    while i >= 0:
        a = d.rfind(b'\n', 0, i) + 1
        e = d.find(b'\n', i)
        yield d[a:len(d) if e < 0 else e]
        i = dl.rfind(raw, 0, a - 1) if a > 0 else -1


def head(d):
    """cwd and the first user prompt as title."""
    cwd, title = '', ''
    for z in d[:3_000_000].split(b'\n'):
        if b'"type":"user"' not in z:
            continue
        try:
            j = json.loads(z)
        except ValueError:
            continue
        cwd = cwd or j.get('cwd') or ''
        title = next((' '.join(t.split())[:160] for who, t in texts(j) if who == 'you'), '')
        if title:
            break
    if not title:  # only commands like /resume: then the title Claude Code assigns itself
        m = re.search(rb'"aiTitle":"((?:[^"\\]|\\.)*)"', d)
        title = json.loads(b'"' + m.group(1) + b'"') if m else ''
    return cwd, title


def conversation(path, raw, needle):
    with open(path, 'rb') as f:
        d = f.read()
    dl = d.lower()
    hits = []
    for z in lines_with(d, dl, raw):
        if b'"type":"user"' not in z and b'"type":"assistant"' not in z:
            continue
        if len(z) > 200_000:  # pasted images: drop the base64, otherwise almost every short word hits
            z = IMAGE.sub(b'""', z)
            if raw not in z.lower():
                continue
        try:
            parts = texts(json.loads(z))
        except ValueError:
            continue
        for who, t in reversed(parts):
            a = excerpt(t, needle)
            if a:
                hits.append({'who': who, 'text': a})
        if len(hits) >= MAX_EXCERPTS:
            break
    if not hits:
        return None
    cwd, title = head(d)
    return {'id': os.path.basename(path)[:-6], 'cwd': cwd, 'title': title, 'time': int(os.path.getmtime(path) * 1000),
            'excerpts': hits[:MAX_EXCERPTS][::-1]}


def _conversation(a):
    try:
        return conversation(*a)
    except OSError:  # deleted during the search
        return None


def files():
    since = time.time() - DAYS * 86400
    lst = [(os.path.getmtime(f), f) for f in glob.glob(PROJECTS + '/*/*.jsonl')]
    return [f for m, f in sorted(lst, reverse=True) if m > since]


def running():
    """sessionId -> tmux session, from Claude Code's runtime files (live processes only)."""
    out = {}
    for f in glob.glob(os.path.expanduser('~/.claude/sessions/*.json')):
        try:
            with open(f) as h:
                j = json.load(h)
            if os.path.exists(f"/proc/{j['pid']}") and j.get('tmux', ':').split(':')[0]:
                out[j['sessionId']] = j['tmux'].split(':')[0]
        except (ValueError, KeyError, OSError):
            pass
    return out


def search(term):
    t0 = time.time()
    needle = ' '.join(term.lower().split())
    raw = prefilter(term)
    lst, found = files(), []
    # Reading and lower() cost almost everything; several processes share the files, order is kept.
    # fork instead of forkserver: functions from python3 -c cannot be re-imported.
    with multiprocessing.get_context('fork').Pool(min(6, os.cpu_count() or 1)) as pool:
        for g in pool.imap(_conversation, [(f, raw, needle) for f in lst], chunksize=4):
            if g:
                found.append(g)
                if len(found) >= MAX_CONVERSATIONS:
                    break
    tm = running()
    for g in found:
        g['tmux'] = tm.get(g['id'])
    return {'conversations': found, 'files': len(lst), 'ms': int((time.time() - t0) * 1000)}


def history(sid):
    if not UUID.match(sid):
        sys.exit('invalid conversation id')
    hit = glob.glob(f'{PROJECTS}/*/{sid}.jsonl')
    if not hit:
        sys.exit('conversation not found')
    out = []
    with open(hit[0], 'rb') as f:
        for z in f:
            if b'"type":"user"' not in z and b'"type":"assistant"' not in z:
                continue
            try:
                parts = texts(json.loads(z))
            except ValueError:
                continue
            out += [('> ' + t if w == 'you' else '  ' + t if w == 'tool' else t) for w, t in parts]
    return '\n\n'.join(out)[-2_000_000:]


def selftest():
    assert prefilter('WireGuard') == b'wireguard'
    assert prefilter('Éclair') == b'clair'
    assert prefilter('say "hello" then') == b'hello'
    assert prefilter('éé') == 'éé'.encode()
    a = excerpt('one two\n\n three ' + 'x ' * 60 + 'WireGuard tunnel is up', 'wireguard')
    assert a.startswith('x ') and a.endswith('WireGuard tunnel is up') and len(a) < 100, a
    assert excerpt('nothing here', 'wireguard') is None
    line = {'type': 'user', 'message': {'content': [{'type': 'text', 'text': '<system-reminder>x'},
            {'type': 'tool_result', 'content': 'secret'}, {'type': 'text', 'text': 'Question'}]}}
    assert texts(line) == [('you', 'Question')]
    line = {'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'ls\nx'}}]}}
    assert texts(line) == [('tool', '[Bash] ls')]
    assert texts({'type': 'user', 'isMeta': True, 'message': {'content': 'x'}}) == []
    d = b'{"a":1}\n{"type":"user","wg":1}\n{"b":2}\n{"type":"user","wg":2}'
    assert list(lines_with(d, d.lower(), b'wg')) == [b'{"type":"user","wg":2}', b'{"type":"user","wg":1}']
    print('ok')


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == '--selftest':
        selftest()
    elif mode == 'search':
        json.dump(search(base64.b64decode(sys.argv[2]).decode('utf-8', 'replace')), sys.stdout, ensure_ascii=False)
    elif mode == 'history':
        sys.stdout.write(history(sys.argv[2]))
    else:
        sys.exit('usage: search <base64> | history <sessionId> | --selftest')
