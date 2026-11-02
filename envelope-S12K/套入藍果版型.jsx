// 用法：
// 1. 從藍果商品頁重新下載 S12K 信封版型 .ai，用 Illustrator 打開。
// 2. 檔案 > 指令碼 > 其他指令碼…，選這個檔案。
// 3. 選「志瑞螺絲信封S12K_印刷稿_CMYK_修正版.pdf」。
// 指令碼會把印刷稿放進「印刷」圖層、對齊版型的刀模線並嵌入；刀模圖層不會被動到。
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
        alert('找不到「印刷」或「刀模」圖層。\n目前的圖層：' + names.join('、') + '\n請確認打開的是藍果的版型檔。');
        return;
    }

    // 刀模線的範圍（版型的刀模圖層）
    var b = null;
    for (var i = 0; i < dieLayer.pageItems.length; i++) {
        var v = dieLayer.pageItems[i].geometricBounds; // [左, 上, 右, 下]
        if (!b) b = [v[0], v[1], v[2], v[3]];
        else { b[0] = Math.min(b[0], v[0]); b[1] = Math.max(b[1], v[1]); b[2] = Math.max(b[2], v[2]); b[3] = Math.min(b[3], v[3]); }
    }
    if (!b) { alert('刀模圖層是空的，請重新下載版型。'); return; }
    var dieCX = (b[0] + b[2]) / 2, dieCY = (b[1] + b[3]) / 2;
    var dieW = b[2] - b[0], dieH = b[1] - b[3];

    var here = File($.fileName).parent;
    var guess = File(here + '/志瑞螺絲信封S12K_印刷稿_CMYK_修正版.pdf');
    var f = guess.exists ? guess : File.openDialog('選擇印刷稿 PDF（_修正版）', '*.pdf');
    if (!f) return;

    var wasLocked = printLayer.locked, wasVisible = printLayer.visible;
    printLayer.locked = false; printLayer.visible = true;
    dieLayer.locked = true;                       // 保護刀模圖層

    app.preferences.PDFFileOptions.pDFCropToBox = PDFBoxType.PDFMEDIABOX; // 連 3mm 出血一起置入
    app.preferences.PDFFileOptions.pageToOpen = 1;
    var item = printLayer.placedItems.add();
    item.file = f;
    item.position = [dieCX - item.width / 2, dieCY + item.height / 2];
    item.move(printLayer, ElementPlacement.PLACEATEND);
    var artW = item.width, artH = item.height;
    try { item.embed(); } catch (e) {}

    printLayer.locked = wasLocked; printLayer.visible = wasVisible;

    var mm = 72 / 25.4, bleed = 6 * mm;           // 印刷稿每邊多 3mm 出血
    var dw = Math.abs((artW - bleed) - dieW) / mm, dh = Math.abs((artH - bleed) - dieH) / mm;
    var msg = '完成！印刷稿已放在「' + printLayer.name + '」圖層，並對齊刀模中心。\n刀模圖層沒有更動。';
    if (dw > 2 || dh > 2)
        msg += '\n\n注意：版型刀模和印刷稿尺寸差了 約 ' + dw.toFixed(1) + ' x ' + dh.toFixed(1) +
               ' mm，請手動確認位置（版型的刀模範圍可能包含其他標示）。';
    alert(msg);
})();
