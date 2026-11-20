// 展示模式：用假資料預覽畫面，不會真的控制任何門
const state = {
  home89: '關閉中',
  store15: '關閉中',
  home50: '開啟 50%',
  store98: '',
  g88: '捲閘門開關：關、背光開關：開',
};

const curtain = [
  { id: 'control:open', label: '開', style: 'open' },
  { id: 'control:stop', label: '停', style: 'stop' },
  { id: 'control:close', label: '關', style: 'close' },
];

export function demoDevices() {
  return [
    { platform: 'tuya', id: 'home89', name: 'home89', online: true, actions: curtain, status: state.home89 },
    { platform: 'tuya', id: 'store15', name: 'store15', online: true, actions: curtain, status: state.store15 },
    { platform: 'tuya', id: 'home50', name: 'home50', online: true, actions: curtain, status: state.home50 },
    { platform: 'tuya', id: 'store98', name: 'store98', online: false, actions: curtain, status: state.store98 },
    {
      platform: 'ewelink',
      id: 'g88',
      name: '88號鐵門開關',
      online: true,
      actions: [
        { id: 'ch:0:on', label: '開', group: '捲閘門開關', style: 'open' },
        { id: 'ch:0:off', label: '關', group: '捲閘門開關', style: 'close' },
        { id: 'ch:1:on', label: '開', group: '背光開關', style: 'open' },
        { id: 'ch:1:off', label: '關', group: '背光開關', style: 'close' },
      ],
      status: state.g88,
    },
  ];
}

export async function demoAction(id, action) {
  if (id === 'store98') throw new Error('裝置離線');
  if (id in state && action.startsWith('control:')) {
    state[id] = { 'control:open': '開啟中', 'control:close': '關閉中', 'control:stop': '已停止' }[action];
  }
}
