# SPARK - Otomatik Baslatma Scripti (Windows / PowerShell)
Write-Host "SPARK Sistemi Baslatiliyor..."

$ProjectRoot = "c:\Users\Burak\Desktop\SPARK"

# 1. Backend (Python FastAPI) Sunucusunu Baslat
Write-Host "Backend sunucusu baslatiliyor (Port 8000)..."
Set-Location -Path "$ProjectRoot\backend"
if (-not (Test-Path "venv")) {
    Write-Host "Sanal ortam (venv) bulunamadi, olusturuluyor..."
    python -m venv venv
}

# Backend'i ayri bir pencerede baslat
Start-Process powershell -ArgumentList "-NoExit -Command `"cd $ProjectRoot\backend; .\venv\Scripts\Activate.ps1; pip install -r requirements.txt; uvicorn main:app --reload --port 8000`""

# 2. Frontend (HTTP Server) Sunucusunu Baslat
Write-Host "Frontend sunucusu baslatiliyor (Port 8080)..."
Start-Process powershell -ArgumentList "-NoExit -Command `"cd $ProjectRoot; python -m http.server 8080`""

# Sunucularin ayaga kalkmasi icin kisa sure bekle
Start-Sleep -Seconds 3

# 3. Tarayiciyi Ac
Write-Host "Tarayici aciliyor: http://localhost:8080"
Start-Process "http://localhost:8080"

Write-Host "SPARK basariyla calistirildi! Acilan yeni pencereleri kapatarak sunuculari durdurabilirsiniz."
