#!/usr/bin/env bash
cd "$(dirname "$0")/backend"
pip3 install -r requirements.txt
python3 app.py
