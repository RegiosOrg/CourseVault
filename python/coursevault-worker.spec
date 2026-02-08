# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for CourseVault Transcription Worker

Bundles parallel_worker.py and all its local module imports
into a single directory executable.

Build: pyinstaller coursevault-worker.spec
Output: dist/coursevault-worker/coursevault-worker.exe
"""

import sys
import os

block_cipher = None

a = Analysis(
    ['parallel_worker.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Standard library modules that may be dynamically imported
        'json',
        'pathlib',
        'hashlib',
        'threading',
        'concurrent.futures',
        'subprocess',
        'dataclasses',
        'queue',
        'uuid',
        'ctypes',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'unittest',
        'pydoc',
        'doctest',
        'test',
        'distutils',
        'setuptools',
        'pip',
        'ensurepip',
        'venv',
        'lib2to3',
        'idlelib',
        'turtledemo',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='coursevault-worker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Need console for subprocess communication
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join('..', 'resources', 'icon.png') if os.path.exists(os.path.join('..', 'resources', 'icon.png')) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='coursevault-worker',
)
