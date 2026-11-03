"""十字小螺絲的加工費：依直徑、長度、牙型（機械牙／鐵板牙）統計。

加工費 = 每支淨價 − 線材費（估計重量 × 線材單價）。
線材單價：不鏽鋼 SUS304 約 110 元/kg（澤發 113–115 年報 108 元/kg），鐵約 30 元/kg（澤發 103–106 年報 25 元/kg）。

資料：
1. 牌價表：東日、金同利（不鏽鋼）、久允（鐵）的十字丸頭、皿頭、大扁頭，機械牙與鐵板牙（小量整盒價）。
2. 澤發訂製品報價（不鏽鋼，111 年後，多為 1–5 萬支）。

執行：python3 analysis/processing_fee.py → analysis/output/加工費_*.csv
"""
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from common import load
from zefa_quotes import load as load_zefa

OUT = Path(__file__).resolve().parent / 'output'
WIRE = {'不鏽鋼': 110, '鐵': 30}            # 元/kg
RHO = {'不鏽鋼': 7.93, '鐵': 7.85}
# 頭部比例（頭徑、頭厚 ÷ 直徑）
HEADR = {'丸頭': (1.9, 0.7), '大扁頭': (2.3, 0.55), '皿頭': (2.0, None)}
D_BINS = [0, 2.7, 3.7, 4.3, 5.2, 6.6, 20]
D_LAB = ['M2–M2.6', 'M3–M3.5（#4–#6）', 'M4（#8、5/32）', 'M5（#10、3/16）', 'M6（#12、1/4）', 'M8 以上']
L_BINS = [0, 6.5, 12.5, 20.5, 30.5, 50.5, 999]
L_LAB = ['≤6', '8–12', '13–20', '21–30', '31–50', '>50']


def weight(d, L, head, mat):
    dk, kr = HEADR[head]
    hd = dk * d
    if head == '皿頭':
        h = (hd - d) / 2
        vh = math.pi * h / 12 * (hd * hd + hd * d + d * d)
        L = max(L - h, 0)
    else:
        vh = math.pi / 4 * hd * hd * kr * d * 0.75
    vs = math.pi / 4 * (0.88 * d) ** 2 * L
    return (vh + vs) * RHO[mat] / 1000


def thread_kind(name):
    if re.search(r'鐵板|自攻|尖尾|割尾', name):
        return '鐵板牙'
    if '機械' in name:
        return '機械牙'
    return None


def catalog():
    df = load()
    df = df[df['廠商'].isin(['東日', '金同利', '久允']) & df['L_mm'].notna() & df['d_mm'].notna()]
    df = df[~df['品名'].str.contains('附|華司|割尾|番數|實價')]
    df['牙型'] = df['品名'].map(thread_kind)
    df['頭'] = df['頭型']
    df = df[df['牙型'].notna() & df['頭'].isin(list(HEADR))]
    df['材'] = np.where(df['材質'].str.contains('SUS'), '不鏽鋼', '鐵')
    df['淨價'] = df['淨價(1PCS)']
    df['重量g'] = [weight(d, L, h, m) for d, L, h, m in zip(df['d_mm'], df['L_mm'], df['頭'], df['材'])]
    df['線材費'] = df['重量g'] / 1000 * df['材'].map(WIRE)
    df['加工費'] = df['淨價'] - df['線材費']
    return df


def zefa():
    d = load_zefa()
    d = d[(d['材質群'] == '不鏽鋼') & (d['年'] >= 111) & d['單價n'].notna() & d['估重g'].notna()]
    d = d[~d['品名'].str.contains('車修|段付|內牙|反牙|焊|星形|內六角|六角|方頭|割尾|二種|華司面|薄頭|小頭|D 形')]
    d['牙型'] = d['品名'].map(lambda n: '鐵板牙' if re.search('鐵板|自攻', n) else '機械牙')
    from zefa_quotes import parse_dl
    dl = d['規格'].map(parse_dl)
    d['d_mm'] = dl.map(lambda v: v[0] if v else None)
    d['L_mm'] = dl.map(lambda v: v[1] if v else None)
    d['加工費'] = d['單價n'] - d['估重g'] / 1000 * WIRE['不鏽鋼']
    return d.dropna(subset=['d_mm', 'L_mm'])


def binned(df, val='加工費'):
    df = df.assign(直徑=pd.cut(df['d_mm'], D_BINS, labels=D_LAB), 長度=pd.cut(df['L_mm'], L_BINS, labels=L_LAB))
    return df.pivot_table(index='直徑', columns='長度', values=val, aggfunc='median', observed=True).round(3)


def paired(df):
    """同廠商、同頭型、同直徑長度，鐵板牙 vs 機械牙。"""
    key = ['廠商', '頭', 'd_mm', 'L_mm']
    a = df[df['牙型'] == '機械牙'].groupby(key)['加工費'].min()
    b = df[df['牙型'] == '鐵板牙'].groupby(key)['加工費'].min()
    j = pd.concat([a.rename('機械牙'), b.rename('鐵板牙')], axis=1).dropna().reset_index()
    j['差額'] = j['鐵板牙'] - j['機械牙']
    j['比例'] = j['鐵板牙'] / j['機械牙']
    return j


def main():
    OUT.mkdir(exist_ok=True)
    cat = catalog()
    res = {}
    for mat, vendors in [('不鏽鋼', ['東日', '金同利']), ('鐵', ['久允'])]:
        for kind in ['機械牙', '鐵板牙']:
            t = binned(cat[(cat['材'] == mat) & (cat['牙型'] == kind)])
            res[(mat, kind)] = t
            t.to_csv(OUT / f'加工費_牌價_{mat}_{kind}.csv', encoding='utf-8-sig')
            print(f'\n== 牌價表 {mat} {kind}（{"、".join(vendors)}，每支加工費，元）')
            print(t.to_string())
    p = paired(cat)
    p.to_csv(OUT / '加工費_鐵板牙對機械牙.csv', index=False, encoding='utf-8-sig')
    p = p.assign(材=np.where(p['廠商'] == '久允', '鐵', '不鏽鋼'),
                 直徑=pd.cut(p['d_mm'], D_BINS, labels=D_LAB))
    print('\n== 同規格鐵板牙比機械牙（加工費差額中位數，元／比例）')
    print(p.groupby(['材', '直徑'], observed=True).agg(差額=('差額', 'median'), 比例=('比例', 'median'), 筆數=('差額', 'size')).round(3).to_string())
    z = zefa()
    for kind in ['機械牙', '鐵板牙']:
        t = binned(z[z['牙型'] == kind])
        t.to_csv(OUT / f'加工費_澤發訂製_{kind}.csv', encoding='utf-8-sig')
        print(f'\n== 澤發訂製品 不鏽鋼 {kind}（111 年後，每支加工費）')
        print(t.to_string())
    # 建議表（不鏽鋼訂製 1–5 萬支）：機械牙 = 牌價表機械牙加工費 × 0.7（澤發實際約為牌價表的 66–74%）；
    # 鐵板牙 = 機械牙 + 依直徑的加價（久允同規格差額，與澤發訂製品一致）
    TAP_ADD = {'M2–M2.6': 0.01, 'M3–M3.5（#4–#6）': 0.03, 'M4（#8、5/32）': 0.05, 'M5（#10、3/16）': 0.07, 'M6（#12、1/4）': 0.15, 'M8 以上': 0.25}
    # 同直徑越長越貴：沿長度取累計最大值，消除牌價表個別跳動
    mach = (res[('不鏽鋼', '機械牙')] * 0.7).cummax(axis=1).round(2)
    tap = mach.apply(lambda col: col + mach.index.map(TAP_ADD).astype(float)).round(2)
    mach.to_csv(OUT / '加工費_建議_不鏽鋼訂製_機械牙.csv', encoding='utf-8-sig')
    tap.to_csv(OUT / '加工費_建議_不鏽鋼訂製_鐵板牙.csv', encoding='utf-8-sig')
    print('\n== 建議：不鏽鋼訂製 1–5 萬支 機械牙加工費'); print(mach.to_string())
    print('\n== 建議：不鏽鋼訂製 1–5 萬支 鐵板牙加工費'); print(tap.to_string())
    return cat, z


if __name__ == '__main__':
    main()
