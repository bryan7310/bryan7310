// 用法：
// 1. 用 Illustrator 打開藍果的版型「信封-S12K-直12K-115x230mm.ai」。
// 2. 把這個指令碼和「志瑞螺絲信封S12K_印刷稿_CMYK_修正版.pdf」放在同一個資料夾。
// 3. 檔案 > 指令碼 > 其他指令碼…，選這個檔案。
// 會做的事：
//  - 把印刷稿置入並嵌入到「印刷圖層」，對齊刀模（印刷稿和刀模的中心對齊）。
//  - 刪除「刀模圖層」上的範本說明文字（填色的字、箭頭、圖例、引線），保留刀模線、出血線、上膠區框。
//  - 不合併圖層，刀模圖層原本的鎖定 / 列印設定都保持不變。
#target illustrator
(function () {
    if (app.documents.length === 0) { alert('請先打開藍果的信封版型 .ai。'); return; }
    var doc = app.activeDocument;

    function findLayer(key) {
        for (var i = 0; i < doc.layers.length; i++)
            if (doc.layers[i].name.indexOf(key) >= 0) return doc.layers[i];
        return null;
    }
    var printLayer = findLayer('印刷');
    var dieLayer = findLayer('刀模');
    if (!printLayer || !dieLayer) {
        var names = [];
        for (var n = 0; n < doc.layers.length; n++) names.push(doc.layers[n].name);
        alert('找不到「印刷圖層」或「刀模圖層」。\n目前的圖層：' + names.join('、'));
        return;
    }
    if (printLayer.pageItems.length > 0 &&
        !confirm('「' + printLayer.name + '」已經有 ' + printLayer.pageItems.length + ' 個物件，還是要繼續置入嗎？')) return;

    var dieLocked = dieLayer.locked, dieVisible = dieLayer.visible;
    var prLocked = printLayer.locked, prVisible = printLayer.visible;
    dieLayer.locked = false; dieLayer.visible = true;
    printLayer.locked = false; printLayer.visible = true;

    // 刀模圖層的所有最底層物件
    var leaves = [];
    function walk(items) {
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.typename === 'GroupItem') walk(it.pageItems);
            else leaves.push(it);
        }
    }
    walk(dieLayer.pageItems);
    function firstPath(it) {
        if (it.typename === 'PathItem') return it;
        if (it.typename === 'CompoundPathItem' && it.pathItems.length) return it.pathItems[0];
        return null;
    }

    // 1) 找最大的那條外框線（出血線），用它的中心對齊
    var big = null, bigArea = 0;
    for (var i = 0; i < leaves.length; i++) {
        var p = firstPath(leaves[i]);
        if (!p || !p.stroked) continue;
        var g = leaves[i].geometricBounds, a = (g[2] - g[0]) * (g[1] - g[3]);
        if (a > bigArea) { bigArea = a; big = g; }
    }
    if (!big) { alert('刀模圖層裡找不到刀模線，請確認版型檔。'); return; }
    var mm = 72 / 25.4;
    var dieW = big[2] - big[0], dieH = big[1] - big[3];
    var cx = (big[0] + big[2]) / 2, cy = (big[1] + big[3]) / 2;

    // 2) 置入印刷稿
    var here = File($.fileName).parent;
    var f = File(here + '/志瑞螺絲信封S12K_印刷稿_CMYK_修正版.pdf');
    if (!f.exists) f = File.openDialog('選擇「志瑞螺絲信封S12K_印刷稿_CMYK_修正版.pdf」', '*.pdf');
    if (!f) return;
    app.preferences.PDFFileOptions.pDFCropToBox = PDFBoxType.PDFMEDIABOX; // 連出血一起置入
    app.preferences.PDFFileOptions.pageToOpen = 1;
    var item = printLayer.placedItems.add();
    item.file = f;
    var artW = item.width, artH = item.height;
    item.position = [cx - artW / 2, cy + artH / 2];
    try { item.embed(); } catch (e) {}

    // 3) 刪除範本說明（填色無描邊的字、箭頭、圖例；超過 10pt 的兩點直線引線）
    var removed = 0;
    if (confirm('要刪除刀模圖層上的範本說明文字嗎？\n（刀模線、出血線、上膠區框都會保留）')) {
        for (var k = leaves.length - 1; k >= 0; k--) {
            var it = leaves[k], q = firstPath(it), kill = false;
            if (it.typename === 'TextFrame') kill = true;
            else if (q) {
                if (q.filled && !q.stroked) kill = true;
                else if (it.typename === 'PathItem' && q.stroked && !q.closed && q.pathPoints.length === 2) {
                    var b2 = it.geometricBounds;
                    if (Math.max(b2[2] - b2[0], b2[1] - b2[3]) > 10) kill = true;   // 引線；短的折線記號保留
                } else if (it.typename === 'PathItem' && q.pathPoints.length < 2) kill = true;
            }
            if (kill) { it.remove(); removed++; }
        }
        // 清掉空的群組
        for (var gi = dieLayer.groupItems.length - 1; gi >= 0; gi--)
            if (dieLayer.groupItems[gi].pageItems.length === 0) dieLayer.groupItems[gi].remove();
    }

    dieLayer.locked = dieLocked; dieLayer.visible = dieVisible;
    printLayer.locked = prLocked; printLayer.visible = prVisible;

    // 印刷稿 = 刀模外框 + 每邊 3mm
    var dw = Math.abs(artW - 6 * mm - dieW) / mm, dh = Math.abs(artH - 6 * mm - dieH) / mm;
    var msg = '完成！\n・印刷稿已放進「' + printLayer.name + '」並對齊刀模\n・刪除範本說明 ' + removed + ' 個物件\n・圖層沒有合併';
    if (dw > 1.5 || dh > 1.5) msg += '\n\n注意：刀模和印刷稿尺寸差了約 ' + dw.toFixed(1) + ' x ' + dh.toFixed(1) + ' mm，請手動檢查位置。';
    msg += '\n\n請檢查後「另存新檔」成 .ai 上傳。';
    alert(msg);
})();
