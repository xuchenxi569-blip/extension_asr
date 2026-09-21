# 一键启动本机转写服务：开 backend。8787 被占就改用后面的门。
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
try { chcp 65001 | Out-Null } catch { }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$preferredPort = 8787
$portSpan = 20
$port = $preferredPort
$healthUrl = "http://127.0.0.1:$port"

function Write-Info([string]$text) { Write-Host $text -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host $text -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host $text -ForegroundColor Yellow }
function Write-Fail([string]$text) { Write-Host $text -ForegroundColor Red }

function Set-ActivePort([int]$p) {
  $script:port = $p
  $script:healthUrl = "http://127.0.0.1:$p"
}

function Test-AsrReady([int]$p) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$p/" -UseBasicParsing -TimeoutSec 2
    $json = $response.Content | ConvertFrom-Json
    return $json.service -eq 'extension-asr-backend'
  } catch {
    return $false
  }
}

function Test-PortFree([int]$p) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

function Find-AsrPort {
  foreach ($p in $preferredPort..($preferredPort + $portSpan)) {
    if (Test-AsrReady $p) { return $p }
  }
  return $null
}

function Find-FreePort {
  foreach ($p in $preferredPort..($preferredPort + $portSpan)) {
    if (Test-AsrReady $p) { return $p }
    if (Test-PortFree $p) { return $p }
  }
  return $null
}

# 端口通了不代表能用：创建会话这一步也可能报错（比如模型配错、代码有笔误）。
# 这里真开一个会话再关掉，把问题在启动时就暴露出来。
function Test-SessionReady {
  try {
    $response = Invoke-WebRequest -Uri "$healthUrl/session/start" -Method POST `
      -Headers @{ 'Content-Type' = 'application/json' } -Body '{}' `
      -UseBasicParsing -TimeoutSec 10
    $sessionId = $response.Headers['X-Session-Id']
    if (-not $sessionId) {
      return @{ ok = $false; message = "服务回了 $($response.StatusCode) 但没给会话号" }
    }
    try {
      Invoke-WebRequest -Uri "$healthUrl/session/stop" -Method POST `
        -Headers @{ 'x-session-id' = $sessionId } -UseBasicParsing -TimeoutSec 5 | Out-Null
    } catch { }
    return @{ ok = $true; message = '' }
  } catch {
    $detail = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $body = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
      if ($body) { $detail = $body }
    } catch { }
    return @{ ok = $false; message = $detail }
  }
}

function Show-ReadyBanner {
  Write-Host ''
  Write-Ok '========================================'
  Write-Ok "  服务已开好  $healthUrl"
  Write-Ok '  现在请做这两步：'
  Write-Ok '  1. Chrome 打开正在播放的视频网页'
  Write-Ok '  2. 点工具栏里的本插件图标开始转写'
  Write-Ok '========================================'
  Write-Host ''
  Write-Warn "标题为「本机转写服务 $port」的窗口请保持打开。关掉它 = 服务停止。"
  Write-Host ''
}

function Wait-ForKey([string]$hint) {
  Write-Host $hint
  try {
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  } catch {
    Start-Sleep -Seconds 8
  }
}

Write-Host ''
Write-Host '  本机转写服务  一键启动' -ForegroundColor White
Write-Host ''

if (-not (Test-Path $backend)) {
  Write-Fail "[失败] 找不到 backend 文件夹：$backend"
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Fail '[失败] 电脑上还没有 Node.js。'
  Write-Host '它是跑后台服务用的运行环境，像播放器之于视频。'
  Write-Host '请先安装 20 或更高版本： https://nodejs.org/'
  exit 1
}

Set-Location $backend

$envFile = Join-Path $backend '.env'
$envExample = Join-Path $backend '.env.example'
if (-not (Test-Path $envFile)) {
  if (Test-Path $envExample) {
    Copy-Item $envExample $envFile
    Write-Info '[准备] 已自动生成配置文件 .env'
  }
}

$nodeModules = Join-Path $backend 'node_modules'
if (-not (Test-Path $nodeModules)) {
  Write-Info '[准备] 第一次运行，正在安装依赖，大约 30 秒...'
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Fail '[失败] 依赖安装没成功。请检查网络后重试。'
    exit 1
  }
}

function Show-SessionCheck {
  Write-Info '[自检] 正在试着创建一个转写会话...'
  $check = Test-SessionReady
  if ($check.ok) {
    Write-Ok '[自检通过] 能正常创建会话。'
    return $true
  }
  Write-Fail '[自检失败] 端口通了，但创建会话报错：'
  Write-Host "  $($check.message)"
  Write-Warn '插件里会看到同样的报错。请把上面这行发给开发者，或检查 backend/.env。'
  return $false
}

$existing = Find-AsrPort
if ($existing) {
  Set-ActivePort $existing
  if ($existing -ne $preferredPort) {
    Write-Warn "[提示] 转写服务在 $existing，不是默认的 $preferredPort。"
  }
  Write-Ok '[已就绪] 转写服务已经在跑，不用重复启动。'
  $null = Show-SessionCheck
  Show-ReadyBanner
  Wait-ForKey '按任意键关闭本提示（服务会继续跑）。'
  exit 0
}

$chosen = Find-FreePort
if (-not $chosen) {
  Write-Fail "[失败] $preferredPort 到 $($preferredPort + $portSpan) 都被占用了。"
  Write-Warn '请关掉不用的窗口后再双击 start.bat。'
  exit 1
}

Set-ActivePort $chosen
if ($chosen -ne $preferredPort) {
  Write-Warn "[提示] $preferredPort 被别的程序占用了，改用 $chosen。"
  Write-Host '插件会自动去新门牌找转写服务，不用改设置。'
}

Write-Info "[启动] 正在打开转写服务，等待 $port 就绪..."
Write-Host ''

Start-Process -FilePath 'cmd.exe' -ArgumentList @(
  '/k',
  "title 本机转写服务 $port && set PORT=$port && npm run dev"
) -WorkingDirectory $backend | Out-Null

$readyPort = $null
foreach ($i in 1..45) {
  Start-Sleep -Seconds 1
  $readyPort = Find-AsrPort
  if ($readyPort) { break }
  Write-Host "  等待中... $i 秒"
}

if (-not $readyPort) {
  Write-Fail "[超时] 等了 45 秒，转写服务还没起来。"
  Write-Warn "请看刚弹出的「本机转写服务 $port」窗口里有没有红色报错。"
  exit 1
}

Set-ActivePort $readyPort
$null = Show-SessionCheck
Show-ReadyBanner
Wait-ForKey '看完后按任意键关闭本提示。转写服务窗口请留下。'
