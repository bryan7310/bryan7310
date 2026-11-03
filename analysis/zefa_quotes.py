"""第二批訂製品詢價（澤發為主，102–115 年，約 200 筆）：估算重量、回推報價邏輯。

資料：analysis/澤發詢價明細.tsv（逐張判讀的詢價單、採購單、報價單）
執行：python3 analysis/zefa_quotes.py → analysis/output/澤發詢價_估重.csv，並印出分析摘要。
重量是用規格（直徑、長度）和頭部尺寸以圓柱、圓錐近似估算，誤差約 ±20%；
規格只寫 M×L 時，頭部用常見比例推估（例如圓頭頭徑約 1.9d）。
"""
import math
import re
from fractions import Fraction
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
SRC = HERE / '澤發詢價明細.tsv'
OUT = HERE / 'output'
INCH = 25.4

# 番數：#N = 0.060" + 0.013" × N
gauge = lambda n: (0.060 + 0.013 * n) * INCH


def frac_in(s):
    s = s.replace('"', '').replace('”', '')
    m = re.fullmatch(r'(\d+)-(\d+/\d+)', s)
    if m:
        return int(m.group(1)) + float(Fraction(m.group(2)))
    return float(Fraction(s))


def parse_dl(spec):
    """回傳（直徑 mm、長度 mm）。看不懂就回傳 None。"""
    s = spec.replace('（', '(').replace('）', ')').replace(' ', '')
    s = re.sub(r'[，,].*$', '', s)            # 只看第一段
    s = s.replace('W', '').replace('U', '')
    m = re.match(r'M(\d+(?:\.\d+)?)(?:[×x\-]P?\d+(?:\.\d+)?)?[×x](\d+(?:\.\d+)?)', s)
    if m:
        return float(m.group(1)), float(m.group(2))
    m = re.match(r'(\d+)#(?:-\d+)?(?:牙)?[×x](\d+(?:-\d+)?/\d+"?|\d+(?:\.\d+)?"?)', s)
    if m:
        L = m.group(2)
        return gauge(int(m.group(1))), (frac_in(L) * INCH if '/' in L or '"' in L else float(L))
    m = re.match(r'(\d+/\d+)(?:-\d+)?[×x](\d+(?:-\d+)?/\d+"?|\d+(?:\.\d+)?"?)', s)
    if m:
        L = m.group(2)
        Lmm = frac_in(L) * INCH if ('/' in L or '"' in L) else float(L)
        return frac_in(m.group(1)) * INCH, Lmm
    m = re.match(r'(\d+(?:\.\d+)?)[×x](?:P\d+(?:\.\d+)?[×x])?(\d+(?:\.\d+)?)', s)
    if m and float(m.group(1)) <= 12:
        return float(m.group(1)), float(m.group(2))
    return None


def head_dims(spec):
    """規格裡有寫頭部尺寸（頭 Ø8.8×2.3、頭 7.5、頭 9.1×3.1）就用它。"""
    m = re.search(r'頭\s*(?:Ø)?(\d+(?:\.\d+)?)(?:[–\-]\d+(?:\.\d+)?)?(?:×(\d+(?:\.\d+)?))?', spec)
    if not m:
        return None, None
    return float(m.group(1)), (float(m.group(2)) if m.group(2) else None)


def head_kind(name):
    for key, kind in [('皿', 'csk'), ('平頭', 'flat'), ('沉頭', 'csk'), ('半圓頭', 'button'), ('盤頭', 'pan'),
                      ('大扁', 'truss'), ('華司面', 'washer'), ('圓頭', 'pan'), ('丸頭', 'pan'),
                      ('焊', 'weld'), ('六角', 'hex'), ('內六角', 'socket'), ('無頭', 'none'), ('止付', 'none'),
                      ('牙條', 'none'), ('螺柱', 'none'), ('鉚釘', 'pan'), ('軸銷', 'flat'), ('方頭', 'hex')]:
        if key in name:
            return kind
    return None


# 頭部比例（頭徑 dk / d、頭厚 k / d）
HEAD = {'pan': (1.9, 0.7), 'truss': (2.3, 0.55), 'washer': (2.4, 0.7), 'button': (1.75, 0.55),
        'csk': (2.0, None), 'flat': (2.0, 0.6), 'weld': (1.35, 0.25), 'hex': (1.6, 0.7),
        'socket': (1.5, 1.0), 'none': (0, 0)}
NOT_SCREW = re.compile(r'帽|扳手|華司片|彈片|外殼|拉帽|插銷|牙條（短）|全牙牙條|K 帽')


def weight_g(row):
    if NOT_SCREW.search(row['品名']):
        return None
    m = re.search(r'單重\s*(\d+(?:\.\d+)?)\s*g', row['規格'] + row['備註'])
    if m:
        return float(m.group(1))
    dl = parse_dl(row['規格'])
    kind = head_kind(row['品名'])
    if not dl or kind is None:
        return None
    d, L = dl
    hd, hk = head_dims(row['規格'])
    rd, rk = HEAD[kind]
    hd = hd or rd * d
    if kind == 'csk':
        h = max(hd - d, 0) / 2
        vh = math.pi * h / 12 * (hd * hd + hd * d + d * d)
        L = max(L - h, 0)                     # 皿頭長度含頭部
    elif kind == 'hex':
        vh = math.sqrt(3) / 2 * hd * hd * (hk or rk * d)
    else:
        k = hk or rk * d
        vh = math.pi / 4 * hd * hd * k * (0.75 if kind in ('pan', 'button', 'truss', 'washer') else 1)
    vs = math.pi / 4 * (0.88 * d) ** 2 * L       # 滾牙毛胚約為牙徑 88%
    rho = 7.93 if row['材質群'] == '不鏽鋼' else 7.85
    return round((vh + vs) * rho / 1000, 2)


def mat_group(m):
    if re.search(r'SUS|XM-7|白鐵', m):
        return '不鏽鋼'
    if re.search(r'合金|SCM', m):
        return '合金鋼'
    if '中碳' in m:
        return '中碳鋼'
    if '彈簧' in m:
        return '彈簧鋼'
    return '鐵／低碳鋼'


def roc_year(s):
    m = re.match(r'(\d{2,3})', str(s))
    return int(m.group(1)) if m else None


def load():
    d = pd.read_csv(SRC, sep='\t', dtype=str).fillna('')
    d['材質群'] = d['材質'].map(mat_group)
    d['年'] = d['日期'].map(roc_year)
    d['數量n'] = pd.to_numeric(d['數量'].str.replace(',', ''), errors='coerce')
    d['單價n'] = pd.to_numeric(d['單價'], errors='coerce')
    d['模具n'] = pd.to_numeric(d['模具費'], errors='coerce')
    d['估重g'] = d.apply(weight_g, axis=1)
    d['每kg'] = (d['單價n'] / d['估重g'] * 1000).round(0)
    return d


def fit(g):
    x, y = g['估重g'].values, g['單價n'].values
    b, a = np.polyfit(x, y, 1)
    r2 = np.corrcoef(x, y)[0, 1] ** 2
    return a, b * 1000, r2


def main():
    OUT.mkdir(exist_ok=True)
    d = load()
    d.drop(columns=['數量n', '單價n', '模具n']).to_csv(OUT / '澤發詢價_估重.csv', index=False, encoding='utf-8-sig')
    ok = d[d['單價n'].notna() & d['估重g'].notna()]
    print(f'共 {len(d)} 筆，有單價 {d["單價n"].notna().sum()} 筆，可估重 {len(ok)} 筆')
    plain = ok[~ok['品名'].str.contains('車修|段付|內牙|反牙|軸銷|鉚釘|方頭|焊') & (ok['數量n'] >= 10000)]
    print('\n== 單價 ≈ 固定費 + 每公斤 × 重量（一般冷打小螺絲，1 萬支以上）')
    for (grp, era), g in plain.groupby(['材質群', plain['年'] >= 111]):
        if len(g) >= 5:
            a, b, r2 = fit(g)
            print(f'{grp} {"111 年後" if era else "110 年前"}: {a:.3f} 元 + {b:.0f} 元/kg × 重量  r²={r2:.2f}  n={len(g)}')
    print('\n== 不鏽鋼小螺絲依重量級距的每支單價（111 年後）')
    s = plain[(plain['材質群'] == '不鏽鋼') & (plain['年'] >= 111)]
    bins = pd.cut(s['估重g'], [0, 0.5, 1, 2, 4, 8, 30])
    print(s.groupby(bins, observed=True)['單價n'].agg(['median', 'min', 'max', 'count']))
    return d


if __name__ == '__main__':
    main()
