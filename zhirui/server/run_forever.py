# -*- coding: utf-8 -*-
"""志瑞平台伺服器啟動器：把 app.py 當子程序跑，子程序以代碼 3 結束（網頁按「重新啟動伺服器」）就立刻重開，
意外當掉就 5 秒後重開。排程工作改成執行這支，之後更新 server/*.py 不必再到伺服器電腦按 UAC。
用法與 app.py 相同：python server\\run_forever.py --port 8080 --data data
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RESTART_CODE = 3


def main():
    args = [sys.executable, os.path.join(HERE, 'app.py')] + sys.argv[1:]
    env = dict(os.environ, ZR_LAUNCHER='1')
    while True:
        started = time.time()
        try:
            p = subprocess.run(args, cwd=os.path.dirname(HERE), env=env)
            code = p.returncode
        except KeyboardInterrupt:
            return 0
        if code == RESTART_CODE:
            sys.stderr.write('[launcher] 收到重新啟動要求，1 秒後重開\n')
            time.sleep(1)
            continue
        if code != 0:
            # 剛啟動就失敗（例如埠被占用）不要狂重試
            wait = 5 if time.time() - started > 10 else 30
            sys.stderr.write('[launcher] 伺服器結束（代碼 %s），%d 秒後重開\n' % (code, wait))
            time.sleep(wait)
            continue
        return 0


if __name__ == '__main__':
    sys.exit(main())
