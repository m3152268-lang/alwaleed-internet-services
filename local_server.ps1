$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 8000)
try {
  $listener.Start()
} catch {
  Write-Host 'Port 8000 is busy. Close another local server and try again.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}
$url = 'http://127.0.0.1:8000/'
Write-Host ''
Write-Host 'Company Alwaleed site is running locally:' -ForegroundColor Green
Write-Host $url -ForegroundColor Cyan
Write-Host 'Keep this window open. Press Ctrl+C to stop.' -ForegroundColor Yellow
Start-Process $url
$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8';
  '.txt'='text/plain; charset=utf-8'; '.sql'='text/plain; charset=utf-8';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.svg'='image/svg+xml';
  '.ico'='image/x-icon'; '.woff'='font/woff'; '.woff2'='font/woff2'
}
while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $headerBytes = New-Object System.Collections.Generic.List[byte]
    $last4 = [System.Collections.Generic.Queue[byte]]::new()
    while ($headerBytes.Count -lt 16384) {
      $b = $stream.ReadByte()
      if ($b -lt 0) { break }
      $headerBytes.Add([byte]$b)
      $last4.Enqueue([byte]$b)
      if ($last4.Count -gt 4) { $null = $last4.Dequeue() }
      if ($last4.Count -eq 4 -and [System.Text.Encoding]::ASCII.GetString($last4.ToArray()) -eq "`r`n`r`n") { break }
    }
    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
    $firstLine = ($headerText -split "`r`n")[0]
    $parts = $firstLine.Split(' ')
    $method = if ($parts.Length -gt 0) { $parts[0] } else { 'GET' }
    $path = if ($parts.Length -gt 1) { [Uri]::UnescapeDataString(($parts[1] -split '\?')[0]) } else { '/' }
    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      $body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
      $status = '405 Method Not Allowed'; $type = 'text/plain; charset=utf-8'
    } else {
      if ($path -eq '/') { $path = '/index.html' }
      $relative = $path.TrimStart('/') -replace '/', [IO.Path]::DirectorySeparatorChar
      $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
      if (-not $full.StartsWith([IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not Found'); $status = '404 Not Found'; $type = 'text/plain; charset=utf-8'
      } else {
        $body = [IO.File]::ReadAllBytes($full); $status = '200 OK'
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      }
    }
    $length = $body.Length
    $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-cache`r`nConnection: close`r`nAccess-Control-Allow-Origin: *`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    if ($method -ne 'HEAD' -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
  } catch {
    # Ignore individual browser disconnects; keep the local server alive.
  } finally {
    if ($client) { $client.Close() }
  }
}
