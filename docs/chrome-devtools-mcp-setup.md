# Chrome DevTools MCP 部署说明

已在项目根目录新增 `.mcp.json`，默认服务器名为 `chrome-devtools`。

## 当前配置

- 命令：`npx -y chrome-devtools-mcp@latest`
- 参数：
  - `--isolated`：使用临时 Chrome profile，避免污染日常浏览配置
  - `--usageStatistics=false`：关闭使用统计上报
  - `--performanceCrux=false`：关闭 CrUX 远程数据请求

## 验证方法

1. 在支持 MCP 的客户端中加载当前工作区。
2. 确认读取到 `chrome-devtools` MCP server。
3. 发送测试提示词：
   - `Check the performance of https://developers.chrome.com`

如果需要连接你当前已打开的 Chrome（保留登录态），可改为：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--autoConnect"
      ]
    }
  }
}
```

并在 Chrome 中开启 `chrome://inspect/#remote-debugging`。
