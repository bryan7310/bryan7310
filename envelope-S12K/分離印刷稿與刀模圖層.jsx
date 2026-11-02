// 用法：在 Illustrator 開啟信封 .ai 後，執行「檔案 > 指令碼 > 其他指令碼…」選這個檔案。
// 會建立兩個圖層：「印刷稿」(點陣圖與其他圖稿) 與「刀模線」(只有描邊、沒有填色的線條)，
// 刀模線圖層設為不列印，並放在最上層。
#target illustrator
(function () {
    if (app.documents.length === 0) { alert('請先開啟要分層的檔案。'); return; }
    var doc = app.activeDocument;
    var ART_NAME = '印刷稿 Artwork (CMYK)';
    var DIE_NAME = '刀模線 Dieline (不印刷)';

    // 先記下原本的圖層，並解除鎖定 / 顯示
    var oldLayers = [];
    for (var i = 0; i < doc.layers.length; i++) {
        var L = doc.layers[i];
        if (L.name === ART_NAME || L.name === DIE_NAME) continue;
        L.locked = false; L.visible = true;
        oldLayers.push(L);
    }

    var arts = [], dies = [];
    function isDieline(it) {
        var p = it;
        if (it.typename === 'CompoundPathItem') {
            if (it.pathItems.length === 0) return false;
            p = it.pathItems[0];
        }
        return p.stroked && !p.filled;
    }
    function walk(items) {
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            try { it.locked = false; it.hidden = false; } catch (e) {}
            var t = it.typename;
            if (t === 'GroupItem') { walk(it.pageItems); continue; }
            if (t === 'PathItem' && it.clipping) continue;   // 匯入 PDF 時產生的頁面遮色片，略過
            if (t === 'PathItem' || t === 'CompoundPathItem') {
                (isDieline(it) ? dies : arts).push(it);
            } else {
                arts.push(it);                                // 點陣圖、置入圖、文字等都歸印刷稿
            }
        }
    }
    for (var j = 0; j < oldLayers.length; j++) walk(oldLayers[j].pageItems);

    function getLayer(name) {
        try { return doc.layers.getByName(name); } catch (e) { var L = doc.layers.add(); L.name = name; return L; }
    }
    var art = getLayer(ART_NAME);
    var die = getLayer(DIE_NAME);
    art.locked = false; die.locked = false;
    die.zOrder(ZOrderMethod.BRINGTOFRONT);

    // 依原本的堆疊順序搬移
    for (var a = 0; a < arts.length; a++) arts[a].move(art, ElementPlacement.PLACEATEND);
    for (var d = 0; d < dies.length; d++) dies[d].move(die, ElementPlacement.PLACEATEND);

    // 清掉搬空的群組與舊圖層
    function cleanup(container) {
        for (var i = container.groupItems.length - 1; i >= 0; i--) {
            var g = container.groupItems[i];
            cleanup(g);
            var onlyClip = true;
            for (var k = 0; k < g.pageItems.length; k++) {
                var c = g.pageItems[k];
                if (!(c.typename === 'PathItem' && c.clipping)) { onlyClip = false; break; }
            }
            if (onlyClip) g.remove();
        }
    }
    for (var m = 0; m < oldLayers.length; m++) {
        cleanup(oldLayers[m]);
        if (oldLayers[m].pageItems.length === 0 && oldLayers[m].layers.length === 0) oldLayers[m].remove();
    }

    die.printable = false;          // 刀模線不印刷（需要輸出刀模時再打開）
    die.color = (function () { var c = new RGBColor(); c.red = 255; c.green = 0; c.blue = 0; return c; })();
    art.printable = true;

    alert('完成！\n印刷稿：' + arts.length + ' 個物件\n刀模線：' + dies.length + ' 條線');
})();
