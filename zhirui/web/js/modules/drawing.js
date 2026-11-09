// 螺絲圖面：沿用原作業平台的圖面工具（獨立頁面，嵌在這裡；用 embed 模式不顯示它自己的選單）
export default {
  id: 'drawing', name: '螺絲圖面', group: '業務', icon: 'drawing',
  async render(el) {
    el.style.padding = '0'; el.style.display = 'block';
    el.innerHTML = `<div class="muted" style="padding:16px">載入圖面工具…</div>`;
    try {
      const html = await (await fetch('legacy/drawing.html')).text();
      const doc = html.replace(/<head>/i, '<head><script>window.ZR_MODE="embed";</script><base href="legacy/">');
      el.innerHTML = '';
      const f = document.createElement('iframe'); f.title = '螺絲圖面'; f.style.cssText = 'width:100%;height:calc(100vh - 52px);height:calc(100dvh - 52px);border:0;display:block';
      f.srcdoc = doc; el.append(f);
    } catch (e) { el.innerHTML = `<div class="banner" style="margin:16px">載入圖面工具失敗：${e.message}</div>`; }
  },
  destroy() { const el = document.getElementById('view'); el.style.padding = ''; el.style.display = ''; },
};
