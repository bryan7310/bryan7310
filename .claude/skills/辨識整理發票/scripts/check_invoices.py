#!/usr/bin/env python3
"""辨識整理發票：檢查統一編號、核對金額，輸出 Excel。

用法：python3 check_invoices.py invoices.json 輸出.xlsx [--no-lookup]

檢查項目：
  1. 銷售額 + 營業稅 = 總計
  2. 營業稅 = 銷售額 x 5%（四捨五入），免稅/零稅率除外
  3. 每個品項 數量 x 單價 ≈ 金額（差 1 元以內），品項金額加總 = 銷售額
  4. 賣方、買方統編檢查碼；買方統編與設定一致；發票號碼重複
  5. 賣方統編查經濟部商工登記（data.gcis.nat.gov.tw），比對名稱
"""
import json, sys, subprocess, urllib.parse
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

API = "https://data.gcis.nat.gov.tw/od/data/api/"
API_TYPE = "673F0FC0-B3A7-429F-9041-E9866836B66D"     # 統編查是否為公司、分公司及商業
API_COMPANY = "5F64D864-61CB-4D0D-8AD9-492047CC1EA6"  # 公司登記基本資料
API_BUSINESS = "426D5542-5F05-43EB-83F9-F1300F14E1F1" # 商業登記基本資料（行號、企業社）
API_BRANCH = "367EE769-4D55-4752-AD6E-29164FA8AAB2"   # 分公司統編查分公司名稱


def ban_valid(n):
    """台灣統一編號檢查碼（新制：加總可被 5 整除）。"""
    if not (isinstance(n, str) and len(n) == 8 and n.isdigit()):
        return False
    w = [1, 2, 1, 2, 1, 2, 4, 1]
    s = 0
    for d, k in zip(n, w):
        p = int(d) * k
        s += p // 10 + p % 10
    if s % 5 == 0:
        return True
    return n[6] == "7" and (s + 1) % 5 == 0


def gcis(api, flt):
    url = API + api + "?$format=json&$filter=" + urllib.parse.quote(flt) + "&$skip=0&$top=5"
    r = subprocess.run(["curl", "-sS", "-m", "25", url], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "curl failed")
    try:
        return json.loads(r.stdout) if r.stdout.strip() else []
    except json.JSONDecodeError:
        return []


def lookup(ban):
    t = gcis(API_TYPE, f"No eq {ban}")
    types = [x["TYPE"] for x in t if x.get("exist") == "Y"]
    info = {"types": types, "name": None, "status": None, "addr": None}
    if "公司" in types:
        d = (gcis(API_COMPANY, f"Business_Accounting_NO eq {ban}") or [{}])[0]
        info.update(name=d.get("Company_Name"), status=d.get("Company_Status_Desc"), addr=d.get("Company_Location"))
    elif "商業" in types:
        d = (gcis(API_BUSINESS, f"President_No eq {ban}") or [{}])[0]
        info.update(name=d.get("Business_Name"), status=d.get("Business_Current_Status_Desc"), addr=d.get("Business_Address"))
    elif "分公司" in types:
        d = (gcis(API_BRANCH, f"Branch_Office_Business_Accounting_NO eq {ban}") or [{}])[0]
        info.update(name=d.get("Branch_Office_Name"), status=d.get("Branch_Office_Status_Desc"), addr=d.get("Branch_Office_Location"))
    return info


def norm(s):
    return (s or "").replace("臺", "台").replace(" ", "").replace("　", "")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_lookup = "--no-lookup" not in sys.argv
    if len(args) != 2:
        sys.exit(__doc__)
    src, out = args
    cfg = json.load(open(src, encoding="utf-8"))
    buyer, buyer_id = cfg.get("buyer_name", ""), cfg.get("buyer_id", "")
    rate = cfg.get("tax_rate", 0.05)
    inv = sorted(cfg["invoices"], key=lambda r: (r["date"], r["number"]))

    problems = []  # (發票號碼, 類別, 說明)
    seen = {}
    for r in inv:
        no = r["number"]
        if no in seen:
            problems.append((no, "重複", "發票號碼重複出現"))
        seen[no] = 1
        if r["sales"] + r["tax"] != r["total"]:
            problems.append((no, "加總", f"銷售額 {r['sales']} + 稅 {r['tax']} ≠ 總計 {r['total']}"))
        if r.get("tax_kind", "應稅") == "應稅":
            exp = int(r["sales"] * rate + 0.5)
            if exp != r["tax"]:
                problems.append((no, "稅額", f"營業稅 {r['tax']}，依 5% 應為 {exp}"))
        items = r.get("items", [])
        if items:
            s = sum(i.get("amount") or 0 for i in items)
            if s != r["sales"]:
                problems.append((no, "品項", f"品項金額加總 {s} ≠ 銷售額 {r['sales']}"))
            for i in items:
                q, p, a = i.get("qty"), i.get("price"), i.get("amount")
                if q not in (None, "") and p not in (None, "") and a is not None and abs(q * p - a) > 1:
                    problems.append((no, "品項", f"{i['name']}：{q} x {p} = {q*p:g}，與金額 {a} 不符"))
        if not ban_valid(r["seller_id"]):
            problems.append((no, "統編", f"賣方統編 {r['seller_id']} 檢查碼錯誤，可能看錯數字"))
        if buyer_id and r.get("buyer_id") and r["buyer_id"] != buyer_id:
            problems.append((no, "買方", f"買方統編 {r['buyer_id']} 與 {buyer_id} 不符"))

    reg = {}
    if do_lookup:
        for ban in dict.fromkeys(r["seller_id"] for r in inv):
            try:
                reg[ban] = lookup(ban)
            except RuntimeError as e:
                reg[ban] = {"error": str(e)}
        for r in inv:
            d = reg.get(r["seller_id"], {})
            if d.get("error"):
                continue
            if not d.get("name"):
                continue
            if norm(d["name"]) not in norm(r["seller_name"]) and norm(r["seller_name"]) not in norm(d["name"]):
                problems.append((r["number"], "名稱", f"發票寫「{r['seller_name']}」，登記為「{d['name']}」"))
            if d.get("status") and d["status"] != "核准設立":
                problems.append((r["number"], "狀態", f"{d['name']} 登記狀態：{d['status']}"))

    # ---------- Excel ----------
    F = "Arial"
    hf = Font(name=F, bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="305496")
    thin = Side(style="thin", color="BFBFBF")
    bd = Border(left=thin, right=thin, top=thin, bottom=thin)
    red = PatternFill("solid", fgColor="FCE4D6")
    yel = PatternFill("solid", fgColor="FFF2CC")
    bad = {p[0] for p in problems}

    def header(ws, row, names):
        for c, h in enumerate(names, 1):
            x = ws.cell(row, c, h)
            x.font, x.fill, x.border = hf, fill, bd
            x.alignment = Alignment(horizontal="center")

    def put(ws, row, vals, nums=(), f=None):
        for c, v in enumerate(vals, 1):
            x = ws.cell(row, c, v)
            x.font, x.border = Font(name=F), bd
            if c in nums:
                x.number_format = "#,##0"
            if f:
                x.fill = f

    wb = Workbook()
    ws = wb.active
    ws.title = "發票總表"
    title = f"{buyer}（統編 {buyer_id}）進項發票明細　{cfg.get('period', '')}".strip()
    ws["A1"] = title
    ws["A1"].font = Font(name=F, bold=True, size=14)
    header(ws, 3, ["序號", "發票日期", "發票號碼", "發票類型", "賣方名稱", "賣方統編", "品名摘要", "銷售額", "營業稅", "總計", "備註"])
    for i, r in enumerate(inv):
        row = 4 + i
        names = "、".join(dict.fromkeys(it["name"] for it in r.get("items", [])))
        put(ws, row, [i + 1, r["date"], r["number"], r.get("type", ""), r["seller_name"], r["seller_id"], names,
                      r["sales"], r["tax"], f"=H{row}+I{row}", r.get("note", "")], nums=(8, 9, 10),
            f=red if r["number"] in bad else None)
    last = 3 + len(inv)
    t = last + 1
    ws.cell(t, 7, "合計").font = Font(name=F, bold=True)
    for c in "HIJ":
        x = ws[f"{c}{t}"]
        x.value = f"=SUM({c}4:{c}{last})"
        x.font, x.number_format, x.border = Font(name=F, bold=True), "#,##0", bd
    ws.cell(t + 2, 1, "總計欄 = 銷售額 + 營業稅。紅底列在「檢查結果」分頁有待確認事項。").font = Font(name=F, italic=True, color="808080")
    for c, w in zip("ABCDEFGHIJK", [6, 12, 13, 14, 32, 11, 30, 12, 10, 12, 36]):
        ws.column_dimensions[c].width = w
    ws.freeze_panes = "A4"

    d = wb.create_sheet("品項明細")
    header(d, 1, ["發票日期", "發票號碼", "賣方名稱", "品名", "數量", "單位", "單價", "金額"])
    row = 2
    for r in inv:
        for it in r.get("items", []):
            put(d, row, [r["date"], r["number"], r["seller_name"], it["name"], it.get("qty"), it.get("unit", ""),
                         it.get("price"), it.get("amount")], nums=(8,))
            d.cell(row, 5).number_format = "#,##0.###"
            d.cell(row, 7).number_format = "#,##0.00##"
            row += 1
    d.cell(row, 7, "合計").font = Font(name=F, bold=True)
    x = d.cell(row, 8, f"=SUM(H2:H{row-1})")
    x.font, x.number_format = Font(name=F, bold=True), "#,##0"
    for c, w in zip("ABCDEFGH", [12, 13, 32, 32, 12, 7, 10, 12]):
        d.column_dimensions[c].width = w
    d.freeze_panes = "A2"

    if do_lookup:
        v = wb.create_sheet("統編查核")
        header(v, 1, ["賣方統編", "發票號碼", "發票上名稱", "經濟部登記名稱", "登記狀態", "登記地址", "查核結果"])
        for i, r in enumerate(inv, 2):
            g = reg.get(r["seller_id"], {})
            if g.get("error"):
                res, f = "查詢失敗：" + g["error"], yel
            elif not g.get("name"):
                res, f = "經濟部無登記（營業所等可能為財政部稅籍統編）", yel
            elif any(p[0] == r["number"] and p[1] in ("名稱", "狀態") for p in problems):
                res, f = "不符，請核對", red
            else:
                res, f = "相符", None
            put(v, i, [r["seller_id"], r["number"], r["seller_name"], g.get("name") or "—", g.get("status") or "—",
                       g.get("addr") or "—", res], f=f)
        v.cell(len(inv) + 3, 1, "資料來源：經濟部商工登記公示資料開放 API（data.gcis.nat.gov.tw）").font = Font(name=F, italic=True, color="808080")
        for c, w in zip("ABCDEFG", [11, 13, 30, 30, 10, 44, 40]):
            v.column_dimensions[c].width = w
        v.freeze_panes = "A2"

    p = wb.create_sheet("檢查結果")
    header(p, 1, ["發票號碼", "類別", "說明"])
    if problems:
        for i, (no, k, m) in enumerate(problems, 2):
            put(p, i, [no, k, m], f=red)
    else:
        put(p, 2, ["—", "—", "全部檢查通過"])
    for c, w in zip("ABC", [14, 8, 70]):
        p.column_dimensions[c].width = w

    wb.save(out)
    print(json.dumps({
        "invoices": len(inv),
        "sales": sum(r["sales"] for r in inv),
        "tax": sum(r["tax"] for r in inv),
        "total": sum(r["total"] for r in inv),
        "problems": [{"number": a, "kind": b, "detail": c} for a, b, c in problems],
        "registry": reg,
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
