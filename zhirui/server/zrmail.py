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
    out = {k: v for k, v in c.items() if k not in ('pass', 'smtp_pass')}
    out['smtp_pass_set'] = bool(c.get('smtp_pass'))
    out['pass_set'] = bool(c.get('pass')) or bool(os.environ.get('ZR_MAIL_MOCK_DIR'))
    out['mock'] = bool(os.environ.get('ZR_MAIL_MOCK_DIR'))
    return out


def cfg_save(data_dir, body):
    c = cfg_load(data_dir)
    for k in ('proto', 'host', 'user', 'smtp_host', 'smtp_sec', 'smtp_user', 'from_addr', 'from_name'):
        if k in body:
            c[k] = str(body[k] or '').strip()
    for k in ('port', 'interval', 'first', 'smtp_port'):
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
    if body.get('smtp_pass'):
        c['smtp_pass'] = str(body['smtp_pass'])
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


# ---------- 寄信、草稿、寄件備份、垃圾桶 ----------
# 收到的信在 index.json（收信程式寫）；自己寫的信（草稿、寄件備份）在 local.json；刪除標記在 meta.json。分開存，收信時不會蓋掉。
DEFAULT_CFG.update({'smtp_host': 'msr.hinet.net', 'smtp_port': 587, 'smtp_sec': 'starttls', 'smtp_user': '', 'smtp_pass': '',
                    'from_addr': '', 'from_name': '志瑞螺絲企業有限公司'})
IDX_LOCK = threading.Lock()
MAX_ATT = 20 * 1024 * 1024


def _local(data_dir):
    return os.path.join(_dir(data_dir), 'local.json'), os.path.join(_dir(data_dir), 'meta.json')


def _all_items(data_dir):
    idx = _rd(os.path.join(_dir(data_dir), 'index.json'), {'items': []})
    lf, mf = _local(data_dir)
    loc = _rd(lf, {'items': []}); meta = _rd(mf, {'del': {}})
    items = [{**x, 'folder': x.get('folder') or 'inbox'} for x in idx['items']] + [dict(x) for x in loc['items']]
    for x in items:
        if x['id'] in meta['del']:
            x['del'] = meta['del'][x['id']]
    return items


def listing2(data_dir, folder='inbox', q='', limit=300, before=0):
    items = _all_items(data_dir)
    cnt = {'inbox': 0, 'sent': 0, 'draft': 0, 'trash': 0}
    for x in items:
        k = 'trash' if x.get('del') else x['folder']
        cnt[k] = cnt.get(k, 0) + 1
    pick = [x for x in items if (x.get('del') if folder == 'trash' else (not x.get('del') and x['folder'] == folder))]
    pick.sort(key=lambda x: x['date'], reverse=True)
    ts = [t for t in re.split(r'\s+', (q or '').lower().strip()) if t]
    out = []
    for x in pick:
        if before and x['date'] >= before:
            continue
        if ts and not all(t in x.get('q', '') for t in ts):
            continue
        out.append({k: v for k, v in x.items() if k != 'q'})
        if len(out) >= limit:
            break
    return {'items': out, 'total': len(pick), 'counts': cnt, 'state': {**STATE}, 'cfg': cfg_public(data_dir)}


def set_deleted(data_dir, ids, on):
    with IDX_LOCK:
        lf, mf = _local(data_dir); meta = _rd(mf, {'del': {}})
        for i in ids:
            if on:
                meta['del'][i] = int(time.time() * 1000)
            else:
                meta['del'].pop(i, None)
        _wr(mf, meta)


def purge(data_dir, ids):
    """永久刪除伺服器上的這一份（HiNet 上的信不動；收信紀錄還在，所以不會再收回來）"""
    import shutil
    ids = [i for i in ids if re.fullmatch(r'[0-9a-f]{16}', str(i))]
    with IDX_LOCK:
        lf, mf = _local(data_dir); meta = _rd(mf, {'del': {}}); loc = _rd(lf, {'items': []})
        got = LOCK.acquire(timeout=120)   # 收信中先等它寫完 index
        try:
            idx_fp = os.path.join(_dir(data_dir), 'index.json')
            idx = _rd(idx_fp, {'items': [], 'seen': {}})
            idx['items'] = [x for x in idx['items'] if x['id'] not in ids]
            _wr(idx_fp, idx)
        finally:
            if got:
                LOCK.release()
        loc['items'] = [x for x in loc['items'] if x['id'] not in ids]
        for i in ids:
            meta['del'].pop(i, None)
            fp = os.path.join(_dir(data_dir, 'msg'), i + '.json')
            if os.path.isfile(fp):
                os.remove(fp)
            shutil.rmtree(os.path.join(data_dir, 'mailbox', 'att', i), ignore_errors=True)
        _wr(lf, loc); _wr(mf, meta)


def _addrs(s):
    return [a for _, a in email.utils.getaddresses([str(s or '').replace('；', ',').replace(';', ',')]) if a and '@' in a]


def _from_addr(c):
    if c.get('from_addr'):
        return c['from_addr']
    u = c.get('smtp_user') or c.get('user') or ''
    return u if '@' in u else (u + '@msa.hinet.net' if u else '')


def _compose(c, d, data_dir):
    """把表單內容組成 EmailMessage；附件＝新上傳的＋轉寄原信的（或草稿裡已存的）"""
    from email.message import EmailMessage
    m = EmailMessage()
    frm = _from_addr(c)
    if not frm:
        raise RuntimeError('還沒設定寄件人信箱：請到「收信設定」填帳號或寄件人信箱')
    m['From'] = email.utils.formataddr((c.get('from_name') or '', frm))
    to, cc = _addrs(d.get('to')), _addrs(d.get('cc'))
    if to:
        m['To'] = ', '.join(to)
    if cc:
        m['Cc'] = ', '.join(cc)
    m['Subject'] = str(d.get('subject') or '')
    m['Date'] = email.utils.formatdate(localtime=True)
    m['Message-ID'] = email.utils.make_msgid(domain=(frm.split('@')[-1] if '@' in frm else 'zhirui.local'))
    if d.get('reply_to'):
        orig = message(data_dir, d['reply_to'])
        if orig and orig.get('msgid'):
            m['In-Reply-To'] = orig['msgid']; m['References'] = orig['msgid']
    m.set_content(str(d.get('body') or ''))
    total = 0
    for f in d.get('files') or []:   # 新上傳：{name, type, data(base64)}
        data = base64.b64decode(f.get('data') or '')
        total += len(data)
        mt, _, st = (f.get('type') or 'application/octet-stream').partition('/')
        m.add_attachment(data, maintype=mt or 'application', subtype=st or 'octet-stream', filename=f.get('name') or 'file')
    for ref in d.get('fwd') or []:   # 原信或草稿裡的附件：{id, n}
        r = attachment(data_dir, str(ref.get('id', '')), int(ref.get('n', -1)))
        if r:
            a, data = r; total += len(data)
            mt, _, st = (a.get('type') or 'application/octet-stream').partition('/')
            m.add_attachment(data, maintype=mt, subtype=st or 'octet-stream', filename=a['name'])
    if total > MAX_ATT:
        raise RuntimeError('附件合計超過 20 MB，請分開寄')
    return m, to + cc


def _save_local(data_dir, folder, raw, mid, extra=None):
    head, full = parse_message(raw, data_dir, mid)
    if extra:
        full.update(extra)
    if folder == 'draft' and not head['date']:
        head['date'] = int(time.time() * 1000)
    head.update(folder=folder, q=(head['from_name'] + ' ' + head['to'] + ' ' + head['subject'] + ' ' + full['text'][:3000]).lower())
    full['folder'] = folder
    _wr(os.path.join(_dir(data_dir, 'msg'), mid + '.json'), full)
    with IDX_LOCK:
        lf, mf = _local(data_dir); loc = _rd(lf, {'items': []})
        loc['items'] = [x for x in loc['items'] if x['id'] != mid] + [head]
        _wr(lf, loc)
    return head


def save_draft(data_dir, d):
    c = cfg_load(data_dir)
    old = str(d.get('id') or '')
    if old and not re.fullmatch(r'[0-9a-f]{16}', old):
        old = ''
    m, _ = _compose(c, d, data_dir)   # 先組（會讀到舊草稿的附件），再換新 id 存
    mid = hashlib.sha1(('draft|%s|%s' % (time.time(), old)).encode()).hexdigest()[:16]
    head = _save_local(data_dir, 'draft', bytes(m), mid, {'reply_to': str(d.get('reply_to') or ''), 'cc_raw': str(d.get('cc') or ''), 'to_raw': str(d.get('to') or ''), 'body': str(d.get('body') or '')})
    if old:
        purge(data_dir, [old])
    return head['id']


def send(data_dir, d):
    c = cfg_load(data_dir)
    m, rcpts = _compose(c, d, data_dir)
    if not rcpts:
        raise RuntimeError('請填收件人')
    raw = bytes(m)
    mock = os.environ.get('ZR_SMTP_MOCK_DIR')
    if mock:   # 測試：寫成 .eml，不真的寄出
        os.makedirs(mock, exist_ok=True)
        with open(os.path.join(mock, 'sent_%d.eml' % int(time.time() * 1000)), 'wb') as f:
            f.write(raw)
    else:
        import smtplib
        user = c.get('smtp_user') or c.get('user'); pw = c.get('smtp_pass') or c.get('pass')
        if not c.get('smtp_host') or not user or not pw:
            raise RuntimeError('還沒設定寄信伺服器或帳號密碼')
        port = int(c.get('smtp_port') or 587)
        S = smtplib.SMTP_SSL(c['smtp_host'], port, timeout=60) if c.get('smtp_sec') == 'ssl' else smtplib.SMTP(c['smtp_host'], port, timeout=60)
        try:
            if c.get('smtp_sec') == 'starttls':
                S.starttls()
            S.login(user, pw)
            S.send_message(m, to_addrs=rcpts)
        except smtplib.SMTPAuthenticationError:
            raise RuntimeError('寄信伺服器拒絕登入：帳號或密碼不對')
        finally:
            try:
                S.quit()
            except Exception:
                pass
    mid = hashlib.sha1(('sent|' + str(m['Message-ID'])).encode()).hexdigest()[:16]
    _save_local(data_dir, 'sent', raw, mid)
    if re.fullmatch(r'[0-9a-f]{16}', str(d.get('draft_id') or '')):
        purge(data_dir, [d['draft_id']])
    return mid


def smtp_test(data_dir, body):
    """試登入寄信伺服器，不寄信"""
    if os.environ.get('ZR_SMTP_MOCK_DIR'):
        return '（測試模式）寄信伺服器連線成功'
    import smtplib
    c = {**cfg_load(data_dir), **{k: v for k, v in body.items() if k in DEFAULT_CFG and (k not in ('pass', 'smtp_pass') or v)}}
    user = c.get('smtp_user') or c.get('user'); pw = c.get('smtp_pass') or c.get('pass'); port = int(c.get('smtp_port') or 587)
    S = smtplib.SMTP_SSL(c['smtp_host'], port, timeout=30) if c.get('smtp_sec') == 'ssl' else smtplib.SMTP(c['smtp_host'], port, timeout=30)
    try:
        if c.get('smtp_sec') == 'starttls':
            S.starttls()
        S.login(user, pw)
    finally:
        try:
            S.quit()
        except Exception:
            pass
    return '寄信伺服器登入成功（寄件人 %s）' % _from_addr(c)
