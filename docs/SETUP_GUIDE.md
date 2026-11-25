# XLANV (dsh-xlanv) Windows 端从零安装与配置指南

## 系统架构图

![XLANV 系统架构图](./images/architecture.svg)

<details>
<summary><strong>点击展开：安装与使用总流程图（11 步）</strong></summary>

```mermaid
flowchart LR
  subgraph G1["阶段一：浏览器与客户端准备"]
    direction TB
    S1["1. 准备 Windows 电脑"] --> S2["2. 安装 Chrome 并登录 X"]
    S2 --> S3["3. 安装 Chrome 扩展 dsh-browser-x-extension"]
    S3 --> S4["4. 下载并安装 DSH 客户端"]
  end

  subgraph G2["阶段二：安装插件与重启"]
    direction TB
    S5["5. 登录 DeepSeek，先装 dsh-browser-x"] --> S6["6. 再装 dsh-xlanv 插件"]
    S6 --> S7["7. 右下角托盘退出 DSH 后重启"]
  end

  subgraph G3["阶段三：注册取密与启动巡检"]
    direction TB
    S8["8. 去 xlanv.net 注册并绑定 X"] --> S9["9. 后台复制 32 位 api_secret"]
    S9 --> S10["10. DSH 左下角打开 XLANV 控制台"]
    S10 --> S11["11. 配置密钥/动作/推广并开启巡检"]
  end

  G1 --> G2 --> G3
```

</details>

---

## 详细操作步骤

### 1. 准备一台 Windows 电脑
- 建议 **Windows 10 / Windows 11**（64 位），确保可正常开启本地代理访问 `https://x.com` 与 GitHub。

### 2. 安装 Chrome 浏览器并登录 X
- 下载并安装最新版 **Google Chrome**（建议版本 `>= 116`）。
- 打开 `https://x.com` 登录你的 X 账号并保持登录态。

### 3. 安装 Chrome 浏览器扩展（`dsh-browser-x-extension`）
- 打开 Chrome 应用商店地址安装扩展：
  **[https://chromewebstore.google.com/detail/dsh-browser-x-extension/mbkfinpobimaaoaihdbopehapbgfcfnj](https://chromewebstore.google.com/detail/dsh-browser-x-extension/mbkfinpobimaaoaihdbopehapbgfcfnj)**
- 若存在多个 Chrome 窗口，可在扩展侧边栏点击 **`Take it back`** 取回当前窗口的控制权：

  ![Chrome 扩展侧边栏接管状态](./images/15-chrome-extension-panel.png)

### 4. 下载 DeepSeek Harness (DSH) 客户端
- 下载并安装 Windows 版 **DeepSeek Harness (DSH)** 桌面客户端。

### 5. 登录 DeepSeek，先安装 `dsh-browser-x` 插件
1. 打开 DSH 客户端并登录 DeepSeek 账号。
2. 进入左侧 **「插件」** 页面，点击右上角 **「+ 添加插件」**：

   ![DSH 插件页点击添加插件](./images/01-dsh-add-plugin.png)

3. 输入 **`dsh-browser-x`** 并点击 **「安装」**：

   ![输入 dsh-browser-x 安装](./images/02-install-dsh-browser-x.png)

### 6. 再安装 `https://github.com/wilming/dsh-xlanv` 插件
1. 再次点击 **「+ 添加插件」**，输入 `https://github.com/wilming/dsh-xlanv` 后点击 **「安装」**：

   ![输入 GitHub 地址安装 dsh-xlanv](./images/03-install-dsh-xlanv.png)

2. 等待仓库拉取与安装完成：

   ![插件安装中](./images/04-installing-dsh-xlanv.png)

3. 安装成功后点击 **「立即启用」**：

   ![安装完成点击立即启用](./images/05-enable-dsh-xlanv.png)

4. 在「已安装插件」中确认 `dsh-browser-x` 和 `dsh-xlanv` 均处于开启状态：

   ![确认两个插件均已启用](./images/06-plugins-enabled-list.png)

### 7. 电脑右下角托盘退出 DSH 客户端然后重启
- 右键点击 Windows 桌面**右下角系统托盘**的 DSH 图标，点击 **「退出」**，然后重新启动 DSH 客户端。

### 8. 去 `https://xlanv.net` 注册账号
- 访问 **[https://xlanv.net](https://xlanv.net)** 注册账号，并在后台绑定你的 X 用户名（无需带 `@`）。

### 9. 在 `https://xlanv.net` 后台复制密钥（`api_secret`）
- 在用户后台复制生成的 32 位 **`api_secret`** 密钥。

### 10. 重启后的 DSH 左下角打开 XLANV 控制台
1. 在 DSH 主界面**左下角**点击 **「XLANV 控制台」**：

   ![DSH 左下角 XLANV 控制台按钮](./images/07-dsh-xlanv-fab.png)

2. 打开控制抽屉，顶部包含「基础设置 & Prompt」、「帖子推广管理」、「实时运行日志」三个标签页：

   ![XLANV 控制台三个核心标签页](./images/08-xlanv-console-tabs.png)

### 11. 根据图示进行配置、上传推广帖子并开启定时巡检
1. **填写 `api_secret` 密钥**：

   ![填入平台密钥 api_secret](./images/09-config-api-secret.png)

2. **配置运行时段、频率、动作开关并保存**：

   ![配置自动运行时段与频率](./images/11-config-schedule-full.png)

   ![勾选互动动作开关并保存生效](./images/10-config-actions-save.png)

3. **抓取主页帖子并提交上传推广**：

   ![刷新并抓取主页前 10 条帖子](./images/12-posts-refresh.png)

   ![默认推广策略配置](./images/13-posts-default-policy.png)

   ![提交上传推广帖子](./images/14-posts-promote-submit.png)

4. **在「实时运行日志」查看定时巡检与积分结算**：

   ![实时运行日志与积分结算](./images/16-realtime-logs.png)
