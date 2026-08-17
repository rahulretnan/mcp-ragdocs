$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$Model = if ($env:EMBEDDING_MODEL) { $env:EMBEDDING_MODEL } elseif ($env:OLLAMA_EMBEDDING_MODEL) { $env:OLLAMA_EMBEDDING_MODEL } else { "nomic-embed-text" }
$OllamaHost = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { "http://localhost:11434" }

if ($OllamaHost -ne "http://localhost:11434" -and $OllamaHost -ne "http://127.0.0.1:11434") {
    throw "OLLAMA_HOST must point to the local Compose Ollama service when using this script: $OllamaHost"
}
$env:OLLAMA_HOST = $OllamaHost

Write-Host "Starting Qdrant and Ollama..."
docker compose -f (Join-Path $ProjectDir "docker-compose.yml") up -d qdrant ollama
if ($LASTEXITCODE -ne 0) { throw "Failed to start Qdrant and Ollama (exit code $LASTEXITCODE)" }

Write-Host "Waiting for Ollama at $OllamaHost..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri "$OllamaHost/api/tags" -Method Get | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $ready) {
    throw "Ollama did not become ready at $OllamaHost"
}

Write-Host "Waiting for Qdrant at http://localhost:6333..."
$qdrantReady = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri "http://localhost:6333/healthz" -Method Get | Out-Null
        $qdrantReady = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $qdrantReady) {
    throw "Qdrant did not become ready at http://localhost:6333"
}

Write-Host "Pulling Ollama embedding model: $Model"
docker compose -f (Join-Path $ProjectDir "docker-compose.yml") exec -T ollama ollama pull $Model
if ($LASTEXITCODE -ne 0) { throw "Failed to pull Ollama embedding model '$Model' (exit code $LASTEXITCODE)" }
Write-Host "Ollama embedding configuration initialized."
