#!/bin/bash

# SPARK — Otomatik Başlatma Scripti
echo "⚡ SPARK Sistemi Başlatılıyor..."

# Varsa eski çalışan süreçleri temizle
lsof -ti :8000 | xargs kill -9 2>/dev/null
lsof -ti :8080 | xargs kill -9 2>/dev/null

PROJECT_ROOT=$(pwd)

# 1. Backend (Python FastAPI) Sunucusunu Arka Planda Başlat
echo "📦 Backend sunucusu başlatılıyor (Port 8000)..."
cd "$PROJECT_ROOT/backend"
./venv/bin/uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# 2. Frontend (HTTP Server) Sunucusunu Arka Planda Başlat
echo "🌐 Frontend sunucusu başlatılıyor (Port 8080)..."
cd "$PROJECT_ROOT"
python3 -m http.server 8080 &
FRONTEND_PID=$!

# Sunucuların ayağa kalkması için kısa süre bekle
sleep 2

# 3. Tarayıcıyı Aç (MacOS'a özgü 'open' komutu kullanılmıştır, Linux/Windows'ta farklı olabilir)
echo "🚀 Tarayıcı açılıyor: http://localhost:8080"
open http://localhost:8080 || echo "Lütfen tarayıcınızdan http://localhost:8080 adresine gidin."

echo "✅ SPARK başarıyla çalıştırıldı! Durdurmak için Ctrl+C tuşlarına basabilirsiniz."

# Terminal kapanana kadar süreçleri canlı tut
wait $BACKEND_PID $FRONTEND_PID
