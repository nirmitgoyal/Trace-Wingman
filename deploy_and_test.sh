#!/bin/bash
set -e

echo "=== Sevak Dashboard - Deploy & Test ==="

# Install backend dependencies
echo "[1/5] Installing backend dependencies..."
cd backend
npm install
cd ..

# Install frontend dependencies
echo "[2/5] Installing frontend dependencies..."
cd frontend
npm install
cd ..

# Build frontend
echo "[3/5] Building frontend..."
cd frontend
npm run build
cp -r dist ../backend/public
cd ..

# Seed database (optional)
echo "[4/5] Seeding database..."
cd backend
npm run seed || echo "Seeding skipped (check MONGODB_URI in .env)"
cd ..

# Start server
echo "[5/5] Starting server..."
cd backend
npm run dev
