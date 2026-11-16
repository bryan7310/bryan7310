"""自有影像辨識（本地、不連網、不花 API 費用）

- 文字辨識（OCR）：PP-OCRv6 small（偵測＋方向＋辨識）ONNX 模型，用 OpenCV dnn 在 CPU 上跑
- 條碼／QR Code：OpenCV 內建 BarcodeDetector、QRCodeDetector

模型檔放在 <data>/models/ocr/（找不到時用程式旁邊 ../data/models/ocr/）：
  PP-OCRv6_det_small.onnx、PP-OCRv6_rec_small.onnx、ch_ppocr_mobile_v2.0_cls_mobile.onnx
  （來源：RapidOCR 3.10.0 套件內附的 PaddleOCR 開源模型，Apache-2.0）

這個模組用到 numpy、opencv（cv2）；主伺服器只在呼叫時才 import，沒裝也不影響其他功能。
"""
import base64
import math
import os
import re
import threading
import time

MODEL_FILES = {
    'det': 'PP-OCRv6_det_small.onnx',
    'rec': 'PP-OCRv6_rec_small.onnx',
    'cls': 'ch_ppocr_mobile_v2.0_cls_mobile.onnx',
}
HERE = os.path.dirname(os.path.abspath(__file__))

_LOCK = threading.Lock()   # cv2.dnn 的 Net 不是執行緒安全，一次只跑一張
_ENGINE = {}


class VisionError(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def model_dir(data_dir):
    for d in (os.path.join(data_dir, 'models', 'ocr'), os.path.join(HERE, '..', 'data', 'models', 'ocr')):
        if all(os.path.isfile(os.path.join(d, f)) for f in MODEL_FILES.values()):
            return os.path.abspath(d)
    return None


def status(data_dir):
    """回傳 {available, reason, opencv, models}，給設定頁顯示"""
    out = {'available': False, 'reason': '', 'opencv': '', 'models': '', 'loaded': bool(_ENGINE)}
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
        out['opencv'] = cv2.__version__
    except Exception as e:
        out['reason'] = '主機沒有安裝 OpenCV／numpy（pip install opencv-python-headless numpy）：%s' % e
        return out
    d = model_dir(data_dir)
    if not d:
        out['reason'] = '找不到模型檔：請放到 data/models/ocr/（%s）' % '、'.join(MODEL_FILES.values())
        return out
    out['models'] = d
    out['available'] = True
    return out


# ---------- ONNX 字表：辨識模型的 metadata_props["character"]（不用 onnx 套件，直接讀 protobuf） ----------
def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7f) << s
        s += 7
        if c < 0x80:
            return r, i


def _pb_fields(b):
    i, n = 0, len(b)
    while i < n:
        k, i = _varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = _varint(b, i)
        elif w == 2:
            ln, i = _varint(b, i)
            v = b[i:i + ln]
            i += ln
        elif w == 1:
            v = b[i:i + 8]
            i += 8
        elif w == 5:
            v = b[i:i + 4]
            i += 4
        else:
            raise ValueError('protobuf wire type %d' % w)
        yield f, v


def _onnx_characters(path):
    with open(path, 'rb') as f:
        b = f.read()
    for f, v in _pb_fields(b):
        if f == 14:  # ModelProto.metadata_props
            d = dict(_pb_fields(v))
            if d.get(1) == b'character':
                return d.get(2, b'').decode('utf-8').split('\n')
    raise VisionError('辨識模型裡沒有字表', 500)


_BUF = {}


def _load_net(path):
    """從記憶體載入（OpenCV 讀不了含中文的路徑；檔案內容快取，重開 Net 不用再讀磁碟）"""
    import cv2
    import numpy as np
    if path not in _BUF:
        with open(path, 'rb') as f:
            _BUF[path] = np.frombuffer(f.read(), np.uint8)
    return cv2.dnn.readNetFromONNX(_BUF[path])


IDLE_UNLOAD = 600  # 秒；模型全部載入約占 1GB 記憶體，閒置 10 分鐘就釋放
_USE = {'t': 0, 'watch': False}


def _idle_watch():
    while True:
        time.sleep(60)
        if _ENGINE and time.time() - _USE['t'] > IDLE_UNLOAD:
            with _LOCK:
                if time.time() - _USE['t'] > IDLE_UNLOAD:
                    _ENGINE.clear()
                    import gc
                    gc.collect()


def _engine(data_dir):
    _USE['t'] = time.time()
    if not _USE['watch']:
        _USE['watch'] = True
        threading.Thread(target=_idle_watch, daemon=True, name='vision-idle').start()
    if _ENGINE:
        return _ENGINE
    st = status(data_dir)
    if not st['available']:
        raise VisionError(st['reason'], 503)
    import cv2
    cv2.setNumThreads(max(1, (os.cpu_count() or 4)))
    d = st['models']
    t = time.time()
    _ENGINE['det_path'] = os.path.join(d, MODEL_FILES['det'])
    _ENGINE['rec_path'] = os.path.join(d, MODEL_FILES['rec'])
    _ENGINE['cls'] = _load_net(os.path.join(d, MODEL_FILES['cls']))
    _ENGINE['chars'] = ['<blank>'] + _onnx_characters(os.path.join(d, MODEL_FILES['rec'])) + [' ']
    _ENGINE['load_ms'] = int((time.time() - t) * 1000)
    return _ENGINE


# ---------- 圖片 ----------
def decode_image(data_url):
    """data:image/...;base64,xxx（或純 base64）→ BGR ndarray"""
    import cv2
    import numpy as np
    s = str(data_url or '')
    m = re.match(r'^data:image/[\w.+-]+;base64,(.+)$', s, re.S)
    b64 = (m.group(1) if m else s).strip()
    if not b64:
        raise VisionError('沒有收到圖片')
    if len(b64) > 16 * 1024 * 1024:
        raise VisionError('圖片太大，請縮小後再試')
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise VisionError('圖片格式不對')
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise VisionError('讀不出圖片（請用 JPG／PNG）')
    return img


# ---------- 文字偵測（DB） ----------
def _det_resize(img, max_side=1600, min_side=736):
    import cv2
    h, w = img.shape[:2]
    r = 1.0
    if min(h, w) < min_side:
        r = min_side / min(h, w)
    if max(h, w) * r > max_side:
        r = max_side / max(h, w)
    nh = max(32, int(round(h * r / 32)) * 32)
    nw = max(32, int(round(w * r / 32)) * 32)
    return cv2.resize(img, (nw, nh)), nh / h, nw / w


def _detect(eng, img):
    import cv2
    import numpy as np
    src_h, src_w = img.shape[:2]
    im, ry, rx = _det_resize(img)
    blob = (im.astype(np.float32) / 255.0 - 0.5) / 0.5
    blob = blob.transpose(2, 0, 1)[None]
    # 每張圖大小不同；同一個 Net 換形狀會出錯，所以同尺寸才重用、不同尺寸重新載入（約 0.1 秒）
    if eng.get('det_shape') != blob.shape:
        eng['det'] = _load_net(eng['det_path'])
        eng['det_shape'] = blob.shape
    net = eng['det']
    net.setInput(blob)
    pred = net.forward()[0, 0]
    seg = (pred > 0.3).astype(np.uint8)
    seg = cv2.dilate(seg, np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(seg, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    ph, pw = pred.shape
    for c in contours[:1000]:
        if len(c) < 4:
            continue
        rect = cv2.minAreaRect(c)
        (cx, cy), (rw, rh), ang = rect
        if min(rw, rh) < 3:
            continue
        # 分數：框內平均機率（fast 模式）
        x, y, bw, bh = cv2.boundingRect(c)
        mask = np.zeros((bh, bw), np.uint8)
        cv2.fillPoly(mask, [c.reshape(-1, 2) - [x, y]], 1)
        score = float(cv2.mean(pred[y:y + bh, x:x + bw], mask)[0])
        if score < 0.5:
            continue
        # 外擴（unclip）：d = 面積 × 1.6 ÷ 周長，長寬各加 2d
        area, peri = rw * rh, 2 * (rw + rh)
        d = area * 1.6 / max(peri, 1e-6)
        rect = ((cx, cy), (rw + 2 * d, rh + 2 * d), ang)
        if min(rw, rh) + 2 * d < 5:
            continue
        pts = cv2.boxPoints(rect)
        pts[:, 0] = np.clip(pts[:, 0] / rx, 0, src_w - 1)
        pts[:, 1] = np.clip(pts[:, 1] / ry, 0, src_h - 1)
        boxes.append((_order_pts(pts), score))
    return boxes


def _order_pts(pts):
    """四點排成 左上、右上、右下、左下"""
    import numpy as np
    pts = sorted(pts.tolist(), key=lambda p: p[0])
    left = sorted(pts[:2], key=lambda p: p[1])
    right = sorted(pts[2:], key=lambda p: p[1])
    return np.array([left[0], right[0], right[1], left[1]], dtype=np.float32)


def _crop(img, pts):
    import cv2
    import numpy as np
    w = int(max(np.linalg.norm(pts[0] - pts[1]), np.linalg.norm(pts[2] - pts[3])))
    h = int(max(np.linalg.norm(pts[0] - pts[3]), np.linalg.norm(pts[1] - pts[2])))
    w, h = max(w, 1), max(h, 1)
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(pts, dst)
    out = cv2.warpPerspective(img, M, (w, h), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)
    if h / w >= 1.5:  # 直書的字
        out = np.rot90(out)
    return out


# ---------- 方向（0／180） ----------
def _cls_fix(eng, crop):
    import cv2
    import numpy as np
    h, w = crop.shape[:2]
    rw = min(192, int(math.ceil(48 * w / h)))
    im = cv2.resize(crop, (rw, 48)).astype(np.float32)
    im = (im / 255.0 - 0.5) / 0.5
    pad = np.zeros((48, 192, 3), np.float32)
    pad[:, :rw] = im
    net = eng['cls']
    net.setInput(pad.transpose(2, 0, 1)[None])
    p = net.forward()[0]
    if int(np.argmax(p)) == 1 and float(p[1]) > 0.9:
        return cv2.rotate(crop, cv2.ROTATE_180)
    return crop


# ---------- 文字辨識（CTC） ----------
# OpenCV dnn 同一個 Net 換輸入大小（寬度、批次數）會算錯甚至整個程式當掉，
# 所以每種寬度各開一個 Net、批次固定 REC_BATCH 張，輸入形狀永遠不變。
REC_WIDTHS = (320, 480, 640, 960, 1280, 1920, 2560)
REC_BATCH = 6  # 320 寬一次 6 張；越寬張數越少（rec_batch）


def _rec_net(eng, W):
    import cv2
    nets = eng.setdefault('rec_nets', {})
    if W not in nets:
        nets[W] = _load_net(eng['rec_path'])
    return nets[W]


def _rec_input(crop, W):
    import cv2
    import numpy as np
    h, w = crop.shape[:2]
    rw = min(W, max(8, int(math.ceil(48 * w / h))))
    im = cv2.resize(crop, (rw, 48)).astype(np.float32)
    im = (im / 255.0 - 0.5) / 0.5
    pad = np.zeros((48, W, 3), np.float32)
    pad[:, :rw] = im
    return pad.transpose(2, 0, 1)


def _ctc(eng, p):
    idx = p.argmax(1)
    prob = p.max(1)
    chars = eng['chars']
    out, conf, last = [], [], -1
    for i, k in zip(idx.tolist(), prob.tolist()):
        if i != last and i != 0 and i < len(chars):
            out.append(chars[i])
            conf.append(k)
        last = i
    return ''.join(out).strip(), (sum(conf) / len(conf) if conf else 0.0)


def _recognize_all(eng, crops):
    """crops → [(text, score)]，同寬度的一起跑"""
    import numpy as np
    groups = {}
    for i, c in enumerate(crops):
        h, w = c.shape[:2]
        need = 48 * w / h
        W = next((x for x in REC_WIDTHS if x >= need), REC_WIDTHS[-1])
        groups.setdefault(W, []).append(i)
    res = [('', 0.0)] * len(crops)
    for W, ids in groups.items():
        net = _rec_net(eng, W)
        bs = max(1, REC_BATCH * 320 // W)
        for s in range(0, len(ids), bs):
            part = ids[s:s + bs]
            batch = np.zeros((bs, 3, 48, W), np.float32)
            for j, i in enumerate(part):
                batch[j] = _rec_input(crops[i], W)
            net.setInput(batch)
            p = net.forward()
            for j, i in enumerate(part):
                res[i] = _ctc(eng, p[j])
    return res


def _group_lines(items):
    """依 y 座標把框分成一行一行（同一行由左到右）"""
    rows = []
    for it in sorted(items, key=lambda t: t['cy']):
        for r in rows:
            if abs(r['cy'] - it['cy']) < 0.6 * min(r['h'], it['h']):
                r['items'].append(it)
                n = len(r['items'])
                r['cy'] = (r['cy'] * (n - 1) + it['cy']) / n
                break
        else:
            rows.append({'cy': it['cy'], 'h': it['h'], 'items': [it]})
    lines = []
    for r in rows:
        its = sorted(r['items'], key=lambda t: t['x'])
        lines.append({'text': '  '.join(t['text'] for t in its), 'y': round(r['cy']), 'cells': [t['text'] for t in its]})
    return lines


def ocr(data_dir, img, min_score=0.5):
    """img：BGR ndarray → {items:[{text,score,box}], lines:[{text,y,cells}], w, h, ms}"""
    t0 = time.time()
    with _LOCK:
        eng = _engine(data_dir)
        boxes = _detect(eng, img)
        t1 = time.time()
        keep, crops = [], []
        for pts, dscore in boxes:
            crop = _crop(img, pts)
            if crop.shape[0] < 4 or crop.shape[1] < 4:
                continue
            keep.append(pts)
            crops.append(_cls_fix(eng, crop))
        recs = _recognize_all(eng, crops)
        items = []
        for pts, (text, score) in zip(keep, recs):
            if not text or score < min_score:
                continue
            xs, ys = pts[:, 0], pts[:, 1]
            items.append({'text': text, 'score': round(score, 3),
                          'box': [[round(float(x)), round(float(y))] for x, y in pts],
                          'x': float(xs.min()), 'cy': float(ys.mean()), 'h': float(ys.max() - ys.min())})
    lines = _group_lines(items)
    for it in items:
        for k in ('x', 'cy', 'h'):
            it.pop(k, None)
    h, w = img.shape[:2]
    return {'items': items, 'lines': lines, 'w': w, 'h': h,
            'ms': int((time.time() - t0) * 1000), 'det_ms': int((t1 - t0) * 1000)}


# ---------- 條碼／QR Code ----------
def codes(img):
    """回傳 [{type, text, box}]；QR 與一維條碼都找"""
    import cv2
    out, seen = [], set()

    def add(kind, txt, pts):
        txt = (txt or '').strip()
        if not txt or (kind, txt) in seen:
            return
        seen.add((kind, txt))
        box = [[round(float(x)), round(float(y))] for x, y in pts.reshape(-1, 2)] if pts is not None else []
        out.append({'type': kind, 'text': txt, 'box': box})

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    scale = 1600 / max(h, w) if max(h, w) > 1600 else 1.0
    g = cv2.resize(gray, (int(w * scale), int(h * scale))) if scale < 1 else gray
    try:
        qr = cv2.QRCodeDetectorAruco() if hasattr(cv2, 'QRCodeDetectorAruco') else cv2.QRCodeDetector()
        ok, texts, pts, _ = qr.detectAndDecodeMulti(g)
        if ok:
            for i, t in enumerate(texts):
                add('QR', t, pts[i] / scale if pts is not None else None)
    except Exception:
        pass
    try:
        bd = cv2.barcode.BarcodeDetector()
        r = bd.detectAndDecodeWithType(g)
        ok, texts, types, pts = (r if len(r) == 4 else (True,) + tuple(r))
        if ok and texts is not None:
            for i, t in enumerate(texts):
                add(str(types[i]) if types is not None and i < len(types) else 'BARCODE', t,
                    pts[i] / scale if pts is not None else None)
    except Exception:
        pass
    return out


def run(data_dir, body):
    """API 進入點：body {image, mode: 'ocr'|'codes'|'all'}"""
    st = status(data_dir)
    if not st['available']:
        raise VisionError(st['reason'], 503)
    img = decode_image(body.get('image'))
    mode = str(body.get('mode') or 'all')
    out = {'ok': True}
    if mode in ('ocr', 'all'):
        out.update(ocr(data_dir, img))
    if mode in ('codes', 'all'):
        t = time.time()
        out['codes'] = codes(img)
        out['codes_ms'] = int((time.time() - t) * 1000)
    out['w'], out['h'] = int(img.shape[1]), int(img.shape[0])
    return out
