"""Arquivo de campo temporário compartilhado apenas pela suíte de testes."""
import atexit
import os
import tempfile
from pathlib import Path

_directory = tempfile.TemporaryDirectory(prefix="six-tanks-tests-")
os.environ["SIX_TANK_LEVEL_ZERO_FILE"] = str(Path(_directory.name) / "level-zero.json")
atexit.register(_directory.cleanup)
