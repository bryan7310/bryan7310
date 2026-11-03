"""共用：讀取牌價總表，把直徑、長度換成 mm 數值。"""
import re
from fractions import Fraction
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
INCH = 25.4


def _frac(s):
    """'1-1/4' '3/8' '2' → 浮點數（英吋）"""
    s = s.strip().replace('"', '').replace('”', '')
    m = re.fullmatch(r'(\d+)-(\d+/\d+)', s)
    if m:
        return int(m.group(1)) + float(Fraction(m.group(2)))
    return float(Fraction(s))


def dia_mm(d):
    if not isinstance(d, str):
        return None
    d = d.strip()
    m = re.fullmatch(r'M(\d+(?:\.\d+)?)', d)
    if m:
        return float(m.group(1))
    m = re.fullmatch(r'#?(\d+)#?', d)
    if m and ('#' in d):  # 番數：#N = 0.060 + 0.013N 吋
        return (0.060 + 0.013 * int(m.group(1))) * INCH
    try:
        return _frac(d) * INCH
    except Exception:
        return None


def len_mm(l):
    if l is None or (isinstance(l, float) and pd.isna(l)):
        return None
    s = str(l).strip()
    try:
        if '"' in s or '/' in s:
            return _frac(s) * INCH
        return float(s)
    except Exception:
        return None


def load():
    df = pd.read_excel(ROOT / '螺絲牌價總表.xlsx', sheet_name='全部')
    df['d_mm'] = df['直徑'].map(dia_mm)
    df['L_mm'] = df['長度'].map(len_mm)
    df['折'] = df['折扣'].map(lambda s: 1.0 if s == '原價' or pd.isna(s)
                             else float(re.match(r'([\d.]+)', str(s)).group(1)) / 100)
    df['表面處理'] = df['表面處理'].fillna('')
    df['頭型'] = df['頭型'].fillna('')
    return df
