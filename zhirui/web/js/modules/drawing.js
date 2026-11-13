// 螺絲圖面：沿用原作業平台的圖面工具（獨立頁面，嵌在這裡；用 embed 模式不顯示它自己的選單）
// 圖面工具放在 #view 旁邊一個常駐的容器裡：切到別的頁面只是藏起來、不拆掉，回來時上次還沒存的繪圖都還在
// （iframe 一旦從畫面拿掉或搬動就會重新載入，所以不能放在每次換頁都會重建的 #view 裡）。
let host = null;
export default {
  id: 'drawing', name: '螺絲圖面', group: '業務', icon: 'drawing',
  async render(el) {
    el.style.display = 'none';
    if (host && host.isConnected) { host.style.display = 'block'; return; }
    host = document.createElement('div'); host.id = 'drawHost'; host.style.cssText = 'display:block;min-width:0';
    host.innerHTML = '<div class="muted" style="padding:16px">載入圖面工具…</div>';
    el.after(host);
    try {
      const html = await (await fetch('legacy/drawing.html')).text();
      const doc = html.replace(/<head>/i, '<head><script>window.ZR_MODE="embed";</script><base href="legacy/">');
      host.innerHTML = '';
      const f = document.createElement('iframe'); f.title = '螺絲圖面'; f.style.cssText = 'width:100%;height:calc(100vh - 52px);height:calc(100dvh - 52px);border:0;display:block';
      f.srcdoc = doc; host.append(f);
    } catch (e) { host.innerHTML = `<div class="banner" style="margin:16px">載入圖面工具失敗：${e.message}</div>`; }
  },
  destroy() { const el = document.getElementById('view'); if (el) { el.style.display = ''; el.style.padding = ''; } if (host) host.style.display = 'none'; },
};
