"""電子信箱：伺服器定時用 IMAP／POP3 向郵件主機（HiNet）收信，存在 data/mailbox，給網頁和手機 App 看。

- 設定存在 data/mailcfg.json（含密碼，只留在伺服器電腦；API 不會把密碼傳回瀏覽器）
- 只讀不刪：IMAP 用 BODY.PEEK（不會把信標成已讀），POP3 不下 DELE
- 每封信存成 data/mailbox/msg/<id>.json，附件存在 data/mailbox/att/<id>/；清單在 data/mailbox/index.json
- 測試：環境變數 ZR_MAIL_MOCK_DIR 指到一個放 .eml 檔的資料夾，就從那裡「收信」，不連郵件主機
"""
import base64
import email
import email.policy
import email.utils
import hashlib
import html
import imaplib
import json
import os
import poplib
import re
import threading
import time

DEFAULT_CFG = {'proto': 'imap', 'host': 'msa.hinet.net', 'port': 993, 'ssl': True, 'user': '', 'pass': '', 'auto': False,
               'interval': 5, 'first': 300}
LOCK = threading.Lock()
STATE = {'running': False, 'last': 0, 'err': '', 'new': 0}


def _dir(data_dir, *p):
    d = os.path.join(data_dir, 'mailbox', *p)
    os.makedirs(d, exist_ok=True)
    return d


def _rd(fp, d):
    try:
        with open(fp, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return d


def _wr(fp, obj):
    tmp = fp + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, fp)


def cfg_load(data_dir):
    return {**DEFAULT_CFG, **_rd(os.path.join(data_dir, 'mailcfg.json'), {})}


def cfg_public(data_dir):
    c = cfg_load(data_dir)
    out = {k: v for k, v in c.items() if k != 'pass'}
    out['pass_set'] = bool(c.get('pass')) or bool(os.environ.get('ZR_MAIL_MOCK_DIR'))
    out['mock'] = bool(os.environ.get('ZR_MAIL_MOCK_DIR'))
    return out


def cfg_save(data_dir, body):
    c = cfg_load(data_dir)
    for k in ('proto', 'host', 'user'):
        if k in body:
            c[k] = str(body[k] or '').strip()
    for k in ('port', 'interval', 'first'):
        if k in body:
            try:
                c[k] = int(body[k])
            except (TypeError, ValueError):
                pass
    for k in ('ssl', 'auto'):
        if k in body:
            c[k] = bool(body[k])
    if body.get('pass'):
        c['pass'] = str(body['pass'])
    if c['proto'] not in ('imap', 'pop3'):
        c['proto'] = 'imap'
    c['interval'] = max(2, min(120, c['interval']))
    _wr(os.path.join(data_dir, 'mailcfg.json'), c)
    return cfg_public(data_dir)


# ---------- 解析信件 ----------
def _text_of(part):
    try:
        return part.get_content()
    except Exception:
        try:
            return (part.get_payload(decode=True) or b'').decode('utf-8', 'replace')
        except Exception:
            return ''


def _strip_html(h):
    h = re.sub(r'(?is)<(script|style|head)[^>]*>.*?</\1>', ' ', h)
    h = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</tr>|</li>', '\n', h)
    return re.sub(r'[ \t\r\f\v]+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()


def parse_message(raw, data_dir, mid):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    name, addr = email.utils.parseaddr(str(msg.get('From', '')))
    try:
        dt = email.utils.parsedate_to_datetime(str(msg.get('Date')))
        ms = int(dt.timestamp() * 1000)
    except Exception:
        ms = int(time.time() * 1000)
    body_html, body_text = '', ''
    try:
        b = msg.get_body(preferencelist=('html',))
        if b is not None:
            body_html = _text_of(b)
        b = msg.get_body(preferencelist=('plain',))
        if b is not None:
            body_text = _text_of(b)
    except Exception:
        pass
    if not body_text and body_html:
        body_text = _strip_html(body_html)
    atts, cids = [], {}
    adir = None
    n = 0
    for part in msg.walk():
        if part.is_multipart():
            continue
        disp = (part.get_content_disposition() or '').lower()
        fn = part.get_filename()
        cid = (part.get('Content-ID') or '').strip('<> ')
        ctype = part.get_content_type()
        if part in (msg.get_body(preferencelist=('html',)), msg.get_body(preferencelist=('plain',))) and not fn:
            continue
        if not fn and not cid and disp != 'attachment':
            continue
        try:
            data = part.get_payload(decode=True) or b''
        except Exception:
            data = b''
        if cid and ctype.startswith('image/') and len(data) < 3 * 1024 * 1024:
            cids[cid] = 'data:%s;base64,%s' % (ctype, base64.b64encode(data).decode('ascii'))
            if disp != 'attachment':
                continue
        if adir is None:
            adir = _dir(data_dir, 'att', mid)
        safe = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', fn or ('附件%d' % (n + 1)))[:120]
        with open(os.path.join(adir, '%d-%s' % (n, safe)), 'wb') as f:
            f.write(data)
        atts.append({'n': n, 'name': fn or safe, 'type': ctype, 'size': len(data)})
        n += 1
    if cids and body_html:
        body_html = re.sub(r'(?i)cid:([^"\'\s>)]+)', lambda m: cids.get(m.group(1).strip('<> '), m.group(0)), body_html)
    to = ', '.join(a for _, a in email.utils.getaddresses([str(msg.get('To', '')), str(msg.get('Cc', ''))]) if a)
    head = {'id': mid, 'from': addr, 'from_name': name or addr, 'to': to, 'subject': str(msg.get('Subject', '') or '（沒有主旨）'),
            'date': ms, 'size': len(raw), 'att': len(atts), 'snippet': re.sub(r'\s+', ' ', body_text)[:160]}
    full = {**head, 'html': body_html, 'text': body_text, 'atts': atts, 'msgid': str(msg.get('Message-ID', ''))}
    return head, full


def _store(data_dir, idx, src_key, raw):
    mid = hashlib.sha1(src_key.encode('utf-8')).hexdigest()[:16]
    if any(x['id'] == mid for x in idx['items'][-2000:]) and os.path.isfile(os.path.join(_dir(data_dir, 'msg'), mid + '.json')):
        return False
    head, full = parse_message(raw, data_dir, mid)
    head['q'] = (head['from_name'] + ' ' + head['from'] + ' ' + head['subject'] + ' ' + full['text'][:3000]).lower()
    _wr(os.path.join(_dir(data_dir, 'msg'), mid + '.json'), full)
    idx['items'].append(head)
    return True


# ---------- 收信 ----------
def fetch(data_dir):
    """收新信；回傳收到幾封。同一時間只跑一次。"""
    if not LOCK.acquire(blocking=False):
        raise RuntimeError('正在收信中，請稍後')
    STATE.update(running=True, err='')
    try:
        c = cfg_load(data_dir)
        ifp = os.path.join(_dir(data_dir), 'index.json')
        idx = _rd(ifp, {'items': [], 'seen': {}, 'uidv': ''})
        seen = idx.setdefault('seen', {})
        new = 0
        mock = os.environ.get('ZR_MAIL_MOCK_DIR')
        if mock:
            for fn in sorted(os.listdir(mock)):
                if fn.lower().endswith('.eml') and fn not in seen:
                    with open(os.path.join(mock, fn), 'rb') as f:
                        if _store(data_dir, idx, 'mock|' + fn, f.read()):
                            new += 1
                    seen[fn] = 1
        else:
            if not c['host'] or not c['user'] or not c['pass']:
                raise RuntimeError('還沒設定收信伺服器、帳號或密碼')
            if c['proto'] == 'pop3':
                P = (poplib.POP3_SSL if c['ssl'] else poplib.POP3)(c['host'], c['port'], timeout=60)
                try:
                    P.user(c['user']); P.pass_(c['pass'])
                    uidl = [ln.decode('ascii', 'replace').split(' ', 1) for ln in P.uidl()[1]]
                    todo = [(int(n), u) for n, u in uidl if ('pop|' + u) not in seen]
                    if not seen:
                        todo = todo[-c['first']:]   # 第一次只收最近幾百封
                    for n, u in todo:
                        raw = b'\r\n'.join(P.retr(n)[1])
                        if _store(data_dir, idx, 'pop|%s|%s' % (c['user'], u), raw):
                            new += 1
                        seen['pop|' + u] = 1
                        if new % 20 == 0:
                            _wr(ifp, idx)
                finally:
                    try:
                        P.quit()
                    except Exception:
                        pass
            else:
                M = (imaplib.IMAP4_SSL if c['ssl'] else imaplib.IMAP4)(c['host'], c['port'], timeout=60)
                try:
                    M.login(c['user'], c['pass'])
                    typ, _ = M.select('INBOX', readonly=True)
                    if typ != 'OK':
                        raise RuntimeError('打不開收件匣')
                    uv = (M.response('UIDVALIDITY')[1] or [b''])[0]
                    uv = uv.decode() if isinstance(uv, bytes) else str(uv or '')
                    typ, data = M.uid('search', None, 'ALL')
                    uids = [int(x) for x in (data[0] or b'').split()]
                    todo = [u for u in uids if ('imap|%s|%d' % (uv, u)) not in seen]
                    if not any(k.startswith('imap|') for k in seen):
                        todo = todo[-c['first']:]
                    for u in todo:
                        typ, d = M.uid('fetch', str(u), '(BODY.PEEK[])')
                        raw = next((x[1] for x in d if isinstance(x, tuple)), b'')
                        if raw and _store(data_dir, idx, 'imap|%s|%s|%d' % (c['user'], uv, u), raw):
                            new += 1
                        seen['imap|%s|%d' % (uv, u)] = 1
                        if new % 20 == 0:
                            _wr(ifp, idx)
                finally:
                    try:
                        M.logout()
                    except Exception:
                        pass
        idx['items'].sort(key=lambda x: x['date'])
        _wr(ifp, idx)
        STATE.update(last=int(time.time() * 1000), new=new)
        return new
    except Exception as e:
        msg = str(e)
        if 'AUTHENTICATIONFAILED' in msg.upper() or 'LOGIN' in msg.upper() and 'FAIL' in msg.upper() or '-ERR' in msg:
            msg = '帳號或密碼不對，郵件主機拒絕登入（%s）' % msg[:120]
        STATE['err'] = msg[:300]
        raise RuntimeError(STATE['err'])
    finally:
        STATE['running'] = False
        LOCK.release()


def test(data_dir, body):
    """用表單上的設定（密碼沒填就用已存的）試登入，不收信"""
    c = {**cfg_load(data_dir), **{k: v for k, v in body.items() if k in DEFAULT_CFG and (k != 'pass' or v)}}
    c['port'] = int(c['port'])
    if os.environ.get('ZR_MAIL_MOCK_DIR'):
        return '（測試模式）連線成功'
    if c['proto'] == 'pop3':
        P = (poplib.POP3_SSL if c['ssl'] else poplib.POP3)(c['host'], c['port'], timeout=30)
        try:
            P.user(c['user']); P.pass_(c['pass']); n = P.stat()[0]
        finally:
            P.quit()
        return '連線成功，信箱裡有 %d 封信' % n
    M = (imaplib.IMAP4_SSL if c['ssl'] else imaplib.IMAP4)(c['host'], c['port'], timeout=30)
    try:
        M.login(c['user'], c['pass']); typ, d = M.select('INBOX', readonly=True)
        return '連線成功，收件匣有 %s 封信' % (d[0].decode() if d and d[0] else '?')
    finally:
        try:
            M.logout()
        except Exception:
            pass


def loop(data_dir):
    while True:
        try:
            c = cfg_load(data_dir)
            if c.get('auto') and (c.get('pass') or os.environ.get('ZR_MAIL_MOCK_DIR')) and time.time() * 1000 - STATE['last'] >= c['interval'] * 60000:
                try:
                    fetch(data_dir)
                except Exception:
                    pass
        except Exception:
            pass
        time.sleep(30)


def listing(data_dir, q='', limit=300, before=0):
    idx = _rd(os.path.join(_dir(data_dir), 'index.json'), {'items': []})
    items = idx['items']
    ts = [t for t in re.split(r'\s+', (q or '').lower().strip()) if t]
    out = []
    for x in reversed(items):
        if before and x['date'] >= before:
            continue
        if ts and not all(t in x.get('q', '') for t in ts):
            continue
        out.append({k: v for k, v in x.items() if k != 'q'})
        if len(out) >= limit:
            break
    return {'items': out, 'total': len(items), 'state': {**STATE}, 'cfg': cfg_public(data_dir)}


def message(data_dir, mid):
    if not re.fullmatch(r'[0-9a-f]{16}', mid or ''):
        return None
    return _rd(os.path.join(_dir(data_dir, 'msg'), mid + '.json'), None)


def attachment(data_dir, mid, n):
    m = message(data_dir, mid)
    if not m:
        return None
    a = next((x for x in m.get('atts', []) if x['n'] == n), None)
    if not a:
        return None
    d = _dir(data_dir, 'att', mid)
    fp = next((os.path.join(d, f) for f in os.listdir(d) if f.startswith('%d-' % n)), None)
    if not fp:
        return None
    with open(fp, 'rb') as f:
        return a, f.read()
