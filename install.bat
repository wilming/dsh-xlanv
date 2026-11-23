@echo off
chcp 65001 >nul
echo ============================================================
echo [XLANV] 正在为 DSH Web 环境一键安装 dsh-browser-x 和 dsh-xlanv 插件...
echo ============================================================
echo.
echo [1/3] 正在安装 dsh-browser-x 浏览器基础设施插件...
call dsh plugin --profile web add https://github.com/wilming/dsh-browser-x

echo.
echo [2/3] 正在检查并补齐 Chromium 浏览器内核...
call npx playwright install chromium

echo.
echo [3/3] 正在将 dsh-xlanv 安装到 DSH...
call dsh plugin --profile web add .

echo.
echo ============================================================
echo ✅ 安装完成！
echo 👉 下一步：
echo    1. 执行 dsh profile web start 启动环境
echo    2. 在弹出的浏览器中打开 https://x.com 并登录你的推特蓝V账号
echo    3. 插件将自动弹出密钥输入框，填入 xlanv.net 的 api_secret 即可全天候运行！
echo ============================================================
pause
