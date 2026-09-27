#!/bin/sh
# Optional voice input. Run as root on the server, from this folder:
#   sh install.sh <user>     (<user> = the SSH user SessionDeck logs in as)
# Safe to repeat, also to update service.py.
set -e
USER_NAME="${1:?usage: sh install.sh <ssh-user>}"
id "$USER_NAME" >/dev/null
DEST=/opt/sessiondeck-voice
cd "$(dirname "$0")"
mkdir -p $DEST/models
install -m 644 service.py requirements.txt $DEST/
[ -x $DEST/venv/bin/python ] || python3 -m venv $DEST/venv
$DEST/venv/bin/pip install -q --only-binary=:all: -r $DEST/requirements.txt
# Download the models once; the service itself has no network.
$DEST/venv/bin/python -c "
from faster_whisper import download_model
for m in ('base', 'small'): download_model(m, cache_dir='$DEST/models')"
chmod -R a+rX $DEST
sed "s/@USER@/$USER_NAME/g" sessiondeck-voice.service > /etc/systemd/system/sessiondeck-voice.service
systemctl daemon-reload
systemctl enable sessiondeck-voice
systemctl restart sessiondeck-voice
echo "Voice service running. Enable 'Voice input' in SessionDeck settings."
