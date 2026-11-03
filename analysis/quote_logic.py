"""分析廠商牌價的計價邏輯，結果寫到 analysis/output/。

執行：python3 analysis/quote_logic.py
資料來源：螺絲牌價總表.xlsx（全部工作表，單價已換算成 1 PCS）。
"""
import itertools
from pathlib import Path

import numpy as np
import pandas as pd

from common import load

OUT = Path(__file__).resolve().parent / 'output'
SERIES_KEYS = ['廠商', '類別', '品名', '材質', '表面處理', '頭型', '直徑']


def material_group(m):
    if 'SUS' in m or m == '白鐵':
        return m if m in ('SUS316', 'SUS410', 'SUS204') else 'SUS304'
    if '合金' in m:
        return '合金鋼'
    if '中碳' in m:
        return '中碳鋼'
    if '鋅' in m:
        return '鋅合金'
    if '彈簧' in m:
        return '彈簧鋼'
    return '鐵/低碳鋼'


def density(m):
    if 'SUS' in m or m == '白鐵':
        return 7.93e-6
    if '鋅' in m:
        return 6.6e-6
    return 7.85e-6  # kg/mm³


def length_series(df):
    """同廠商、品名、材質、表面、頭型、直徑，牌價對長度做直線回歸：牌價 = a + b × 長度。"""
    s = df[df.L_mm.notna() & df.d_mm.notna()]
    rows = []
    for k, g in s.groupby(SERIES_KEYS):
        g = g.drop_duplicates('L_mm').sort_values('L_mm')
        if len(g) < 4:
            continue
        x, y = g.L_mm.values, g['牌價(1PCS)'].values
        b, a = np.polyfit(x, y, 1)
        sst = ((y - y.mean()) ** 2).sum()
        r2 = 1 - ((y - (a + b * x)) ** 2).sum() / sst if sst > 0 else 1.0
        disc = g['折'].median()
        d = g.d_mm.iloc[0]
        # 螺紋段實際截面約為公稱直徑截面的 85%
        kg_per_mm = np.pi / 4 * d ** 2 * density(k[3]) * 0.85
        rows.append(dict(zip(SERIES_KEYS, k), 筆數=len(g), d_mm=round(d, 2),
                         最短=x.min(), 最長=x.max(),
                         固定費a=round(a, 4), 每mm牌價b=round(b, 5), R2=round(r2, 3),
                         折=disc, 每mm淨價=round(b * disc, 5),
                         長度增量淨價每kg=round(b * disc / kg_per_mm, 1) if b > 0 else None,
                         頭部約當長度倍徑=round(a / b / d, 2) if b > 0 and a > 0 else None,
                         材質群=material_group(k[3])))
    return pd.DataFrame(rows)


def diameter_exponent(series):
    """每 mm 牌價 b 與直徑 d 的關係：b ∝ d^p。p≈2 代表按材料重量計價。"""
    rows = []
    for k, g in series[series['每mm牌價b'] > 0].groupby(SERIES_KEYS[:-1]):
        if g.d_mm.nunique() < 3:
            continue
        p, _ = np.polyfit(np.log(g.d_mm), np.log(g['每mm牌價b']), 1)
        rows.append(dict(zip(SERIES_KEYS[:-1], k), 直徑數=g.d_mm.nunique(), 指數p=round(p, 2)))
    return pd.DataFrame(rows)


def attribute_ratios(df, attr, base_cols):
    """同廠商同規格、只差一個屬性時，淨價比 B/A 的中位數。"""
    out = []
    for k, g in df.groupby(base_cols):
        if g[attr].nunique() < 2:
            continue
        vals = g.groupby(attr)['淨價(1PCS)'].mean()
        for a, b in itertools.combinations(sorted(vals.index), 2):
            if vals[a] > 0:
                out.append((k[0], a or '（空白）', b or '（空白）', vals[b] / vals[a]))
    o = pd.DataFrame(out, columns=['廠商', 'A', 'B', 'B/A'])
    return (o.groupby(['廠商', 'A', 'B'])['B/A'].agg(['median', 'count'])
             .query('count >= 5').round(2).reset_index()
             .rename(columns={'median': '淨價比中位數', 'count': '比對筆數'}))


def cross_material(df):
    """不同材質、相同公制規格（直徑×長度）的最低淨價比。"""
    def pick(vendor, cond):
        g = df[(df.廠商 == vendor) & cond & (df.牙系 == '公制') & df.L_mm.notna()]
        return g.groupby(['d_mm', 'L_mm'])['淨價(1PCS)'].min()

    n = df.品名
    sets = {
        '外六角 低碳4.6級（鑫城 DIN931）': pick('鑫城', n.str.contains('DIN931')),
        '外六角 中碳8.8級（鑫城 白皮）': pick('鑫城', n.str.contains('8.8級外六角中碳鋼螺絲') & (df.表面處理 == '白皮')),
        '外六角 合金12.9級（鑫城）': pick('鑫城', n == '12.9級外六角螺絲'),
        '外六角 SUS304（東日）': pick('東日', n == '六角頭螺絲'),
        '內六角 合金12.9級（虹瑩）': pick('虹瑩', n.isin(['內六角螺絲', '內六角螺絲（半牙）', '內六角螺絲（全牙）'])),
        '內六角 中碳8.8級（鑫城）': pick('鑫城', n.str.contains('8.8級中碳全牙')),
        '內六角 SUS304（東日）': pick('東日', n == '有頭內六角螺絲'),
        '十字機械牙 鐵（久允）': pick('久允', n.isin(['丸頭機械螺絲', '皿頭機械螺絲', '大扁頭機械螺絲'])),
        '十字機械牙 SUS304（東日）': pick('東日', n.str.contains('十字機械牙')),
        '十字機械牙 SUS304（金同利）': pick('金同利', n.str.contains('十字機械牙')),
    }
    pairs = [
        ('外六角 低碳4.6級（鑫城 DIN931）', '外六角 中碳8.8級（鑫城 白皮）'),
        ('外六角 中碳8.8級（鑫城 白皮）', '外六角 合金12.9級（鑫城）'),
        ('外六角 中碳8.8級（鑫城 白皮）', '外六角 SUS304（東日）'),
        ('內六角 合金12.9級（虹瑩）', '內六角 中碳8.8級（鑫城）'),
        ('內六角 合金12.9級（虹瑩）', '內六角 SUS304（東日）'),
        ('十字機械牙 鐵（久允）', '十字機械牙 SUS304（東日）'),
        ('十字機械牙 SUS304（東日）', '十字機械牙 SUS304（金同利）'),
    ]
    rows = []
    for a, b in pairs:
        j = pd.concat([sets[a].rename('a'), sets[b].rename('b')], axis=1).dropna()
        if len(j):
            rows.append(dict(A=a, B=b, 淨價比中位數=round(float(np.median(j.b / j.a)), 2), 比對筆數=len(j)))
    return pd.DataFrame(rows)


def main():
    OUT.mkdir(exist_ok=True)
    df = load()

    cat = (df.groupby(['廠商', '類別']).agg(筆數=('品名', 'size'), 品名數=('品名', 'nunique'),
                                         材質=('材質', lambda s: '、'.join(sorted(set(s.dropna())))),
                                         折扣=('折扣', lambda s: '、'.join(sorted(set(s.dropna().astype(str))))))
           .reset_index())
    cat.to_csv(OUT / '分類統計.csv', index=False, encoding='utf-8-sig')

    series = length_series(df)
    series.to_csv(OUT / '長度回歸.csv', index=False, encoding='utf-8-sig')
    diameter_exponent(series).to_csv(OUT / '直徑指數.csv', index=False, encoding='utf-8-sig')

    good = series[(series.R2 > 0.9) & (series['每mm牌價b'] > 0)].copy()
    good['直徑區間'] = pd.cut(good.d_mm, [0, 4, 6.5, 10.5, 16.5, 100],
                          labels=['≤M4', 'M5–M6', 'M8–M10', 'M12–M16', '≥M18'])
    perkg = good.pivot_table(index='材質群', columns='直徑區間', values='長度增量淨價每kg',
                             aggfunc='median', observed=True).round(0)
    perkg.to_csv(OUT / '每公斤淨價_材質x直徑.csv', encoding='utf-8-sig')
    head = good.groupby('頭型')['頭部約當長度倍徑'].agg(['median', 'count']).round(1)
    head.to_csv(OUT / '頭部固定費.csv', encoding='utf-8-sig')

    attribute_ratios(df, '頭型', ['廠商', '規格', '材質', '表面處理', '單位']).to_csv(
        OUT / '比價_頭型.csv', index=False, encoding='utf-8-sig')
    attribute_ratios(df, '表面處理', ['廠商', '品名', '規格', '材質']).to_csv(
        OUT / '比價_表面處理.csv', index=False, encoding='utf-8-sig')
    attribute_ratios(df, '材質', ['廠商', '品名', '規格', '表面處理']).to_csv(
        OUT / '比價_材質同廠.csv', index=False, encoding='utf-8-sig')
    cross_material(df).to_csv(OUT / '比價_材質等級.csv', index=False, encoding='utf-8-sig')

    print(f'系列數 {len(series)}，R² 中位數 {series.R2.median():.3f}')
    print(perkg)
    print(head)
    print(cross_material(df))
    print(f'輸出：{OUT}')


if __name__ == '__main__':
    main()
